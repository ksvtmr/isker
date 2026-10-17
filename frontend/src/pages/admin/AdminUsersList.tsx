import { Button, Card, Checkbox, ConfirmActionDialog, DataTable, EmptyState, Input, LevelBadge, Pagination, Select, type DataColumn, type SortOrder } from "@isker/design-system";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAdminMutation } from "../../api/admin";
import { ACCOUNT_STATUSES, ROLE_KEYS, manageApi, useAdminPlans, useAdminUserList, useRoles, type AdminUserRow, type CreateUserInput, type UserFilters } from "../../api/adminManage";
import { can, useMe } from "../../api/auth";
import { ApiError, errorMessage } from "../../api/client";
import { ErrorState } from "../../components/States";
import { useToast } from "../../components/Toaster";
import { LANGUAGE_NAMES, LANGUAGES, isLanguage } from "../../i18n/config";
import { formatDate, formatNumber } from "../../utils/format";
import { AdminPageHeader, Muted, RoleBadges, StatusPill, useStatusLabel } from "./common";
import { appHref } from "../../utils/appHref";

const FILTER_KEYS = ["q", "role", "status", "plan", "language", "registered_from", "registered_to", "activity"] as const;

function readFilters(p: URLSearchParams): UserFilters & { activity: string } {
  const activity = p.get("activity") ?? "";
  return {
    q: p.get("q") ?? "",
    role: p.get("role") ?? "",
    status: p.get("status") ?? "",
    plan: p.get("plan") ?? "",
    language: p.get("language") ?? "",
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
  const { t } = useTranslation("admin");
  const statusLabel = useStatusLabel();
  const [params, setParams] = useSearchParams();
  const f = readFilters(params);
  const navigate = useNavigate();
  const plans = useAdminPlans();
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
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
    { key: "full_name", header: t("users.columns.user"), sortable: true, render: (u) => <span><span style={{ display: "block" }}>{u.full_name}</span><Muted>{u.email}</Muted></span> },
    { key: "status", header: t("users.columns.status"), sortable: true, render: (u) => <StatusPill status={u.status} kind="account" /> },
    { key: "roles", header: t("users.columns.role"), render: (u) => <RoleBadges roles={u.roles} />, hideOnMobile: true },
    { key: "plan", header: t("users.columns.plan"), render: (u) => <span>{u.plan_name}{u.subscription_status && u.subscription_status !== "active" && <> <Muted>({statusLabel(u.subscription_status, "subscription")})</Muted></>}</span>, hideOnMobile: true },
    { key: "language", header: t("users.columns.language"), render: (u) => (u.language && isLanguage(u.language) ? LANGUAGE_NAMES[u.language] : <Muted>{t("users.languageNotChosen")}</Muted>), hideOnMobile: true },
    { key: "completed_attempts", header: t("users.columns.assessments"), align: "right", render: (u) => formatNumber(u.completed_attempts), hideOnMobile: true },
    { key: "latest", header: t("users.columns.latestScore"), render: (u) => (u.latest_overall !== null ? <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><b style={{ fontWeight: 600 }}>{u.latest_overall}</b><LevelBadge score={u.latest_overall} /></span> : <Muted>{t("users.notAssessed")}</Muted>), hideOnMobile: true },
    { key: "created_at", header: t("users.columns.registered"), sortable: true, render: (u) => formatDate(u.created_at), hideOnMobile: true },
    { key: "last_seen_at", header: t("users.columns.lastActive"), sortable: true, render: (u) => (u.last_seen_at ? formatDate(u.last_seen_at) : <Muted>{t("common:state.never")}</Muted>) },
  ];

  return (
    <>
      <AdminPageHeader crumbs={[{ label: t("crumbs.users") }]} title={t("users.title")} subtitle={t("users.subtitle")}
        action={can(me, "users.manage") ? <Button iconLeft="plus" onClick={() => setCreating(true)}>{t("users.create.open")}</Button> : undefined} />
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} canAssignRoles={can(me, "roles.assign")} onCreated={(id) => navigate(`/admin/users/${id}`)} />
      <Card style={{ overflow: "hidden" }}>
        <form role="search" aria-label={t("users.filters.aria")} className="ik-filters" style={{ padding: 16 }} onSubmit={(e) => { e.preventDefault(); update({ q }); }}>
          <Input label={t("users.filters.search")} placeholder={t("users.filters.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select label={t("users.filters.role")} value={f.role} onChange={(e) => update({ role: e.target.value })}
            options={[{ value: "", label: t("users.filters.allRoles") }, ...ROLE_KEYS.map((value) => ({ value, label: t(`common:roles.${value}`) }))]} />
          <Select label={t("users.filters.status")} value={f.status} onChange={(e) => update({ status: e.target.value })}
            options={[{ value: "", label: t("users.filters.allStatuses") }, ...ACCOUNT_STATUSES.map((value) => ({ value, label: statusLabel(value, "account") }))]} />
          <Select label={t("users.filters.plan")} value={f.plan} onChange={(e) => update({ plan: e.target.value })}
            options={[{ value: "", label: t("users.filters.allPlans") }, ...(plans.data ?? []).map((p) => ({ value: p.key, label: p.name }))]} />
          <Select label={t("users.filters.language")} value={f.language} onChange={(e) => update({ language: e.target.value })}
            options={[{ value: "", label: t("users.filters.allLanguages") }, ...LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] })), { value: "none", label: t("users.languageNotChosen") }]} />
          <Select label={t("users.filters.activity")} value={f.activity} onChange={(e) => update({ activity: e.target.value })}
            options={[{ value: "", label: t("users.filters.anyTime") }, { value: "active-7", label: t("users.filters.activeWithin", { count: 7 }) }, { value: "active-30", label: t("users.filters.activeWithin", { count: 30 }) }, { value: "inactive-30", label: t("users.filters.inactiveFor", { count: 30 }) }, { value: "inactive-90", label: t("users.filters.inactiveFor", { count: 90 }) }]} />
          <Input label={t("users.filters.registeredFrom")} type="date" value={f.registered_from} onChange={(e) => update({ registered_from: e.target.value })} />
          <Input label={t("users.filters.registeredTo")} type="date" value={f.registered_to} onChange={(e) => update({ registered_to: e.target.value })} />
          {anyFilter && <div style={{ alignSelf: "end" }}><Button type="button" variant="ghost" onClick={() => { setQ(""); setParams(new URLSearchParams(), { replace: true }); }}>{t("common:actions.clearFilters")}</Button></div>}
        </form>
        {list.error ? <div style={{ padding: 16 }}><ErrorState error={list.error} onRetry={() => list.refetch()} /></div> : (
          <>
            <DataTable
              caption={t("users.caption")}
              columns={columns}
              rows={list.data?.items ?? []}
              rowKey={(u) => u.id}
              loading={list.isLoading || list.isFetching}
              sort={{ key: f.sort ?? "created_at", order: f.order ?? "desc" }}
              onSortChange={(key, order) => update({ sort: key, order }, false)}
              rowHref={can(me, "users.view_details") ? (u) => appHref(`/admin/users/${u.id}`) : undefined}
              onRowOpen={can(me, "users.view_details") ? (u) => navigate(`/admin/users/${u.id}`) : undefined}
              empty={<EmptyState icon="search-x" title={anyFilter ? t("users.emptyFilteredTitle") : t("users.emptyTitle")} description={anyFilter ? t("users.emptyFilteredText") : t("users.emptyText")} />}
            />
            {list.data && <Pagination page={f.page ?? 1} pageSize={list.data.page_size} total={list.data.total} onChange={(p) => update({ page: p }, false)} label={t("users.pagination")} />}
          </>
        )}
      </Card>
    </>
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EMPTY: CreateUserInput = { full_name: "", email: "", roles: ["user"], status: "active", language: null, send_invitation: true, reason: "" };

