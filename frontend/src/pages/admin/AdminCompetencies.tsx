import { Button, Card, InlineAlert, Input, Modal, Textarea } from "@isker/design-system";
import { useState } from "react";
import { adminApi, useAdminCompetencies, useAdminMutation } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import type { Competency } from "../../types/api";

export function AdminCompetencies() {
  const { data, isLoading, error, refetch } = useAdminCompetencies();
  const [edit, setEdit] = useState<Competency | null>(null);
  const [form, setForm] = useState({ name: "", short_name: "", description: "", importance: "0.5", default_target: "70" });
  const save = useAdminMutation((v: { id: number; body: object }) => adminApi.updateCompetency(v.id, v.body));
  const toast = useToast();
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const open = (c: Competency) => { setEdit(c); setForm({ name: c.name, short_name: c.short_name, description: c.description, importance: String(c.importance), default_target: String(c.default_target) }); };
  const submit = () => edit && save.mutate({ id: edit.id, body: { ...form, importance: Number(form.importance), default_target: Number(form.default_target) } },
    { onSuccess: () => { setEdit(null); toast({ title: "Competency updated" }); } });
  return (
    <Card style={{ overflow: "hidden" }}>
      <div className="ik-table-wrap">
        <table className="ik-table">
          <thead><tr><th>Competency</th><th>Area</th><th className="num">Importance</th><th className="num">Default target</th><th /></tr></thead>
          <tbody>{data.map((c) => (
            <tr key={c.id}>
              <td><b style={{ fontWeight: 500 }}>{c.name}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{c.code}</div></td>
              <td>{c.area.name}</td><td className="num">{c.importance}</td><td className="num">{c.default_target}</td>
              <td style={{ textAlign: "right" }}><Button size="sm" variant="ghost" iconLeft="pencil" onClick={() => open(c)}>Edit</Button></td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Edit ${edit?.name ?? ""}`}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Save</Button></>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {save.error && <InlineAlert>{errorMessage(save.error)}</InlineAlert>}
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Short name" value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} />
          <Textarea label="Description" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="ik-form2">
            <Input label="Importance (0–1)" type="number" step="0.05" min="0" max="1" value={form.importance} onChange={(e) => setForm({ ...form, importance: e.target.value })} />
            <Input label="Default target" type="number" min="40" max="100" value={form.default_target} onChange={(e) => setForm({ ...form, default_target: e.target.value })} />
          </div>
        </div>
      </Modal>
    </Card>
  );
}
