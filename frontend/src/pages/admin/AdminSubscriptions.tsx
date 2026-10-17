import { Card, DataTable, EmptyState, Input, Pagination, Select, type DataColumn } from "@isker/design-system";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAdminPlans, useAdminSubscriptions, type SubscriptionAdmin } from "../../api/adminManage";
import { can, useMe } from "../../api/auth";
import { ErrorState } from "../../components/States";
import { formatDate } from "../../utils/format";
import { AdminPageHeader, Muted, StatusPill } from "./common";
import { appHref } from "../../utils/appHref";

export function AdminSubscriptions() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation("adminContent");
  const plans = useAdminPlans();
  const { data: me } = useMe();
  // Rows link to the user only for viewers allowed to open user details (the API checks users.view_details).
  const canOpenUser = can(me, "users.view_details");
  const [q, setQ] = useState(params.get("q") ?? "");
  const f = {
    status: params.get("status") ?? "", plan: params.get("plan") ?? "", source: params.get("source") ?? "", q: params.get("q") ?? "",
    expiring_within_days: params.get("expiring") ? Number(params.get("expiring")) : ("" as const), page: Number(params.get("page") ?? 1) || 1,
  };
  const list = useAdminSubscriptions(f);
  const update = (patch: Record<string, string | number>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === "" || v === undefined) next.delete(k); else next.set(k, String(v)); }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const id = setTimeout(() => { if ((params.get("q") ?? "") !== q) update({ q }); }, 300);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns: DataColumn<SubscriptionAdmin>[] = [
    { key: "user", header: t("subscriptions.columns.user"), render: (s) => <span><span style={{ display: "block" }}>{s.user_name ?? t("subscriptions.userFallback", { id: s.user_id })}</span><Muted>{s.user_email}</Muted></span> },
    { key: "plan", header: t("subscriptions.columns.plan"), render: (s) => s.plan.name },
    { key: "status", header: t("subscriptions.columns.status"), render: (s) => <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><StatusPill status={s.status} />{s.cancel_at_period_end && <Muted>{t("subscriptions.endsAtPeriodEnd")}</Muted>}</span> },
    { key: "source", header: t("subscriptions.columns.source"), render: (s) => t(`common:subscriptionSource.${s.source}`, { defaultValue: s.source }), hideOnMobile: true },
    { key: "started", header: t("subscriptions.columns.started"), render: (s) => formatDate(s.started_at), hideOnMobile: true },
    { key: "ends", header: t("subscriptions.columns.ends"), render: (s) => (s.ended_at ? t("subscriptions.endedOn", { date: formatDate(s.ended_at) }) : s.expires_at ? formatDate(s.expires_at) : <Muted>{t("subscriptions.noEndDate")}</Muted>) },
  ];
  return (
    <>
      <AdminPageHeader crumbs={[{ label: t("subscriptions.title") }]} title={t("subscriptions.title")} subtitle={t("subscriptions.subtitle")} />
      <Card style={{ overflow: "hidden" }}>
        <form role="search" aria-label={t("subscriptions.filtersLabel")} className="ik-filters" style={{ padding: 16 }} onSubmit={(e) => { e.preventDefault(); update({ q }); }}>
          <Input label={t("subscriptions.searchLabel")} placeholder={t("subscriptions.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select label={t("subscriptions.columns.status")} value={f.status} onChange={(e) => update({ status: e.target.value })}
            options={[{ value: "", label: t("subscriptions.allStatuses") }, ...["active", "trialing", "past_due", "incomplete", "canceled", "expired"].map((v) => ({ value: v, label: t(`common:subscriptionStatus.${v}`) }))]} />
          <Select label={t("subscriptions.columns.plan")} value={f.plan} onChange={(e) => update({ plan: e.target.value })}
            options={[{ value: "", label: t("subscriptions.allPlans") }, ...(plans.data ?? []).filter((p) => !p.is_default).map((p) => ({ value: p.key, label: p.name }))]} />
          <Select label={t("subscriptions.columns.source")} value={f.source} onChange={(e) => update({ source: e.target.value })}
            options={[{ value: "", label: t("subscriptions.allSources") }, ...["admin", "payment", "trial", "system"].map((v) => ({ value: v, label: t(`common:subscriptionSource.${v}`) }))]} />
          <Select label={t("subscriptions.expiringLabel")} value={params.get("expiring") ?? ""} onChange={(e) => update({ expiring: e.target.value })}
            options={[{ value: "", label: t("subscriptions.expiringAny") }, { value: "7", label: t("subscriptions.expiringWithin", { count: 7 }) }, { value: "30", label: t("subscriptions.expiringWithin", { count: 30 }) }]} />
        </form>
        {list.error ? <div style={{ padding: 16 }}><ErrorState error={list.error} onRetry={() => list.refetch()} /></div> : (
          <>
            <DataTable caption={t("subscriptions.title")} columns={columns} rows={list.data?.items ?? []} rowKey={(s) => s.id} loading={list.isLoading || list.isFetching}
              rowHref={canOpenUser ? (s) => appHref(`/admin/users/${s.user_id}`) : undefined} onRowOpen={canOpenUser ? (s) => navigate(`/admin/users/${s.user_id}`) : undefined}
              empty={<EmptyState icon="credit-card" title={t("subscriptions.emptyTitle")} description={t("subscriptions.emptyText")} />} />
            {list.data && <Pagination page={f.page} pageSize={list.data.page_size} total={list.data.total} onChange={(p) => update({ page: p }, false)} label={t("subscriptions.pagesLabel")} />}
          </>
        )}
      </Card>
    </>
  );
}