/** Staff create an account without a password: the person gets a link to set one (or the API says why not). */
function CreateUserDialog({ open, onClose, onCreated, canAssignRoles }: { open: boolean; onClose: () => void; onCreated: (id: number) => void; canAssignRoles: boolean }) {
  const { t } = useTranslation("admin");
  const toast = useToast();
  const roles = useRoles(open && canAssignRoles);
  const [v, setV] = useState<CreateUserInput>(EMPTY);
  const [touched, setTouched] = useState(false);
  const m = useAdminMutation(manageApi.createUser);
  useEffect(() => { if (open) { setV(EMPTY); setTouched(false); m.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameErr = v.full_name.trim().length < 2 ? t("userDetail.form.nameInvalid") : undefined;
  const emailErr = !EMAIL_RE.test(v.email.trim()) ? t("userDetail.form.emailInvalid") : undefined;
  const server = m.error instanceof ApiError ? m.error.fieldErrors() : {};
  const extraRole = v.roles.find((r) => r !== "user") ?? "";
  const grantable = (roles.data ?? []).filter((r) => r.key !== "user");
  const submit = () => {
    setTouched(true);
    if (nameErr || emailErr) return;
    m.mutate({ ...v, full_name: v.full_name.trim(), email: v.email.trim(), reason: v.reason?.trim() || null }, {
      onSuccess: (r) => {
        toast({ title: t("users.create.success"), description: t(`users.create.invitation.${r.invitation}`, { email: r.user.email }) });
        onClose();
        onCreated(r.user.id);
      },
    });
  };
  return (
    <ConfirmActionDialog open={open} title={t("users.create.title")} description={t("users.create.description")} confirmLabel={t("users.create.confirm")} tone="primary"
      busy={m.isPending} error={m.error ? errorMessage(m.error) : undefined} onCancel={() => { m.reset(); onClose(); }} onConfirm={submit}>
      <Input label={t("userDetail.dialogs.edit.fullName")} value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} error={(touched ? nameErr : undefined) ?? server.full_name} maxLength={120} />
      <Input label={t("userDetail.dialogs.edit.email")} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={(touched ? emailErr : undefined) ?? server.email} />
      <Select label={t("userDetail.fields.language")} value={v.language ?? ""} onChange={(e) => setV({ ...v, language: e.target.value || null })}
        options={[{ value: "", label: t("users.languageNotChosen") }, ...LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))]} />
      {canAssignRoles && (
        <Select label={t("users.create.role")} value={extraRole} onChange={(e) => setV({ ...v, roles: e.target.value ? ["user", e.target.value] : ["user"] })} hint={t("users.create.roleHint")}
          options={[{ value: "", label: t("common:roles.user") }, ...grantable.map((r) => ({ value: r.key, label: t(`common:roles.${r.key}`, { defaultValue: r.name }) }))]} />
      )}
      <Select label={t("users.create.status")} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as CreateUserInput["status"] })}
        options={[{ value: "active", label: t("common:accountStatus.active") }, { value: "suspended", label: t("common:accountStatus.suspended") }]} />
      <Checkbox label={t("users.create.invite")} description={t("users.create.inviteHint")} checked={v.send_invitation} disabled={v.status !== "active"} onChange={(e) => setV({ ...v, send_invitation: e.target.checked })} />
      <Input label={t("users.create.reason")} value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} maxLength={500} />
    </ConfirmActionDialog>
  );
}
