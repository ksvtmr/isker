import { Button, Card, EmptyState, Input, Select, Tabs, Textarea, tabPanelProps } from "@isker/design-system";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminApi, useAdminCompetencies, useAdminMutation, useAdminResources, useAdminTasks, type AdminResource, type AdminTask, type ContentStatus, type ResourceInput, type TaskInput } from "../../api/admin";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import type { Difficulty, ResourceType } from "../../types/api";
import { difficultyLabel, formatNumber, resourceTypeLabel } from "../../utils/format";
import { RUBRIC_EXAMPLE } from "./AdminQuestions";
import { ContentStatusBadge, EditorFooter, EditorModal, SaveError, TranslationStatusBadge, TranslationFields, fromTranslationForm, toTranslationForm, useStatusActions, useStatusOptions, type TranslationField, type TranslationForm } from "./contentSync";

const RESOURCE_TYPES: ResourceType[] = ["article", "video", "course", "exercise", "case_study", "template"];
const DIFFICULTIES: Difficulty[] = ["beginner", "intermediate", "advanced"];

type RForm = ResourceInput & { id?: number; lock_version?: number; tr: TranslationForm };
type TForm = TaskInput & { id?: number; lock_version?: number; rubricText: string; tr: TranslationForm };

const R_BLANK: ResourceInput = { slug: "", competency_id: 0, title: "", description: "", type: "article", difficulty: "beginner", duration_minutes: 10, content: "", url: null, status: "draft" };
const T_BLANK: TaskInput = { slug: "", competency_id: 0, title: "", description: "", instructions: "", difficulty: "beginner", duration_minutes: 20, rubric: [], min_length: 80, status: "draft" };

