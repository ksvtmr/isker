import { Button, Card, Checkbox, InlineAlert, Input, Modal, Select, StatusBadge, Tabs, Textarea } from "@isker/design-system";
import { useState } from "react";
import { adminApi, useAdminCompetencies, useAdminMutation, useAdminResources, useAdminTasks, type AdminResource, type AdminTask, type ResourceInput, type TaskInput } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import { DIFFICULTY_LABEL, RESOURCE_TYPE_LABEL } from "../../utils/format";

const R_BLANK: ResourceInput = { slug: "", competency_id: 0, title: "", description: "", type: "article", difficulty: "beginner", duration_minutes: 10, content: "", url: null, is_published: true };
const T_BLANK: TaskInput = { slug: "", competency_id: 0, title: "", description: "", instructions: "", difficulty: "beginner", duration_minutes: 20, rubric: [], min_length: 80, is_published: true };

export function AdminResources() {
  const [tab, setTab] = useState("resources");
  const comps = useAdminCompetencies();
  const res = useAdminResources();
  const tasks = useAdminTasks();
  const toast = useToast();
  const [r, setR] = useState<(ResourceInput & { id?: number }) | null>(null);
  const [t, setT] = useState<(TaskInput & { id?: number; rubricText: string }) | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const saveR = useAdminMutation((v: ResourceInput & { id?: number }) => { const { id, ...body } = v; return id ? adminApi.updateResource(id, body) : adminApi.createResource(body); });
  const saveT = useAdminMutation((v: TaskInput & { id?: number }) => { const { id, ...body } = v; return id ? adminApi.updateTask(id, body) : adminApi.createTask(body); });
  const unpubR = useAdminMutation(adminApi.unpublishResource);
  const unpubT = useAdminMutation(adminApi.unpublishTask);

  if (comps.isLoading || res.isLoading || tasks.isLoading) return <PageSkeleton chart={false} />;
  if (res.error || tasks.error || !res.data || !tasks.data) return <ErrorState error={res.error ?? tasks.error} onRetry={() => { res.refetch(); tasks.refetch(); }} />;
  const compOpts = (comps.data ?? []).map((c) => ({ value: String(c.id), label: c.name }));
  const compName = (id: number) => comps.data?.find((c) => c.id === id)?.name ?? "—";
  const typeOpts = Object.entries(RESOURCE_TYPE_LABEL).map(([value, label]) => ({ value, label }));
  const diffOpts = Object.entries(DIFFICULTY_LABEL).map(([value, label]) => ({ value, label }));
  const err = localError ?? (saveR.error || saveT.error ? errorMessage(saveR.error ?? saveT.error) : null);

  const submitT = () => {
    if (!t) return;
    try {
      setLocalError(null);
      const { rubricText, ...rest } = t;
      saveT.mutate({ ...rest, rubric: JSON.parse(rubricText) }, { onSuccess: () => { setT(null); toast({ title: "Task saved" }); } });
    } catch { setLocalError("Rubric must be valid JSON."); }
  };

  const status = (p: boolean) => (p ? <StatusBadge status="done">Published</StatusBadge> : <StatusBadge status="todo">Unpublished</StatusBadge>);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Tabs ariaLabel="Content type" value={tab} onChange={setTab} tabs={[{ value: "resources", label: `Learning resources (${res.data.length})` }, { value: "tasks", label: `Practical tasks (${tasks.data.length})` }]} />
        <Button iconLeft="plus" onClick={() => {
          setLocalError(null);
          const competency_id = comps.data?.[0]?.id ?? 0;
          if (tab === "resources") setR({ ...R_BLANK, competency_id });
          else setT({ ...T_BLANK, competency_id, rubricText: "[]" });
        }}>
          {tab === "resources" ? "New resource" : "New task"}
        </Button>
      </div>
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <thead><tr><th>Title</th><th>Competency</th><th>{tab === "resources" ? "Type" : "Rubric"}</th><th>Difficulty</th><th className="num">Minutes</th><th>Status</th><th /></tr></thead>
            <tbody>
              {tab === "resources" ? res.data.map((x: AdminResource) => (
                <tr key={x.id}><td><b style={{ fontWeight: 500 }}>{x.title}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{x.slug}</div></td><td>{compName(x.competency_id)}</td>
                  <td>{RESOURCE_TYPE_LABEL[x.type]}</td><td>{DIFFICULTY_LABEL[x.difficulty]}</td><td className="num">{x.duration_minutes}</td><td>{status(x.is_published)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><Button size="sm" variant="ghost" onClick={() => { setLocalError(null); setR(x); }}>Edit</Button>
                    {x.is_published && <Button size="sm" variant="ghost" onClick={() => unpubR.mutate(x.id)}>Unpublish</Button>}</td></tr>
              )) : tasks.data.map((x: AdminTask) => (
                <tr key={x.id}><td><b style={{ fontWeight: 500 }}>{x.title}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{x.slug}</div></td><td>{compName(x.competency_id)}</td>
                  <td>{x.rubric.length} criteria</td><td>{DIFFICULTY_LABEL[x.difficulty]}</td><td className="num">{x.duration_minutes}</td><td>{status(x.is_published)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><Button size="sm" variant="ghost" onClick={() => { setLocalError(null); setT({ ...x, rubricText: JSON.stringify(x.rubric, null, 2) }); }}>Edit</Button>
                    {x.is_published && <Button size="sm" variant="ghost" onClick={() => unpubT.mutate(x.id)}>Unpublish</Button>}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!r} onClose={() => setR(null)} title={r?.id ? "Edit resource" : "New resource"}
        footer={<><Button variant="secondary" onClick={() => setR(null)}>Cancel</Button><Button loading={saveR.isPending} onClick={() => r && saveR.mutate(r, { onSuccess: () => { setR(null); toast({ title: "Resource saved" }); } })}>Save</Button></>}>
        {r && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            {err && <InlineAlert>{err}</InlineAlert>}
            <Input label="Title" value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} />
            <Input label="Slug" hint="lowercase-with-dashes" value={r.slug} onChange={(e) => setR({ ...r, slug: e.target.value })} />
            <Select label="Competency" value={String(r.competency_id)} onChange={(e) => setR({ ...r, competency_id: Number(e.target.value) })} options={compOpts} />
            <div className="ik-form2">
              <Select label="Type" value={r.type} onChange={(e) => setR({ ...r, type: e.target.value as ResourceInput["type"] })} options={typeOpts} />
              <Select label="Difficulty" value={r.difficulty} onChange={(e) => setR({ ...r, difficulty: e.target.value as ResourceInput["difficulty"] })} options={diffOpts} />
            </div>
            <Input label="Duration (minutes)" type="number" min="1" value={String(r.duration_minutes)} onChange={(e) => setR({ ...r, duration_minutes: Number(e.target.value) })} />
            <Textarea label="Description" rows={2} value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} />
            <Textarea label="Content (Markdown: ## headings, lists, **bold**)" rows={8} value={r.content} onChange={(e) => setR({ ...r, content: e.target.value })} />
            <Input label="External URL (optional)" value={r.url ?? ""} onChange={(e) => setR({ ...r, url: e.target.value || null })} />
            <Checkbox label="Published" checked={r.is_published} onChange={(e) => setR({ ...r, is_published: e.target.checked })} />
          </div>
        )}
      </Modal>
      <Modal open={!!t} onClose={() => setT(null)} title={t?.id ? "Edit task" : "New task"}
        footer={<><Button variant="secondary" onClick={() => setT(null)}>Cancel</Button><Button loading={saveT.isPending} onClick={submitT}>Save</Button></>}>
        {t && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            {err && <InlineAlert>{err}</InlineAlert>}
            <Input label="Title" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} />
            <Input label="Slug" value={t.slug} onChange={(e) => setT({ ...t, slug: e.target.value })} />
            <Select label="Competency" value={String(t.competency_id)} onChange={(e) => setT({ ...t, competency_id: Number(e.target.value) })} options={compOpts} />
            <div className="ik-form2">
              <Select label="Difficulty" value={t.difficulty} onChange={(e) => setT({ ...t, difficulty: e.target.value as TaskInput["difficulty"] })} options={diffOpts} />
              <Input label="Duration (minutes)" type="number" min="1" value={String(t.duration_minutes)} onChange={(e) => setT({ ...t, duration_minutes: Number(e.target.value) })} />
            </div>
            <Textarea label="Description" rows={2} value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} />
            <Textarea label="Instructions" rows={4} value={t.instructions} onChange={(e) => setT({ ...t, instructions: e.target.value })} />
            <Input label="Minimum response length" type="number" min="0" value={String(t.min_length)} onChange={(e) => setT({ ...t, min_length: Number(e.target.value) })} />
            <Textarea label="Rubric (JSON)" rows={6} value={t.rubricText} onChange={(e) => setT({ ...t, rubricText: e.target.value })} />
            <Checkbox label="Published" checked={t.is_published} onChange={(e) => setT({ ...t, is_published: e.target.checked })} />
          </div>
        )}
      </Modal>
    </>
  );
}
