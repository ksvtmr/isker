import { Button, Card, Input, Modal, Select, Textarea } from "@isker/design-system";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminApi, useAdminCompetencies, useAdminMutation, type AdminCompetency, type ContentStatus } from "../../api/admin";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import { formatNumber } from "../../utils/format";
import { ContentStatusBadge, EditorFooter, SaveError, TranslationFields, fromTranslationForm, toTranslationForm, useStatusActions, useStatusOptions, type TranslationField, type TranslationForm } from "./contentSync";

interface Form {
  id?: number; lock_version?: number; code: string; area_id: string; name: string; short_name: string; description: string; hint: string; reflection_prompt: string;
  importance: string; learning_priority: string; default_target: string; tr: TranslationForm;
}

export function AdminCompetencies() {
  const { t } = useTranslation("adminContent");
  const { data, isLoading, error, refetch } = useAdminCompetencies();
  const [form, setForm] = useState<Form | null>(null);
  const [initial, setInitial] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const save = useAdminMutation((f: Form) => {
    const translations = fromTranslationForm(f.tr, trFields, (lang, field) => t("sync.translations.invalidJson", { lang, field }));
    const body = { area_id: Number(f.area_id), name: f.name, short_name: f.short_name, description: f.description, hint: f.hint || null, reflection_prompt: f.reflection_prompt || null,
      importance: Number(f.importance), learning_priority: Number(f.learning_priority), default_target: Number(f.default_target), translations };
    return f.id ? adminApi.updateCompetency(f.id, { ...body, expected_version: f.lock_version }) : adminApi.createCompetency({ ...body, code: f.code, status: "draft" });
  });
  const status = useStatusActions();
  const statusOpts = useStatusOptions();
  const toast = useToast();
  const trFields: TranslationField[] = useMemo(() => [
    { key: "name", label: t("competencies.form.name") }, { key: "short_name", label: t("competencies.form.shortName") },
    { key: "description", label: t("content.form.description"), multiline: true }, { key: "hint", label: t("competencies.form.hint"), multiline: true },
    { key: "reflection_prompt", label: t("competencies.form.reflectionPrompt"), multiline: true },
  ], [t]);
  const areas = useMemo(() => {
    const seen = new Map<number, string>();
    for (const c of data ?? []) seen.set(c.area_id, c.area.name);
    return [...seen].map(([value, label]) => ({ value: String(value), label }));
  }, [data]);
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const toForm = (c?: AdminCompetency): Form => ({
    id: c?.id, lock_version: c?.lock_version, code: c?.code ?? "", area_id: String(c?.area_id ?? areas[0]?.value ?? ""), name: c?.name ?? "", short_name: c?.short_name ?? "",
    description: c?.description ?? "", hint: c?.hint ?? "", reflection_prompt: c?.reflection_prompt ?? "", importance: String(c?.importance ?? 0.5),
    learning_priority: String(c?.learning_priority ?? 0.5), default_target: String(c?.default_target ?? 70), tr: toTranslationForm(c?.translations, trFields),
  });
  const open = (c?: AdminCompetency) => { const f = toForm(c); setForm(f); setInitial(JSON.stringify(f)); setLocalError(null); save.reset(); };
  const reload = async () => {
    const fresh = await refetch();
    const row = fresh.data?.find((c) => c.id === form?.id);
    if (row) { open(row); toast({ title: t("sync.conflict.reloaded") }); }
  };
  const submit = () => {
    if (!form) return;
    setLocalError(null);
    try { fromTranslationForm(form.tr, trFields, (lang, field) => t("sync.translations.invalidJson", { lang, field })); } catch (e) { setLocalError((e as Error).message); return; }
    save.mutate(form, { onSuccess: () => { toast({ title: form.id ? t("competencies.updated") : t("competencies.created") }); setForm(null); } });
  };
  const set = (k: keyof Form) => (e: { target: { value: string } }) => form && setForm({ ...form, [k]: e.target.value });
  const rows = data.filter((c) => !filter || c.status === filter);

  return (
    <>
      {status.dialog}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ width: 220 }}><Select aria-label={t("sync.filterStatus")} placeholder={t("sync.allStatuses")} value={filter} onChange={(e) => setFilter(e.target.value)} options={statusOpts} /></div>
        <Button iconLeft="plus" onClick={() => open()}>{t("competencies.new")}</Button>
      </div>
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <thead><tr><th>{t("competencies.columns.competency")}</th><th>{t("competencies.columns.area")}</th><th className="num">{t("competencies.columns.importance")}</th><th className="num">{t("competencies.columns.defaultTarget")}</th><th>{t("content.status")}</th><th><span className="isk-sr-only">{t("content.actions")}</span></th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td><b style={{ fontWeight: 500 }}>{c.name}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{c.code}</div></td>
                <td>{c.area.name}</td><td className="num">{formatNumber(c.importance)}</td><td className="num">{formatNumber(c.default_target)}</td>
                <td><ContentStatusBadge status={c.status} /></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Button size="sm" variant="ghost" iconLeft="pencil" onClick={() => open(c)}>{t("common:actions.edit")}</Button>
                  {status.buttons({ entity: "competencies", id: c.id, status: c.status as ContentStatus, lock_version: c.lock_version, title: c.name })}
                </td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t("competencies.editTitle", { name: form.name }) : t("competencies.new")}
        footer={<EditorFooter dirty={!!form && JSON.stringify(form) !== initial} saving={save.isPending} onCancel={() => setForm(null)} onReset={() => setForm(JSON.parse(initial))} onSave={submit} />}>
        {form && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            <SaveError error={save.error} local={localError} onReload={reload} />
            {!form.id && <Input label={t("competencies.form.code")} hint={t("competencies.form.codeHint")} value={form.code} onChange={set("code")} />}
            <Select label={t("competencies.columns.area")} value={form.area_id} onChange={set("area_id")} options={areas} />
            <Input label={t("competencies.form.name")} value={form.name} onChange={set("name")} />
            <Input label={t("competencies.form.shortName")} value={form.short_name} onChange={set("short_name")} />
            <Textarea label={t("content.form.description")} rows={4} value={form.description} onChange={set("description")} />
            <Textarea label={t("competencies.form.hint")} rows={2} value={form.hint} onChange={set("hint")} />
            <Textarea label={t("competencies.form.reflectionPrompt")} rows={2} value={form.reflection_prompt} onChange={set("reflection_prompt")} />
            <div className="ik-form2">
              <Input label={t("competencies.form.importance")} type="number" step="0.05" min="0" max="1" value={form.importance} onChange={set("importance")} />
              <Input label={t("competencies.form.learningPriority")} type="number" step="0.05" min="0" max="1" value={form.learning_priority} onChange={set("learning_priority")} />
            </div>
            <Input label={t("competencies.columns.defaultTarget")} type="number" min="40" max="100" value={form.default_target} onChange={set("default_target")} />
            <TranslationFields fields={trFields} value={form.tr} onChange={(tr) => setForm({ ...form, tr })} />
            {!form.id && <p className="isk-hint">{t("sync.draftHint")}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}
