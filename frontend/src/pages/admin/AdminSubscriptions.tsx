import { Card, DataTable, EmptyState, Input, Pagination, Select, type DataColumn } from "@isker/design-system";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { humanize, useAdminPlans, useAdminSubscriptions, type SubscriptionAdmin } from "../../api/adminManage";
import { ErrorState } from "../../components/States";
import { formatDate } from "../../utils/format";
import { AdminPageHeader, Muted, StatusPill } from "./common";

export function AdminSubscriptions() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const plans = useAdminPlans();
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
    { key: "user", header: "User", render: (s) => <span><span style={{ display: "block" }}>{s.user_name ?? `User #${s.user_id}`}</span><Muted>{s.user_email}</Muted></span> },
    { key: "plan", header: "Plan", render: (s) => s.plan.name },
    { key: "status", header: "Status", render: (s) => <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><StatusPill status={s.status} />{s.cancel_at_period_end && <Muted>ends at period end</Muted>}</span> },
    { key: "source", header: "Source", render: (s) => humanize(s.source), hideOnMobile: true },
    { key: "started", header: "Started", render: (s) => formatDate(s.started_at), hideOnMobile: true },
    { key: "ends", header: "Ends", render: (s) => (s.ended_at ? `Ended ${formatDate(s.ended_at)}` : s.expires_at ? formatDate(s.expires_at) : <Muted>No end date</Muted>) },
  ];
  return (
    <>
      <AdminPageHeader crumbs={[{ label: "Subscriptions" }]} title="Subscriptions" subtitle="All subscriptions, current and past. Open a user to grant, extend or cancel." />
      <Card style={{ overflow: "hidden" }}>
        <form role="search" aria-label="Filter subscriptions" className="ik-filters" style={{ padding: 16 }} onSubmit={(e) => { e.preventDefault(); update({ q }); }}>
          <Input label="Search user" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select label="Status" value={f.status} onChange={(e) => update({ status: e.target.value })}
            options={[{ value: "", label: "All statuses" }, ...["active", "trialing", "past_due", "incomplete", "canceled", "expired"].map((v) => ({ value: v, label: humanize(v) }))]} />
          <Select label="Plan" value={f.plan} onChange={(e) => update({ plan: e.target.value })}
            options={[{ value: "", label: "All plans" }, ...(plans.data ?? []).filter((p) => !p.is_default).map((p) => ({ value: p.key, label: p.name }))]} />
          <Select label="Source" value={f.source} onChange={(e) => update({ source: e.target.value })}
            options={[{ value: "", label: "All sources" }, { value: "admin", label: "Admin grant" }, { value: "payment", label: "Payment" }, { value: "trial", label: "Trial" }, { value: "system", label: "System" }]} />
          <Select label="Expiring" value={params.get("expiring") ?? ""} onChange={(e) => update({ expiring: e.target.value })}
            options={[{ value: "", label: "Any time" }, { value: "7", label: "Within 7 days" }, { value: "30", label: "Within 30 days" }]} />
        </form>
        {list.error ? <div style={{ padding: 16 }}><ErrorState error={list.error} onRetry={() => list.refetch()} /></div> : (
          <>
            <DataTable caption="Subscriptions" columns={columns} rows={list.data?.items ?? []} rowKey={(s) => s.id} loading={list.isLoading || list.isFetching}
              rowHref={(s) => `/admin/users/${s.user_id}`} onRowOpen={(s) => navigate(`/admin/users/${s.user_id}`)}
              empty={<EmptyState icon="credit-card" title="No subscriptions" description="Everyone matching these filters is on the Free plan." />} />
            {list.data && <Pagination page={f.page} pageSize={list.data.page_size} total={list.data.total} onChange={(p) => update({ page: p }, false)} label="Subscription pages" />}
          </>
        )}
      </Card>
    </>
  );
}
