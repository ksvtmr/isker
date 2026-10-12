import { Button, Card, DataTable, EmptyState, Input, Pagination, Select, Checkbox, type DataColumn } from "@isker/design-system";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuditLogs, type AuditEntry } from "../../api/adminManage";
import { ErrorState } from "../../components/States";
import { formatDateTime } from "../../utils/format";
import { AdminPageHeader, Muted, StatusPill } from "./common";

/** Action-group filter values are prefixes sent to the API untranslated. */
const ACTION_GROUPS = ["", "auth.", "admin.", "access.denied", "auth.login_failed", "subscription.", "learning.", "practice.", "profile."] as const;
type ActionGroup = (typeof ACTION_GROUPS)[number];

export function AdminAuditLogs() {
  const { t } = useTranslation("adminContent");
  const [params, setParams] = useSearchParams();
  const groupLabel = (g: ActionGroup) => {
    switch (g) {
      case "": return t("auditLogs.groups.all");
      case "auth.": return t("auditLogs.groups.auth");
      case "admin.": return t("auditLogs.groups.admin");
      case "access.denied": return t("auditLogs.groups.accessDenied");
      case "auth.login_failed": return t("auditLogs.groups.loginFailed");
      case "subscription.": return t("auditLogs.groups.subscription");
      case "learning.": return t("auditLogs.groups.learning");
      case "practice.": return t("auditLogs.groups.practice");
      case "profile.": return t("auditLogs.groups.profile");
    }
  };
  /** Most specific matching group for an action code (e.g. "auth.login_failed" before "auth."). */
  const actionGroup = (action: string) => ACTION_GROUPS.filter((g) => g && action.startsWith(g)).sort((a, b) => b.length - a.length)[0];
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
    { key: "when", header: t("auditLogs.columns.when"), render: (e) => formatDateTime(e.created_at) },
    { key: "action", header: t("auditLogs.columns.action"), render: (e) => { const g = actionGroup(e.action); return <span>{g && <span style={{ display: "block" }}>{groupLabel(g)}</span>}<Muted>{e.action}</Muted></span>; } },
    { key: "actor", header: t("auditLogs.columns.actor"), render: (e) => e.actor_email ?? (e.actor_id ? t("auditLogs.userFallback", { id: e.actor_id }) : <Muted>{t("auditLogs.systemActor")}</Muted>), hideOnMobile: true },
    { key: "target", header: t("auditLogs.columns.target"), render: (e) => (e.target_type ? (e.target_id !== null ? `${e.target_type} #${e.target_id}` : e.target_type) : "—"), hideOnMobile: true },
    { key: "outcome", header: t("auditLogs.columns.outcome"), render: (e) => <StatusPill status={e.outcome} /> },
    { key: "details", header: <span className="isk-sr-only">{t("common:actions.details")}</span>, render: (e) => (
      <Button size="sm" variant="ghost" aria-expanded={open === e.id} aria-controls={`audit-${e.id}`} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? t("common:actions.hide") : t("common:actions.details")}</Button>
    ) },
  ];
  const detail = list.data?.items.find((e) => e.id === open);
  return (
    <>
      <AdminPageHeader crumbs={[{ label: t("auditLogs.title") }]} title={t("auditLogs.title")} subtitle={t("auditLogs.subtitle")} />
      <Card style={{ overflow: "hidden" }}>
        <div className="ik-filters" style={{ padding: 16 }} role="group" aria-label={t("auditLogs.filtersLabel")}>
          <Select label={t("auditLogs.columns.action")} value={f.action} onChange={(e) => update({ action: e.target.value })} options={ACTION_GROUPS.map((g) => ({ value: g, label: groupLabel(g) }))} />
          <Select label={t("auditLogs.columns.outcome")} value={f.outcome} onChange={(e) => update({ outcome: e.target.value })}
            options={[{ value: "", label: t("auditLogs.anyOutcome") }, ...["success", "failure", "denied"].map((o) => ({ value: o, label: t(`common:outcome.${o}`) }))]} />
          <Input label={t("auditLogs.actorId")} type="number" min={1} value={String(f.actor_id)} onChange={(e) => update({ actor_id: e.target.value })} />
          <Input label={t("auditLogs.targetUserId")} type="number" min={1} value={String(f.target_id)} onChange={(e) => update({ target_id: e.target.value, target_type: e.target.value ? "user" : "" })} />
          <Input label={t("auditLogs.dateFrom")} type="date" value={f.date_from} onChange={(e) => update({ date_from: e.target.value })} />
          <Input label={t("auditLogs.dateTo")} type="date" value={f.date_to} onChange={(e) => update({ date_to: e.target.value })} />
          <div style={{ alignSelf: "end" }}><Checkbox label={t("auditLogs.securityOnly")} checked={f.security_only} onChange={(e) => update({ security_only: e.target.checked })} /></div>
        </div>
        {list.error ? <div style={{ padding: 16 }}><ErrorState error={list.error} onRetry={() => list.refetch()} /></div> : (
          <>
            <DataTable caption={t("auditLogs.caption")} columns={columns} rows={list.data?.items ?? []} rowKey={(e) => e.id} loading={list.isLoading || list.isFetching}
              empty={<EmptyState icon="scroll-text" title={t("auditLogs.emptyTitle")} description={t("auditLogs.emptyText")} />} />
            {detail && (
              <div id={`audit-${detail.id}`} style={{ padding: 16, borderTop: "1px solid var(--color-neutral-100)" }}>
                <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t("auditLogs.eventTitle", { id: detail.id })}</h2>
                <dl className="ik-kv" style={{ marginBottom: 10 }}>
                  <dt>{t("auditLogs.reason")}</dt><dd>{detail.reason ?? "—"}</dd>
                  <dt>{t("auditLogs.requestId")}</dt><dd><code>{detail.request_id ?? "—"}</code></dd>
                  <dt>{t("auditLogs.ipAddress")}</dt><dd>{detail.ip_address ?? "—"}</dd>
                </dl>
                <pre className="ik-pre">{detail.details ? JSON.stringify(detail.details, null, 2) : t("auditLogs.noDetails")}</pre>
              </div>
            )}
            {list.data && <Pagination page={f.page} pageSize={list.data.page_size} total={list.data.total} onChange={(p) => update({ page: p }, false)} label={t("auditLogs.pagesLabel")} />}
          </>
        )}
      </Card>
    </>
  );
}
