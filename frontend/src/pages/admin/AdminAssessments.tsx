import { Button, Card, EmptyState, InlineAlert, Input, StatusBadge, Textarea } from "@isker/design-system";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminApi, useAdminAssessments, useAdminMutation, type AdminAssessment } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useConfirmAction } from "./common";
import { useToast } from "../../components/Toaster";
import { formatNumber } from "../../utils/format";
import { EditorFooter, EditorModal, SaveError, TranslationStatusBadge, TranslationFields, fromTranslationForm, toTranslationForm, type TranslationField, type TranslationForm } from "./contentSync";

const BLANK = { code: "", title: "", description: "", estimated_minutes: "20" };
type Fields = { code?: string; title: string; description: string; estimated_minutes: string };

/** Mirrors the API rules (AssessmentIn) so mistakes are shown next to the field before saving. */
export function validateAssessment(f: Fields, t: (k: string) => string): Partial<Record<keyof Fields, string>> {
  const e: Partial<Record<keyof Fields, string>> = {};
  if (f.code !== undefined && !/^[a-z0-9_-]{2,48}$/.test(f.code)) e.code = t("assessments.errors.code");
  if (f.title.trim().length < 3 || f.title.trim().length > 160) e.title = t("assessments.errors.title");
  if (f.description.trim().length < 10) e.description = t("assessments.errors.description");
  const m = Number(f.estimated_minutes);
  if (f.estimated_minutes.trim() === "" || !Number.isInteger(m) || m < 1 || m > 240) e.estimated_minutes = t("assessments.errors.minutes");
  return e;
}
interface EditForm { id: number; lock_version: number; title: string; description: string; estimated_minutes: string; tr: TranslationForm }

