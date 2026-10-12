import { Button, Card, Checkbox, InlineAlert, Input, Modal, Select, StatusBadge, Tabs, Textarea } from "@isker/design-system";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { adminApi, useAdminCompetencies, useAdminMutation, useAdminResources, useAdminTasks, type AdminResource, type AdminTask, type ResourceInput, type TaskInput } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useConfirmAction } from "./common";
import { useToast } from "../../components/Toaster";
import type { Difficulty, ResourceType } from "../../types/api";
import { difficultyLabel, formatNumber, resourceTypeLabel } from "../../utils/format";

const RESOURCE_TYPES: ResourceType[] = ["article", "video", "course", "exercise", "case_study", "template"];
const DIFFICULTIES: Difficulty[] = ["beginner", "intermediate", "advanced"];

const R_BLANK: ResourceInput = { slug: "", competency_id: 0, title: "", description: "", type: "article", difficulty: "beginner", duration_minutes: 10, content: "", url: null, is_published: true };
const T_BLANK: TaskInput = { slug: "", competency_id: 0, title: "", description: "", instructions: "", difficulty: "beginner", duration_minutes: 20, rubric: [], min_length: 80, is_published: true };

export function AdminResources() {
  const { t } = useTranslation("adminContent");
  const [tab, setTab] = useState("resources");
  const comps = useAdminCompetencies();
  const res = useAdminResources();
  const tasks = useAdminTasks();
  const toast = useToast();
  const [r, setR] = useState<(ResourceInput & { id?: number }) | null>(null);
  const [task, setTask] = useState<(TaskInput & { id?: number; rubricText: string }) | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const saveR = useAdminMutation((v: ResourceInput & { id?: number }) => { const { id, ...body } = v; return id ? adminApi.updateResource(id, body) : adminApi.createResource(body); });
  const saveT = useAdminMutation((v: TaskInput & { id?: number }) => { const { id, ...body } = v; return id ? adminApi.updateTask(id, body) : adminApi.createTask(body); });
  const unpubR = useAdminMutation(adminApi.unpublishResource);
  const unpubT = useAdminMutation(adminApi.unpublishTask);
  const confirm = useConfirmAction();

  if (comps.isLoading || res.isLoading || tasks.isLoading) return <PageSkeleton chart={false} />;
  if (res.error || tasks.error || !res.data || !tasks.data) return <ErrorState error={res.error ?? tasks.error} onRetry={() => { res.refetch(); tasks.refetch(); }} />;
  const compOpts = (comps.data ?? []).map((c) => ({ value: String(c.id), label: c.name }));
  const compName = (id: number) => comps.data?.find((c) => c.id === id)?.name ?? "—";
  const typeOpts = RESOURCE_TYPES.map((value) => ({ value, label: resourceTypeLabel(value) }));
  const diffOpts = DIFFICULTIES.map((value) => ({ value, label: difficultyLabel(value) }));
  const err = localError ?? (saveR.error || saveT.error ? errorMessage(saveR.error ?? saveT.error) : null);

  const submitT = () => {
    if (!task) return;
    try {
      setLocalError(null);
      const { rubricText, ...rest } = task;
      saveT.mutate({ ...rest, rubric: JSON.parse(rubricText) }, { onSuccess: () => { setTask(null); toast({ title: t("tasks.saved") }); } });
    } catch { setLocalError(t("content.rubricInvalid")); }
  };

  const status = (p: boolean) => (p ? <StatusBadge status="done">{t("content.published")}</StatusBadge> : <StatusBadge status="todo">{t("content.unpublished")}</StatusBadge>);
  return (
    <>
      {confirm.dialog}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Tabs ariaLabel={t("resources.tabsLabel")} value={tab} onChange={setTab} tabs={[{ value: "resources", label: t("resources.tabResources", { n: formatNumber(res.data.length) }) }, { value: "tasks", label: t("resources.tabTasks", { n: formatNumber(tasks.data.length) }) }]} />
        <Button iconLeft="plus" onClick={() => {
          setLocalError(null);
          const competency_id = comps.data?.[0]?.id ?? 0;
          if (tab === "resources") setR({ ...R_BLANK, competency_id });
          else setTask({ ...T_BLANK, competency_id, rubricText: "[]" });
        }}>
          {tab === "resources" ? t("resources.new") : t("tasks.new")}
        </Button>
      </div>
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <thead><tr><th>{t("content.form.title")}</th><th>{t("content.form.competency")}</th><th>{tab === "resources" ? t("resources.columns.type") : t("tasks.columns.rubric")}</th><th>{t("content.form.difficulty")}</th><th className="num">{t("resources.columns.minutes")}</th><th>{t("content.status")}</th><th><span className="isk-sr-only">{t("content.actions")}</span></th></tr></thead>
            <tbody>
              {tab === "resources" ? res.data.map((x: AdminResource) => (
                <tr key={x.id}><td><b style={{ fontWeight: 500 }}>{x.title}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{x.slug}</div></td><td>{compName(x.competency_id)}</td>
                  <td>{resourceTypeLabel(x.type)}</td><td>{difficultyLabel(x.difficulty)}</td><td className="num">{x.duration_minutes}</td><td>{status(x.is_published)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><Button size="sm" variant="ghost" onClick={() => { setLocalError(null); setR(x); }}>{t("common:actions.edit")}</Button>
                    {x.is_published && <Button size="sm" variant="ghost" onClick={() => confirm.ask({ title: t("content.unpublishTitle", { title: x.title }), description: t("resources.unpublishText"), confirmLabel: t("content.unpublish"), success: t("resources.unpublished"), run: () => unpubR.mutateAsync(x.id) })}>{t("content.unpublish")}</Button>}</td></tr>
              )) : tasks.data.map((x: AdminTask) => (
                <tr key={x.id}><td><b style={{ fontWeight: 500 }}>{x.title}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{x.slug}</div></td><td>{compName(x.competency_id)}</td>
                  <td>{t("tasks.criteria", { count: x.rubric.length })}</td><td>{difficultyLabel(x.difficulty)}</td><td className="num">{x.duration_minutes}</td><td>{status(x.is_published)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><Button size="sm" variant="ghost" onClick={() => { setLocalError(null); setTask({ ...x, rubricText: JSON.stringify(x.rubric, null, 2) }); }}>{t("common:actions.edit")}</Button>
                    {x.is_published && <Button size="sm" variant="ghost" onClick={() => confirm.ask({ title: t("content.unpublishTitle", { title: x.title }), description: t("tasks.unpublishText"), confirmLabel: t("content.unpublish"), success: t("tasks.unpublished"), run: () => unpubT.mutateAsync(x.id) })}>{t("content.unpublish")}</Button>}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!r} onClose={() => setR(null)} title={r?.id ? t("resources.edit") : t("resources.new")}
        footer={<><Button variant="secondary" onClick={() => setR(null)}>{t("common:actions.cancel")}</Button><Button loading={saveR.isPending} onClick={() => r && saveR.mutate(r, { onSuccess: () => { setR(null); toast({ title: t("resources.saved") }); } })}>{t("common:actions.save")}</Button></>}>
        {r && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            {err && <InlineAlert>{err}</InlineAlert>}
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
            <Checkbox label={t("content.published")} checked={r.is_published} onChange={(e) => setR({ ...r, is_published: e.target.checked })} />
          </div>
        )}
      </Modal>
      <Modal open={!!task} onClose={() => setTask(null)} title={task?.id ? t("tasks.edit") : t("tasks.new")}
        footer={<><Button variant="secondary" onClick={() => setTask(null)}>{t("common:actions.cancel")}</Button><Button loading={saveT.isPending} onClick={submitT}>{t("common:actions.save")}</Button></>}>
        {task && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            {err && <InlineAlert>{err}</InlineAlert>}
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
            <Textarea label={t("content.form.rubric")} rows={6} value={task.rubricText} onChange={(e) => setTask({ ...task, rubricText: e.target.value })} />
            <Checkbox label={t("content.published")} checked={task.is_published} onChange={(e) => setTask({ ...task, is_published: e.target.checked })} />
          </div>
        )}
      </Modal>
    </>
  );
}
