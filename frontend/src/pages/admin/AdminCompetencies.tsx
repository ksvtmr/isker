import { Button, Card, InlineAlert, Input, Modal, Textarea } from "@isker/design-system";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { adminApi, useAdminCompetencies, useAdminMutation } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import type { Competency } from "../../types/api";
import { formatNumber } from "../../utils/format";

export function AdminCompetencies() {
  const { t } = useTranslation("adminContent");
  const { data, isLoading, error, refetch } = useAdminCompetencies();
  const [edit, setEdit] = useState<Competency | null>(null);
  const [form, setForm] = useState({ name: "", short_name: "", description: "", importance: "0.5", default_target: "70" });
  const save = useAdminMutation((v: { id: number; body: object }) => adminApi.updateCompetency(v.id, v.body));
  const toast = useToast();
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const open = (c: Competency) => { setEdit(c); setForm({ name: c.name, short_name: c.short_name, description: c.description, importance: String(c.importance), default_target: String(c.default_target) }); };
  const submit = () => edit && save.mutate({ id: edit.id, body: { ...form, importance: Number(form.importance), default_target: Number(form.default_target) } },
    { onSuccess: () => { setEdit(null); toast({ title: t("competencies.updated") }); } });
  return (
    <Card style={{ overflow: "hidden" }}>
      <div className="ik-table-wrap">
        <table className="ik-table">
          <thead><tr><th>{t("competencies.columns.competency")}</th><th>{t("competencies.columns.area")}</th><th className="num">{t("competencies.columns.importance")}</th><th className="num">{t("competencies.columns.defaultTarget")}</th><th><span className="isk-sr-only">{t("content.actions")}</span></th></tr></thead>
          <tbody>{data.map((c) => (
            <tr key={c.id}>
              <td><b style={{ fontWeight: 500 }}>{c.name}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{c.code}</div></td>
              <td>{c.area.name}</td><td className="num">{formatNumber(c.importance)}</td><td className="num">{formatNumber(c.default_target)}</td>
              <td style={{ textAlign: "right" }}><Button size="sm" variant="ghost" iconLeft="pencil" onClick={() => open(c)}>{t("common:actions.edit")}</Button></td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={t("competencies.editTitle", { name: edit?.name ?? "" })}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{t("common:actions.cancel")}</Button><Button loading={save.isPending} onClick={submit}>{t("common:actions.save")}</Button></>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {save.error && <InlineAlert>{errorMessage(save.error)}</InlineAlert>}
          <Input label={t("competencies.form.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label={t("competencies.form.shortName")} value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} />
          <Textarea label={t("content.form.description")} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="ik-form2">
            <Input label={t("competencies.form.importance")} type="number" step="0.05" min="0" max="1" value={form.importance} onChange={(e) => setForm({ ...form, importance: e.target.value })} />
            <Input label={t("competencies.columns.defaultTarget")} type="number" min="40" max="100" value={form.default_target} onChange={(e) => setForm({ ...form, default_target: e.target.value })} />
          </div>
        </div>
      </Modal>
    </Card>
  );
}