export function AdminAssessments() {
  const { t } = useTranslation("adminContent");
  const { data, isLoading, error, refetch } = useAdminAssessments();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [edit, setEdit] = useState<EditForm | null>(null);
  const [initial, setInitial] = useState("");
  const [tried, setTried] = useState(false);
  const create = useAdminMutation(adminApi.createAssessment);
  const toggle = useAdminMutation((v: { a: AdminAssessment; is_active: boolean }) => adminApi.updateAssessment(v.a.id, { is_active: v.is_active, expected_version: v.a.lock_version }));
  const trFields: TranslationField[] = useMemo(() => [
    { key: "title", label: t("content.form.title") }, { key: "description", label: t("content.form.description"), multiline: true },
  ], [t]);
  const save = useAdminMutation((f: EditForm) => adminApi.updateAssessment(f.id, {
    title: f.title, description: f.description, estimated_minutes: Number(f.estimated_minutes), expected_version: f.lock_version,
    translations: fromTranslationForm(f.tr, trFields, (lang, field) => t("sync.translations.invalidJson", { lang, field })),
  }));
  const toast = useToast();
  const confirm = useConfirmAction();
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const createErrors = tried ? validateAssessment(form, t) : {};
  const editErrors = tried && edit ? validateAssessment(edit, t) : {};
  const createDirty = JSON.stringify(form) !== JSON.stringify(BLANK);
  const editDirty = !!edit && JSON.stringify(edit) !== initial;
  const submitCreate = () => {
    setTried(true);
    if (Object.keys(validateAssessment(form, t)).length) return;
    create.mutate({ ...form, code: form.code.trim(), title: form.title.trim(), description: form.description.trim(), estimated_minutes: Number(form.estimated_minutes), is_active: false },
      { onSuccess: () => { setOpen(false); setTried(false); toast({ title: t("assessments.created") }); } });
  };
  const submitEdit = () => {
    if (!edit) return;
    setTried(true);
    if (Object.keys(validateAssessment(edit, t)).length) return;
    save.mutate(edit, { onSuccess: () => { setEdit(null); setTried(false); toast({ title: t("assessments.saved") }); } });
  };
  const openEdit = (a: AdminAssessment) => {
    const f: EditForm = { id: a.id, lock_version: a.lock_version, title: a.title, description: a.description, estimated_minutes: String(a.estimated_minutes), tr: toTranslationForm(a.translations, trFields) };
    save.reset(); setTried(false); setEdit(f); setInitial(JSON.stringify(f));
  };
  const reload = async () => {
    const fresh = await refetch();
    const row = fresh.data?.find((a) => a.id === edit?.id);
    if (row) { openEdit(row); toast({ title: t("sync.conflict.reloaded") }); }
  };
  return (
    <>
      {confirm.dialog}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}><Button iconLeft="plus" onClick={() => { setForm(BLANK); setTried(false); create.reset(); setOpen(true); }}>{t("assessments.new")}</Button></div>
      {toggle.error && <div style={{ marginBottom: 16 }}><InlineAlert>{errorMessage(toggle.error)}</InlineAlert></div>}
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <thead><tr><th>{t("assessments.columns.assessment")}</th><th className="num">{t("assessments.columns.questions")}</th><th className="num">{t("assessments.columns.attempts")}</th><th className="num">{t("assessments.columns.version")}</th><th>{t("content.status")}</th><th><span className="isk-sr-only">{t("content.actions")}</span></th></tr></thead>
            <tbody>{data.length === 0 && (
              <tr><td colSpan={6}><EmptyState icon="clipboard-check" title={t("assessments.emptyTitle")} description={t("assessments.emptyText")} /></td></tr>
            )}{data.map((a) => (
              <tr key={a.id}>
                <td><b style={{ fontWeight: 500 }}>{a.title}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{a.code} · {t("common:time.minutes", { count: a.estimated_minutes })}</div></td>
                <td className="num">{formatNumber(a.question_count)}</td><td className="num">{formatNumber(a.attempt_count)}</td><td className="num">{t("common:format.version", { n: a.version })}</td>
                <td>{a.is_active ? <StatusBadge status="done">{t("content.active")}</StatusBadge> : <StatusBadge status="todo">{t("content.inactive")}</StatusBadge>} <TranslationStatusBadge status={a.translation_status} /></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Button size="sm" variant="ghost" iconLeft="pencil" onClick={() => openEdit(a)}>{t("common:actions.edit")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => a.is_active
                    ? confirm.ask({ title: t("assessments.deactivateTitle", { title: a.title }), description: t("assessments.deactivateText"), confirmLabel: t("content.deactivate"), success: t("assessments.deactivated"), run: () => toggle.mutateAsync({ a, is_active: false }) })
                    : toggle.mutate({ a, is_active: true }, { onSuccess: () => toast({ title: t("assessments.activated") }) })}>{a.is_active ? t("content.deactivate") : t("content.activate")}</Button>
                </td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="isk-hint" style={{ marginTop: 12 }}>{t("assessments.hint")}</p>
      <EditorModal open={open} dirty={createDirty} onDiscard={() => setOpen(false)} title={t("assessments.new")}
        footer={(requestClose) => <><Button variant="secondary" onClick={requestClose}>{t("common:actions.cancel")}</Button>
          <Button loading={create.isPending} onClick={submitCreate}>{t("common:actions.create")}</Button></>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {create.error && <InlineAlert>{errorMessage(create.error)}</InlineAlert>}
          <Input label={t("assessments.form.code")} hint={t("assessments.form.codeHint")} error={createErrors.code} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Input label={t("content.form.title")} error={createErrors.title} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label={t("content.form.description")} error={createErrors.description} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label={t("assessments.form.minutes")} error={createErrors.estimated_minutes} type="number" min="1" max="240" value={form.estimated_minutes} onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })} />
        </div>
      </EditorModal>
      <EditorModal open={!!edit} dirty={editDirty} onDiscard={() => setEdit(null)} title={t("assessments.edit")}
        footer={(requestClose) => <EditorFooter dirty={editDirty} saving={save.isPending} onCancel={requestClose} onReset={() => setEdit(JSON.parse(initial))} onSave={submitEdit} />}>
        {edit && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            <SaveError error={save.error} onReload={reload} />
            <Input label={t("content.form.title")} error={editErrors.title} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            <Textarea label={t("content.form.description")} error={editErrors.description} rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            <Input label={t("assessments.form.minutes")} error={editErrors.estimated_minutes} type="number" min="1" max="240" value={edit.estimated_minutes} onChange={(e) => setEdit({ ...edit, estimated_minutes: e.target.value })} />
            <TranslationFields fields={trFields} value={edit.tr} onChange={(tr) => setEdit({ ...edit, tr })} />
          </div>
        )}
      </EditorModal>
    </>
  );
}
