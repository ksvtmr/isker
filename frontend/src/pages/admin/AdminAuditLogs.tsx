import { Button, Card, DataTable, EmptyState, Input, Pagination, Select, Checkbox, type DataColumn } from "@isker/design-system";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { humanize, useAuditLogs, type AuditEntry } from "../../api/adminManage";
import { ErrorState } from "../../components/States";
import { AdminPageHeader, formatDateTime, Muted, StatusPill } from "./common";

const ACTION_GROUPS = [
  { value: "", label: "All actions" }, { value: "auth.", label: "Sign-in & account" }, { value: "admin.", label: "Admin actions" },
  { value: "access.denied", label: "Access denied" }, { value: "auth.login_failed", label: "Failed sign-ins" }, { value: "subscription.", label: "Payments" },
  { value: "learning.", label: "Learning" }, { value: "practice.", label: "Practice" }, { value: "profile.", label: "Profile" },
];

export function AdminAuditLogs() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<number | null>(null);
  const f = {
    action: params.get("action") ?? "", outcome: params.get("outcome") ?? "", target_type: params.get("target_type") ?? "",
    actor_id: params.get("actor_id") ? Number(params.get("actor_id")) : ("" as const), target_id: params.get("target_id") ? Number(params.get("target_id")) : ("" as const),
    security_only: params.get("security_only") === "true", date_from: params.get("date_from") ?? "", date_to: params.get("date_to") ?? "", page: Number(params.get("page") ?? 1) || 1,
  };
  const list = useAuditLogs({ ...f, security_only: f.security_only || undefined });
  const update = (patch: Record<string, string | number | boolean>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === "" || v === false) next.delete(k); else next.set(k, String(v)); }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  };
  const columns: DataColumn<AuditEntry>[] = [
    { key: "when", header: "When", render: (e) => formatDateTime(e.created_at) },
    { key: "action", header: "Action", render: (e) => <span><span style={{ display: "block" }}>{humanize(e.action)}</span><Muted>{e.action}</Muted></span> },
    { key: "actor", header: "Actor", render: (e) => e.actor_email ?? (e.actor_id ? `User #${e.actor_id}` : <Muted>System / anonymous</Muted>), hideOnMobile: true },
    { key: "target", header: "Target", render: (e) => (e.target_type ? (e.target_id !== null ? `${e.target_type} #${e.target_id}` : e.target_type) : "—"), hideOnMobile: true },
    { key: "outcome", header: "Outcome", render: (e) => <StatusPill status={e.outcome} /> },
    { key: "details", header: <span className="isk-sr-only">Details</span>, render: (e) => (
      <Button size="sm" variant="ghost" aria-expanded={open === e.id} aria-controls={`audit-${e.id}`} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Hide" : "Details"}</Button>
    ) },
  ];
  const detail = list.data?.items.find((e) => e.id === open);
  return (
    <>
      <AdminPageHeader crumbs={[{ label: "Audit log" }]} title="Audit log" subtitle="Append-only record of security-relevant and administrative actions. Passwords, tokens and secrets are never logged." />
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-filters" style={{ padding: 16 }} role="group" aria-label="Filter audit log">
          <Select label="Action" value={f.action} onChange={(e) => update({ action: e.target.value })} options={ACTION_GROUPS} />
          <Select label="Outcome" value={f.outcome} onChange={(e) => update({ outcome: e.target.value })}
            options={[{ value: "", label: "Any outcome" }, { value: "success", label: "Success" }, { value: "failure", label: "Failure" }, { value: "denied", label: "Denied" }]} />
          <Input label="Actor id" type="number" min={1} value={String(f.actor_id)} onChange={(e) => update({ actor_id: e.target.value })} />
          <Input label="Target user id" type="number" min={1} value={String(f.target_id)} onChange={(e) => update({ target_id: e.target.value, target_type: e.target.value ? "user" : "" })} />
          <Input label="From" type="date" value={f.date_from} onChange={(e) => update({ date_from: e.target.value })} />
          <Input label="To" type="date" value={f.date_to} onChange={(e) => update({ date_to: e.target.value })} />
          <div style={{ alignSelf: "end" }}><Checkbox label="Security events only" checked={f.security_only} onChange={(e) => update({ security_only: e.target.checked })} /></div>
        </div>
        {list.error ? <div style={{ padding: 16 }}><ErrorState error={list.error} onRetry={() => list.refetch()} /></div> : (
          <>
            <DataTable caption="Audit log entries, newest first" columns={columns} rows={list.data?.items ?? []} rowKey={(e) => e.id} loading={list.isLoading || list.isFetching}
              empty={<EmptyState icon="scroll-text" title="No matching events" description="Try a wider date range or remove a filter." />} />
            {detail && (
              <div id={`audit-${detail.id}`} style={{ padding: 16, borderTop: "1px solid var(--color-neutral-100)" }}>
                <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Event #{detail.id}</h2>
                <dl className="ik-kv" style={{ marginBottom: 10 }}>
                  <dt>Reason</dt><dd>{detail.reason ?? "—"}</dd>
                  <dt>Request id</dt><dd><code>{detail.request_id ?? "—"}</code></dd>
                  <dt>IP address</dt><dd>{detail.ip_address ?? "—"}</dd>
                </dl>
                <pre className="ik-pre">{detail.details ? JSON.stringify(detail.details, null, 2) : "No additional details."}</pre>
              </div>
            )}
            {list.data && <Pagination page={f.page} pageSize={list.data.page_size} total={list.data.total} onChange={(p) => update({ page: p }, false)} label="Audit log pages" />}
          </>
        )}
      </Card>
    </>
  );
}
