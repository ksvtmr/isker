import { Button, Card, DataTable, EmptyState, Input, LevelBadge, Pagination, Select, type DataColumn, type SortOrder } from "@isker/design-system";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ROLE_LABELS, useAdminPlans, useAdminUserList, type AdminUserRow, type UserFilters } from "../../api/adminManage";
import { ErrorState } from "../../components/States";
import { formatDate } from "../../utils/format";
import { AdminPageHeader, Muted, RoleBadges, StatusPill } from "./common";

const FILTER_KEYS = ["q", "role", "status", "plan", "registered_from", "registered_to", "activity"] as const;

function readFilters(p: URLSearchParams): UserFilters & { activity: string } {
  const activity = p.get("activity") ?? "";
  return {
    q: p.get("q") ?? "",
    role: p.get("role") ?? "",
    status: p.get("status") ?? "",
    plan: p.get("plan") ?? "",
    registered_from: p.get("registered_from") ?? "",
    registered_to: p.get("registered_to") ?? "",
    activity,
    active_within_days: activity.startsWith("active-") ? Number(activity.slice(7)) : "",
    inactive_for_days: activity.startsWith("inactive-") ? Number(activity.slice(9)) : "",
    sort: p.get("sort") ?? "created_at",
    order: (p.get("order") as SortOrder) ?? "desc",
    page: Number(p.get("page") ?? 1) || 1,
    page_size: 25,
  };
}

export function AdminUsersList() {
  const [params, setParams] = useSearchParams();
  const f = readFilters(params);
  const navigate = useNavigate();
  const plans = useAdminPlans();
  const [q, setQ] = useState(f.q ?? "");
  const { activity: _activity, ...query } = f;
  const list = useAdminUserList(query);

  const update = (patch: Record<string, string | number | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") next.delete(k); else next.set(k, String(v));
    }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  };
  // Debounced search so each keystroke doesn't hit the API.
  useEffect(() => {
    const id = setTimeout(() => { if ((params.get("q") ?? "") !== q) update({ q }); }, 300);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyFilter = FILTER_KEYS.some((k) => params.get(k));
  const columns: DataColumn<AdminUserRow>[] = [
    { key: "full_name", header: "User", sortable: true, render: (u) => <span><span style={{ display: "block" }}>{u.full_name}</span><Muted>{u.email}</Muted></span> },
    { key: "status", header: "Status", sortable: true, render: (u) => <StatusPill status={u.status} /> },
    { key: "roles", header: "Role", render: (u) => <RoleBadges roles={u.roles} />, hideOnMobile: true },
    { key: "plan", header: "Plan", render: (u) => <span>{u.plan_name}{u.subscription_status && u.subscription_status !== "active" && <> <Muted>({u.subscription_status.replace("_", " ")})</Muted></>}</span>, hideOnMobile: true },
    { key: "completed_attempts", header: "Assessments", align: "right", render: (u) => u.completed_attempts, hideOnMobile: true },
    { key: "latest", header: "Latest score", render: (u) => (u.latest_overall !== null ? <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><b style={{ fontWeight: 600 }}>{u.latest_overall}</b><LevelBadge score={u.latest_overall} /></span> : <Muted>Not assessed</Muted>), hideOnMobile: true },
    { key: "created_at", header: "Registered", sortable: true, render: (u) => formatDate(u.created_at), hideOnMobile: true },
    { key: "last_seen_at", header: "Last active", sortable: true, render: (u) => (u.last_seen_at ? formatDate(u.last_seen_at) : <Muted>Never</Muted>) },
  ];

  return (
    <>
      <AdminPageHeader crumbs={[{ label: "Users" }]} title="Users" subtitle="Search, filter and open an account to manage it." />
      <Card style={{ overflow: "hidden" }}>
        <form role="search" aria-label="Filter users" className="ik-filters" style={{ padding: 16 }} onSubmit={(e) => { e.preventDefault(); update({ q }); }}>
          <Input label="Search" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select label="Role" value={f.role} onChange={(e) => update({ role: e.target.value })}
            options={[{ value: "", label: "All roles" }, ...Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))]} />
          <Select label="Status" value={f.status} onChange={(e) => update({ status: e.target.value })}
            options={[{ value: "", label: "All statuses" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "deactivated", label: "Deactivated" }]} />
          <Select label="Plan" value={f.plan} onChange={(e) => update({ plan: e.target.value })}
            options={[{ value: "", label: "All plans" }, ...(plans.data ?? []).map((p) => ({ value: p.key, label: p.name }))]} />
          <Select label="Last activity" value={f.activity} onChange={(e) => update({ activity: e.target.value })}
            options={[{ value: "", label: "Any time" }, { value: "active-7", label: "Active in last 7 days" }, { value: "active-30", label: "Active in last 30 days" }, { value: "inactive-30", label: "Inactive 30+ days" }, { value: "inactive-90", label: "Inactive 90+ days" }]} />
          <Input label="Registered from" type="date" value={f.registered_from} onChange={(e) => update({ registered_from: e.target.value })} />
          <Input label="Registered to" type="date" value={f.registered_to} onChange={(e) => update({ registered_to: e.target.value })} />
          {anyFilter && <div style={{ alignSelf: "end" }}><Button type="button" variant="ghost" onClick={() => { setQ(""); setParams(new URLSearchParams(), { replace: true }); }}>Clear filters</Button></div>}
        </form>
        {list.error ? <div style={{ padding: 16 }}><ErrorState error={list.error} onRetry={() => list.refetch()} /></div> : (
          <>
            <DataTable
              caption="User accounts"
              columns={columns}
              rows={list.data?.items ?? []}
              rowKey={(u) => u.id}
              loading={list.isLoading || list.isFetching}
              sort={{ key: f.sort ?? "created_at", order: f.order ?? "desc" }}
              onSortChange={(key, order) => update({ sort: key, order }, false)}
              rowHref={(u) => `/admin/users/${u.id}`}
              onRowOpen={(u) => navigate(`/admin/users/${u.id}`)}
              empty={<EmptyState icon="search-x" title={anyFilter ? "No users match these filters" : "No users yet"} description={anyFilter ? "Try removing a filter." : "Accounts appear here after people register."} />}
            />
            {list.data && <Pagination page={f.page ?? 1} pageSize={list.data.page_size} total={list.data.total} onChange={(p) => update({ page: p }, false)} label="User list pages" />}
          </>
        )}
      </Card>
    </>
  );
}