const R_KEYS = ["slug", "competency_id", "title", "description", "type", "difficulty", "duration_minutes", "content", "url"] as const;
const T_KEYS = ["slug", "competency_id", "title", "description", "instructions", "difficulty", "duration_minutes", "min_length"] as const;
const pick = <T extends object, K extends keyof T>(o: T, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

export function AdminResources() {
  const { t } = useTranslation("adminContent");
  const [tab, setTab] = useState("resources");
  const [filter, setFilter] = useState("");
  const comps = useAdminCompetencies();
  const res = useAdminResources();
  const tasks = useAdminTasks();
  const toast = useToast();
  const [r, setR] = useState<RForm | null>(null);
  const [task, setTask] = useState<TForm | null>(null);
  const [initial, setInitial] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const invalidJson = (lang: string, field: string) => t("sync.translations.invalidJson", { lang, field });
  const rFields: TranslationField[] = useMemo(() => [
    { key: "title", label: t("content.form.title") }, { key: "description", label: t("content.form.description"), multiline: true },
    { key: "content", label: t("resources.form.content"), multiline: true, rows: 6 },
  ], [t]);
  const tFields: TranslationField[] = useMemo(() => [
    { key: "title", label: t("content.form.title") }, { key: "description", label: t("content.form.description"), multiline: true },
    { key: "instructions", label: t("tasks.form.instructions"), multiline: true, rows: 4 },
    { key: "rubric", label: t("sync.translations.rubric"), json: true, hint: t("sync.translations.rubricHint") },
  ], [t]);
  const saveR = useAdminMutation((v: RForm) => {
    const body: ResourceInput = { ...pick(v, R_KEYS), translations: fromTranslationForm(v.tr, rFields, invalidJson) };
    return v.id ? adminApi.updateResource(v.id, { ...body, expected_version: v.lock_version }) : adminApi.createResource({ ...body, status: v.status });
  });
  const saveT = useAdminMutation((v: TForm) => {
    const body: TaskInput = { ...pick(v, T_KEYS), rubric: JSON.parse(v.rubricText), translations: fromTranslationForm(v.tr, tFields, invalidJson) };
    return v.id ? adminApi.updateTask(v.id, { ...body, expected_version: v.lock_version }) : adminApi.createTask({ ...body, status: v.status });
  });
  const status = useStatusActions();
  const statusOpts = useStatusOptions();

  if (comps.isLoading || res.isLoading || tasks.isLoading) return <PageSkeleton chart={false} />;
  if (res.error || tasks.error || !res.data || !tasks.data) return <ErrorState error={res.error ?? tasks.error} onRetry={() => { res.refetch(); tasks.refetch(); }} />;
  const compOpts = (comps.data ?? []).map((c) => ({ value: String(c.id), label: c.name }));
  const compName = (id: number) => comps.data?.find((c) => c.id === id)?.name ?? "—";
  const typeOpts = RESOURCE_TYPES.map((value) => ({ value, label: resourceTypeLabel(value) }));
  const diffOpts = DIFFICULTIES.map((value) => ({ value, label: difficultyLabel(value) }));

  const openR = (x?: AdminResource) => {
    const f: RForm = x ? { ...pick(x, R_KEYS), id: x.id, lock_version: x.lock_version, status: x.status, tr: toTranslationForm(x.translations, rFields) }
      : { ...R_BLANK, competency_id: comps.data?.[0]?.id ?? 0, tr: toTranslationForm(null, rFields) };
    setLocalError(null); saveR.reset(); setR(f); setInitial(JSON.stringify(f));
  };
  const openT = (x?: AdminTask) => {
    const f: TForm = x ? { ...pick(x, T_KEYS), rubric: x.rubric, id: x.id, lock_version: x.lock_version, status: x.status, rubricText: JSON.stringify(x.rubric, null, 2), tr: toTranslationForm(x.translations, tFields) }
      : { ...T_BLANK, competency_id: comps.data?.[0]?.id ?? 0, rubricText: "[]", tr: toTranslationForm(null, tFields) };
    setLocalError(null); saveT.reset(); setTask(f); setInitial(JSON.stringify(f));
  };
  const reloadR = async () => { const fresh = await res.refetch(); const row = fresh.data?.find((x) => x.id === r?.id); if (row) { openR(row); toast({ title: t("sync.conflict.reloaded") }); } };
  const reloadT = async () => { const fresh = await tasks.refetch(); const row = fresh.data?.find((x) => x.id === task?.id); if (row) { openT(row); toast({ title: t("sync.conflict.reloaded") }); } };
  /** Shared checks before saving (the API re-validates): a competency, a positive duration, a valid slug. */
  const basicError = (v: { competency_id: number; duration_minutes: number; slug: string; title: string }) => {
    if (!v.competency_id) return t("content.errors.competency");
    if (!Number.isFinite(v.duration_minutes) || v.duration_minutes < 1) return t("content.errors.duration");
    if (!/^[a-z0-9-]{2,}$/.test(v.slug)) return t("content.errors.slug");
    if (v.title.trim().length < 3) return t("content.errors.title");
    return null;
  };
  const submitR = () => {
    if (!r) return;
    setLocalError(null);
    const bad = basicError(r);
    if (bad) { setLocalError(bad); return; }
    try { fromTranslationForm(r.tr, rFields, invalidJson); } catch (e) { setLocalError((e as Error).message); return; }
    saveR.mutate(r, { onSuccess: () => { setR(null); toast({ title: t("resources.saved") }); } });
  };
  const submitT = () => {
    if (!task) return;
    setLocalError(null);
    const bad = basicError(task) ?? (!Number.isFinite(task.min_length) || task.min_length < 0 ? t("content.errors.minLength") : null);
    if (bad) { setLocalError(bad); return; }
    try { JSON.parse(task.rubricText); } catch { setLocalError(t("content.rubricInvalid")); return; }
    try { fromTranslationForm(task.tr, tFields, invalidJson); } catch (e) { setLocalError((e as Error).message); return; }
    saveT.mutate(task, { onSuccess: () => { setTask(null); toast({ title: t("tasks.saved") }); } });
  };
  const rRows = res.data.filter((x) => !filter || x.status === filter);
  const tRows = tasks.data.filter((x) => !filter || x.status === filter);
  const rDirty = !!r && JSON.stringify(r) !== initial;
  const tDirty = !!task && JSON.stringify(task) !== initial;
  const all = tab === "resources" ? res.data.length : tasks.data.length;
  const shown = tab === "resources" ? rRows.length : tRows.length;
  return (
    <>
      {status.dialog}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Tabs id="admin-learning" ariaLabel={t("resources.tabsLabel")} value={tab} onChange={setTab} tabs={[{ value: "resources", label: t("resources.tabResources", { n: formatNumber(res.data.length) }) }, { value: "tasks", label: t("resources.tabTasks", { n: formatNumber(tasks.data.length) }) }]} />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ width: 200 }}><Select aria-label={t("sync.filterStatus")} placeholder={t("sync.allStatuses")} value={filter} onChange={(e) => setFilter(e.target.value)} options={statusOpts} /></div>
          <Button iconLeft="plus" onClick={() => (tab === "resources" ? openR() : openT())}>{tab === "resources" ? t("resources.new") : t("tasks.new")}</Button>
        </div>
      </div>
      <Card style={{ overflow: "hidden" }} {...tabPanelProps("admin-learning", tab)}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <thead><tr><th>{t("content.form.title")}</th><th>{t("content.form.competency")}</th><th>{tab === "resources" ? t("resources.columns.type") : t("tasks.columns.rubric")}</th><th>{t("content.form.difficulty")}</th><th className="num">{t("resources.columns.minutes")}</th><th>{t("content.status")}</th><th><span className="isk-sr-only">{t("content.actions")}</span></th></tr></thead>
            <tbody>
              {shown === 0 && (
                <tr><td colSpan={7}><EmptyState icon="library" title={all ? t("content.noMatchesTitle") : tab === "resources" ? t("resources.emptyTitle") : t("tasks.emptyTitle")}
                  description={all ? t("content.noMatchesText") : tab === "resources" ? t("resources.emptyText") : t("tasks.emptyText")} /></td></tr>
              )}
              {tab === "resources" ? rRows.map((x: AdminResource) => (
                <tr key={x.id}><td><b style={{ fontWeight: 500 }}>{x.title}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{x.slug}</div></td><td>{compName(x.competency_id)}</td>
                  <td>{resourceTypeLabel(x.type)}</td><td>{difficultyLabel(x.difficulty)}</td><td className="num">{x.duration_minutes}</td><td><ContentStatusBadge status={x.status} /> <TranslationStatusBadge status={x.translation_status} /></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><Button size="sm" variant="ghost" onClick={() => openR(x)}>{t("common:actions.edit")}</Button>
                    {status.buttons({ entity: "resources", id: x.id, status: x.status as ContentStatus, lock_version: x.lock_version, title: x.title })}</td></tr>
              )) : tRows.map((x: AdminTask) => (
                <tr key={x.id}><td><b style={{ fontWeight: 500 }}>{x.title}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{x.slug}</div></td><td>{compName(x.competency_id)}</td>
                  <td>{t("tasks.criteria", { count: x.rubric.length })}</td><td>{difficultyLabel(x.difficulty)}</td><td className="num">{x.duration_minutes}</td><td><ContentStatusBadge status={x.status} /> <TranslationStatusBadge status={x.translation_status} /></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><Button size="sm" variant="ghost" onClick={() => openT(x)}>{t("common:actions.edit")}</Button>
                    {status.buttons({ entity: "tasks", id: x.id, status: x.status as ContentStatus, lock_version: x.lock_version, title: x.title })}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <EditorModal open={!!r} dirty={rDirty} onDiscard={() => setR(null)} title={r?.id ? t("resources.edit") : t("resources.new")}
        footer={(requestClose) => <EditorFooter dirty={rDirty} saving={saveR.isPending} onCancel={requestClose} onReset={() => setR(JSON.parse(initial))} onSave={submitR} />}>
        {r && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            <SaveError error={saveR.error} local={localError} onReload={reloadR} />
            <Input label={t("content.form.title")} value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} />
            <Input label={t("content.form.slug")} hint={t("content.form.slugHint")} value={r.slug} onChange={(e) => setR({ ...r, slug: e.target.value })} />
            <Select label={t("content.form.competency")} value={String(r.competency_id)} onChange={(e) => setR({ ...r, competency_id: Number(e.target.value) })} options={compOpts} />
            <div className="ik-form2">
              <Select label={t("resources.columns.type")} value={r.type} onChange={(e) => setR({ ...r, type: e.target.value as ResourceInput["type"] })} options={typeOpts} />
              <Select label={t("content.form.difficulty")} value={r.difficulty} onChange={(e) => setR({ ...r, difficulty: e.target.value as ResourceInput["difficulty"] })} options={diffOpts} />
            </div>
            <Input label={t("content.form.duration")} type="number" min="1" value={String(r.duration_minutes)} onChange={(e) => setR({ ...r, duration_minutes: Number(e.target.value) })} />
            <Textarea label={t("content.form.description")} rows={2} value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} />
            <Textarea label={t("resources.form.content")} rows={8} value={r.content} onChange={(e) => setR({ ...r, content: e.target.value })} />
            <Input label={t("resources.form.url")} value={r.url ?? ""} onChange={(e) => setR({ ...r, url: e.target.value || null })} />
            <TranslationFields fields={rFields} value={r.tr} onChange={(tr) => setR({ ...r, tr })} />
            {!r.id && <p className="isk-hint">{t("sync.draftHint")}</p>}
          </div>
        )}
      </EditorModal>
      <EditorModal open={!!task} dirty={tDirty} onDiscard={() => setTask(null)} title={task?.id ? t("tasks.edit") : t("tasks.new")}
        footer={(requestClose) => <EditorFooter dirty={tDirty} saving={saveT.isPending} onCancel={requestClose} onReset={() => setTask(JSON.parse(initial))} onSave={submitT} />}>
        {task && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            <SaveError error={saveT.error} local={localError} onReload={reloadT} />
            <Input label={t("content.form.title")} value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
            <Input label={t("content.form.slug")} value={task.slug} onChange={(e) => setTask({ ...task, slug: e.target.value })} />
            <Select label={t("content.form.competency")} value={String(task.competency_id)} onChange={(e) => setTask({ ...task, competency_id: Number(e.target.value) })} options={compOpts} />
            <div className="ik-form2">
              <Select label={t("content.form.difficulty")} value={task.difficulty} onChange={(e) => setTask({ ...task, difficulty: e.target.value as TaskInput["difficulty"] })} options={diffOpts} />
              <Input label={t("content.form.duration")} type="number" min="1" value={String(task.duration_minutes)} onChange={(e) => setTask({ ...task, duration_minutes: Number(e.target.value) })} />
            </div>
            <Textarea label={t("content.form.description")} rows={2} value={task.description} onChange={(e) => setTask({ ...task, description: e.target.value })} />
            <Textarea label={t("tasks.form.instructions")} rows={4} value={task.instructions} onChange={(e) => setTask({ ...task, instructions: e.target.value })} />
            <Input label={t("tasks.form.minLength")} type="number" min="0" value={String(task.min_length)} onChange={(e) => setTask({ ...task, min_length: Number(e.target.value) })} />
            <Textarea label={t("content.form.rubric")} rows={6} hint={<>{t("content.form.rubricHint")} <code>{RUBRIC_EXAMPLE}</code></>} value={task.rubricText} onChange={(e) => setTask({ ...task, rubricText: e.target.value })} />
            <TranslationFields fields={tFields} value={task.tr} onChange={(tr) => setTask({ ...task, tr })} />
            {!task.id && <p className="isk-hint">{t("sync.draftHint")}</p>}
          </div>
        )}
      </EditorModal>
    </>
  );
}
