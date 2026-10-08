import { Button, Card, InlineAlert, Input, Modal, StatusBadge, Textarea } from "@isker/design-system";
import { useState } from "react";
import { adminApi, useAdminAssessments, useAdminMutation } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";

const BLANK = { code: "", title: "", description: "", estimated_minutes: "20" };

export function AdminAssessments() {
  const { data, isLoading, error, refetch } = useAdminAssessments();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const create = useAdminMutation(adminApi.createAssessment);
  const toggle = useAdminMutation((v: { id: number; is_active: boolean }) => adminApi.updateAssessment(v.id, { is_active: v.is_active }));
  const toast = useToast();
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}><Button iconLeft="plus" onClick={() => { setForm(BLANK); setOpen(true); }}>New assessment</Button></div>
      {toggle.error && <div style={{ marginBottom: 16 }}><InlineAlert>{errorMessage(toggle.error)}</InlineAlert></div>}
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <thead><tr><th>Assessment</th><th className="num">Questions</th><th className="num">Attempts</th><th className="num">Version</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id}>
                <td><b style={{ fontWeight: 500 }}>{a.title}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{a.code} · {a.estimated_minutes} min</div></td>
                <td className="num">{a.question_count}</td><td className="num">{a.attempt_count}</td><td className="num">{a.version}</td>
                <td>{a.is_active ? <StatusBadge status="done">Active</StatusBadge> : <StatusBadge status="todo">Inactive</StatusBadge>}</td>
                <td style={{ textAlign: "right" }}><Button size="sm" variant="ghost" onClick={() => toggle.mutate({ id: a.id, is_active: !a.is_active })}>{a.is_active ? "Deactivate" : "Activate"}</Button></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="isk-hint" style={{ marginTop: 12 }}>Learners take the first active assessment. Manage its questions in the Questions tab.</p>
      <Modal open={open} onClose={() => setOpen(false)} title="New assessment"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={create.isPending} onClick={() => create.mutate({ ...form, estimated_minutes: Number(form.estimated_minutes), is_active: false }, { onSuccess: () => { setOpen(false); toast({ title: "Assessment created" }); } })}>Create</Button></>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {create.error && <InlineAlert>{errorMessage(create.error)}</InlineAlert>}
          <Input label="Code" hint="Lowercase letters, numbers and dashes" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label="Description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label="Estimated minutes" type="number" min="1" value={form.estimated_minutes} onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}
