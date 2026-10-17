import { Button, Card, EmptyState, InlineAlert, Input, Select, Textarea } from "@isker/design-system";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminApi, useAdminCompetencies, useAdminMutation, type AdminCompetency, type ContentStatus } from "../../api/admin";
import { useCatalog } from "../../api/competencies";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import { formatNumber } from "../../utils/format";
import { ContentStatusBadge, EditorFooter, EditorModal, SaveError, TranslationStatusBadge, TranslationFields, fromTranslationForm, toTranslationForm, useStatusActions, useStatusOptions, type TranslationField, type TranslationForm } from "./contentSync";

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
  const catalog = useCatalog();
  /**
   * Area options come from the catalogue (GET /api/competencies lists every area, even one without competencies),
   * so a competency can be created in any area — also when there are none yet. Ids come from the catalogue when the
   * API includes them, otherwise from existing competencies of that area.
   */
  const areas = useMemo(() => {
    const idByCode = new Map<string, number>();
    for (const c of data ?? []) idByCode.set(c.area.code, c.area_id);
    const out: { value: string; label: string }[] = [];
    const seen = new Set<number>();
    for (const a of catalog.data?.areas ?? []) {
      const id = a.id ?? idByCode.get(a.code);
      if (id !== undefined && !seen.has(id)) { seen.add(id); out.push({ value: String(id), label: a.name }); }
    }
    for (const c of data ?? []) if (!seen.has(c.area_id)) { seen.add(c.area_id); out.push({ value: String(c.area_id), label: c.area.name }); }
    return out;
  }, [data, catalog.data]);
  if (isLoading || catalog.isLoading) return <PageSkeleton chart={false} />;
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
    if (!form.area_id) { setLocalError(t("competencies.errors.area")); return; }
    if (!form.id && !/^[a-z0-9_-]{2,}$/.test(form.code)) { setLocalError(t("competencies.errors.code")); return; }
    const nums: [string, number, number][] = [[form.importance, 0, 1], [form.learning_priority, 0, 1], [form.default_target, 40, 100]];
    if (nums.some(([v, min, max]) => v.trim() === "" || !Number.isFinite(Number(v)) || Number(v) < min || Number(v) > max)) { setLocalError(t("competencies.errors.numbers")); return; }
    try { fromTranslationForm(form.tr, trFields, (lang, field) => t("sync.translations.invalidJson", { lang, field })); } catch (e) { setLocalError((e as Error).message); return; }
    save.mutate(form, { onSuccess: () => { toast({ title: form.id ? t("competencies.updated") : t("competencies.created") }); setForm(null); } });
  };
  const set = (k: keyof Form) => (e: { target: { value: string } }) => form && setForm({ ...form, [k]: e.target.value });
  const rows = data.filter((c) => !filter || c.status === filter);
  const dirty = !!form && JSON.stringify(form) !== initial;

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
            <tbody>{rows.length === 0 && (
              <tr><td colSpan={6}><EmptyState icon="radar" title={data.length ? t("content.noMatchesTitle") : t("competencies.emptyTitle")}
                description={data.length ? t("content.noMatchesText") : t("competencies.emptyText")} /></td></tr>
            )}{rows.map((c) => (
              <tr key={c.id}>
                <td><b style={{ fontWeight: 500 }}>{c.name}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{c.code}</div></td>
                <td>{c.area.name}</td><td className="num">{formatNumber(c.importance)}</td><td className="num">{formatNumber(c.default_target)}</td>
                <td><ContentStatusBadge status={c.status} /> <TranslationStatusBadge status={c.translation_status} /></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Button size="sm" variant="ghost" iconLeft="pencil" onClick={() => open(c)}>{t("common:actions.edit")}</Button>
                  {status.buttons({ entity: "competencies", id: c.id, status: c.status as ContentStatus, lock_version: c.lock_version, title: c.name })}
                </td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Card>
      <EditorModal open={!!form} dirty={dirty} onDiscard={() => setForm(null)} title={form?.id ? t("competencies.editTitle", { name: form.name }) : t("competencies.new")}
        footer={(requestClose) => <EditorFooter dirty={dirty} saving={save.isPending} onCancel={requestClose} onReset={() => setForm(JSON.parse(initial))} onSave={submit} />}>
        {form && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            <SaveError error={save.error} local={localError} onReload={reload} />
            {!form.id && <Input label={t("competencies.form.code")} hint={t("competencies.form.codeHint")} value={form.code} onChange={set("code")} />}
            {areas.length === 0 && <InlineAlert tone="warning">{t("competencies.noAreas")}</InlineAlert>}
            <Select label={t("competencies.columns.area")} value={form.area_id} onChange={set("area_id")} options={areas} placeholder={areas.length ? undefined : t("competencies.noAreasShort")} />
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
      </EditorModal>
    </>
  );
}
