import { Badge, Button, Card, CardHeader, Checkbox, ConfirmActionDialog, EmptyState, InlineAlert, Input, KeyValueList, LevelBadge, Select, Tabs } from "@isker/design-system";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useAdminMutation } from "../../api/admin";
import { humanize, manageApi, useAdminPlans, useAdminUser, useRoles, type AdminUserDetail } from "../../api/adminManage";
import { can, useMe } from "../../api/auth";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import type { SubscriptionStatus } from "../../types/api";
import { formatDate, formatNumber } from "../../utils/format";
import { AdminPageHeader, formatDateTime, Muted, RoleBadges, StatusPill, useAuditLabels, useStatusLabel } from "./common";

type Dialog =
  | { kind: "edit" } | { kind: "suspend" } | { kind: "reactivate" } | { kind: "deactivate" } | { kind: "sessions" }
  | { kind: "reset" } | { kind: "grant" } | { kind: "revoke"; role: string } | { kind: "delete" }
  | { kind: "assign" } | { kind: "extend" } | { kind: "cancel" } | { kind: "status" };

const TAB_IDS = ["overview", "learning", "subscription", "security", "activity"] as const;

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <Card><CardHeader title={title} description={description} action={action} /><div style={{ padding: "0 24px 24px" }}>{children}</div></Card>;
}

export function AdminUserDetailPage() {
  const { t } = useTranslation("admin");
  const id = Number(useParams().id);
  const { data: me } = useMe();
  const { data: u, isLoading, error, refetch } = useAdminUser(id);
  const [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !u) {
    return <><AdminPageHeader crumbs={[{ label: t("crumbs.users"), to: "/admin/users" }, { label: t("userDetail.userId", { id }) }]} title={t("userDetail.fallbackTitle")} /><ErrorState error={error} onRetry={() => refetch()} /></>;
  }
  const isSelf = me?.id === u.id;
  const canSupport = can(me, "users.support") && !isSelf;
  const canSubs = can(me, "subscriptions.manage");
  const open = (d: Dialog) => setDialog(d);
  const tabLabels: Record<(typeof TAB_IDS)[number], string> = {
    overview: t("userDetail.tabs.overview"), learning: t("userDetail.tabs.learning"), subscription: t("userDetail.tabs.subscription"),
    security: t("userDetail.tabs.security"), activity: t("userDetail.tabs.activity"),
  };
  const tabs = TAB_IDS.map((value) => ({ value, label: tabLabels[value] }));
  const close = () => setDialog(null);

  const actions = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {u.can_manage && <Button size="sm" variant="secondary" iconLeft="pencil" onClick={() => open({ kind: "edit" })}>{t("common:actions.edit")}</Button>}
      {u.can_manage && u.status === "active" && <Button size="sm" variant="secondary" iconLeft="ban" onClick={() => open({ kind: "suspend" })}>{t("userDetail.actions.suspend")}</Button>}
      {u.can_manage && u.status !== "active" && <Button size="sm" variant="secondary" iconLeft="undo-2" onClick={() => open({ kind: "reactivate" })}>{t("userDetail.actions.reactivate")}</Button>}
    </div>
  );

  return (
    <>
      <AdminPageHeader crumbs={[{ label: t("crumbs.users"), to: "/admin/users" }, { label: u.full_name }]}
        title={<span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{u.full_name} <StatusPill status={u.status} kind="account" /></span>}
        subtitle={<>{u.email} · {t("userDetail.registered", { date: formatDate(u.created_at) })}{isSelf ? ` · ${t("userDetail.thisIsYou")}` : ""}</>} action={actions} />
      {u.status !== "active" && (
        <div style={{ marginBottom: 16 }}>
          <InlineAlert tone="warning" title={u.status === "suspended" ? t("userDetail.statusAlert.suspended") : t("userDetail.statusAlert.deactivated")}>
            {u.status_reason ? `${t("userDetail.statusAlert.reason", { reason: u.status_reason })} ` : ""}{u.status_changed_at ? t("userDetail.statusAlert.changed", { date: formatDateTime(u.status_changed_at) }) : ""}
            {u.deletion_requested_at ? ` ${t("userDetail.statusAlert.selfClosed")}` : ""}
          </InlineAlert>
        </div>
      )}
      <div style={{ marginBottom: 20, overflowX: "auto" }}><Tabs variant="line" ariaLabel={t("userDetail.tabsAria")} tabs={tabs} value={tab} onChange={setTab} /></div>
      <div role="tabpanel" aria-label={tabs.find((x) => x.value === tab)?.label} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {tab === "overview" && <Overview u={u} />}
        {tab === "learning" && <Learning u={u} />}
        {tab === "subscription" && <SubscriptionTab u={u} canManage={canSubs} open={open} />}
        {tab === "security" && <Security u={u} canSupport={canSupport} open={open} />}
        {tab === "activity" && <Activity u={u} />}
      </div>
      <UserDialogs u={u} dialog={dialog} close={close} />
    </>
  );
}

function Overview({ u }: { u: AdminUserDetail }) {
  const { t } = useTranslation("admin");
  const p = u.profile;
  const none = t("common:state.none");
  return (
    <div className="ik-grid2" style={{ alignItems: "start" }}>
      <Section title={t("userDetail.sections.account")}>
        <KeyValueList items={[
          { label: t("userDetail.fields.email"), value: <>{u.email} {u.email_verified_at ? <Badge tone="success">{t("userDetail.emailConfirmed")}</Badge> : <Badge tone="warning">{t("userDetail.emailNotConfirmed")}</Badge>}</> },
          { label: t("userDetail.fields.roles"), value: <RoleBadges roles={u.roles} /> },
          { label: t("userDetail.fields.plan"), value: u.plan_name },
          { label: t("userDetail.fields.onboarding"), value: u.onboarding_completed ? t("userDetail.onboardingDone") : t("userDetail.onboardingNotDone") },
          { label: t("userDetail.fields.terms"), value: u.terms_accepted_at ? t("userDetail.termsAccepted", { date: formatDate(u.terms_accepted_at), version: u.terms_version ?? none }) : none },
          { label: t("userDetail.fields.lastSignIn"), value: formatDateTime(u.last_login_at) },
          { label: t("userDetail.fields.lastActive"), value: formatDateTime(u.last_seen_at) },
        ]} />
      </Section>
      <Section title={t("userDetail.sections.profile")}>
        {!p ? <Muted>{t("userDetail.noProfile")}</Muted> : (
          <KeyValueList items={[
            { label: t("userDetail.fields.education"), value: p.education ?? none },
            { label: t("userDetail.fields.experience"), value: p.entrepreneurial_experience ? t(`admin:userDetail.experience.${p.entrepreneurial_experience}`, { defaultValue: humanize(String(p.entrepreneurial_experience)) }) : none },
            { label: t("userDetail.fields.format"), value: p.preferred_learning_format ? t(`admin:userDetail.format.${p.preferred_learning_format}`, { defaultValue: humanize(String(p.preferred_learning_format)) }) : none },
            { label: t("userDetail.fields.weeklyTime"), value: p.weekly_learning_minutes ? t("common:time.minutes", { count: Number(p.weekly_learning_minutes) }) : none },
            { label: t("userDetail.fields.goals"), value: u.goals.length ? u.goals.join(", ") : none },
            { label: t("userDetail.fields.background"), value: p.background ?? none },
          ]} />
        )}
      </Section>
    </div>
  );
}

function Learning({ u }: { u: AdminUserDetail }) {
  const { t } = useTranslation("admin");
  const statusLabel = useStatusLabel();
  return (
    <>
      <div className="ik-grid2" style={{ alignItems: "start" }}>
        <Section title={t("userDetail.sections.assessments")} description={t("userDetail.attemptsCount", { count: u.attempts.length })}>
          {!u.attempts.length ? <Muted>{t("userDetail.noAttempts")}</Muted> : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {u.attempts.map((a) => (
                <li key={a.id} className="ik-list-row">
                  <span>{a.scope === "full" ? t("userDetail.fullAssessment") : t("userDetail.reassessment")} <Muted>· {t("userDetail.startedOn", { date: formatDate(a.started_at) })}</Muted></span>
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>{a.overall_score !== null && <b>{formatNumber(a.overall_score)}</b>}<Badge tone={a.status === "completed" ? "success" : a.status === "abandoned" ? "neutral" : "info"}>{statusLabel(a.status, "attempt")}</Badge></span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t("userDetail.sections.learning")}>
          <KeyValueList items={[
            { label: t("userDetail.fields.resourcesCompleted"), value: formatNumber(u.learning.completed) }, { label: t("userDetail.fields.resourcesInProgress"), value: formatNumber(u.learning.in_progress) },
            { label: t("userDetail.fields.tasksCompleted"), value: formatNumber(u.practice.completed) }, { label: t("userDetail.fields.tasksInProgress"), value: formatNumber(u.practice.in_progress) },
          ]} />
        </Section>
      </div>
      <Section title={t("userDetail.sections.competencies")} description={t("userDetail.competenciesDesc")}>
        {!u.competencies.length ? <Muted>{t("userDetail.notAssessed")}</Muted> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {u.competencies.map((c) => (
              <li key={c.code} className="ik-list-row"><span>{c.name}</span><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><b>{formatNumber(c.score)}</b>{c.level && <LevelBadge level={c.level} />}</span></li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function SubscriptionTab({ u, canManage, open }: { u: AdminUserDetail; canManage: boolean; open: (d: Dialog) => void }) {
  const { t } = useTranslation("admin");
  const statusLabel = useStatusLabel();
  const labels = useAuditLabels();
  const sourceLabel = (src: string) => t(`common:subscriptionSource.${src}`, { defaultValue: humanize(src) });
  const s = u.subscription;
  return (
    <>
      <Section title={t("userDetail.planTitle", { plan: u.plan_name })} description={s ? `${t("userDetail.source", { source: sourceLabel(s.source) })}${s.note ? ` · ${s.note}` : ""}` : t("userDetail.noSubscription")}
        action={canManage ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" variant="secondary" onClick={() => open({ kind: "assign" })}>{s ? t("userDetail.actions.changePlan") : t("userDetail.actions.grantPlan")}</Button>
            {s && <Button size="sm" variant="secondary" onClick={() => open({ kind: "extend" })}>{t("userDetail.actions.extend")}</Button>}
            {s && <Button size="sm" variant="secondary" onClick={() => open({ kind: "status" })}>{t("userDetail.actions.changeStatus")}</Button>}
            {s && <Button size="sm" variant="danger" onClick={() => open({ kind: "cancel" })}>{t("userDetail.actions.cancelSubscription")}</Button>}
          </div>
        ) : undefined}>
        {s ? (
          <KeyValueList items={[
            { label: t("userDetail.fields.status"), value: <StatusPill status={s.status} kind="subscription" /> },
            { label: t("userDetail.fields.started"), value: formatDateTime(s.started_at) },
            { label: t("userDetail.fields.ends"), value: s.expires_at ? `${formatDateTime(s.expires_at)}${s.cancel_at_period_end ? ` ${t("userDetail.canceledAtPeriodEnd")}` : ""}` : t("userDetail.noEndDate") },
          ]} />
        ) : <Muted>{t("userDetail.freeByDefault")}</Muted>}
      </Section>
      <Section title={t("userDetail.sections.subscriptionHistory")}>
        {!u.subscription_history.length ? <Muted>{t("userDetail.noSubscriptionEvents")}</Muted> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {u.subscription_history.map((e) => (
              <li key={e.id} className="ik-list-row" style={{ alignItems: "flex-start" }}>
                <span>
                  <b style={{ fontWeight: 500 }}>{labels.action(e.event_type)}</b>{e.to_status ? ` → ${statusLabel(e.to_status, "subscription")}` : ""}
                  <span style={{ display: "block" }}><Muted>{sourceLabel(e.source)}{e.actor_id ? ` · ${t("userDetail.byUser", { id: e.actor_id })}` : ""}{e.reason ? ` · ${e.reason}` : ""} · {e.event_type}</Muted></span>
                </span>
                <Muted>{formatDateTime(e.created_at)}</Muted>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Security({ u, canSupport, open }: { u: AdminUserDetail; canSupport: boolean; open: (d: Dialog) => void }) {
  const { t } = useTranslation("admin");
  const roleName = (r: string) => t(`common:roles.${r}`, { defaultValue: humanize(r) });
  return (
    <>
      <Section title={t("userDetail.sections.roles")} description={t("userDetail.rolesDesc")}
        action={u.can_assign_roles ? <Button size="sm" variant="secondary" iconLeft="plus" onClick={() => open({ kind: "grant" })}>{t("userDetail.actions.grantRole")}</Button> : undefined}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {u.roles.map((r) => (
            <li key={r} className="ik-list-row">
              <span>{roleName(r)}</span>
              {u.can_assign_roles && <Button size="sm" variant="ghost" aria-label={t("userDetail.revokeRoleAria", { role: roleName(r) })} onClick={() => open({ kind: "revoke", role: r })}>{t("userDetail.actions.revoke")}</Button>}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("userDetail.sections.sessions")} description={t("userDetail.sessionsCount", { count: u.sessions.length })}
        action={canSupport && u.sessions.length ? <Button size="sm" variant="secondary" iconLeft="log-out" onClick={() => open({ kind: "sessions" })}>{t("userDetail.actions.revokeSessions")}</Button> : undefined}>
        {!u.sessions.length ? <Muted>{t("userDetail.noSessions")}</Muted> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {u.sessions.map((s) => <li key={s.id} className="ik-list-row"><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{s.user_agent ?? t("userDetail.unknownDevice")}</span><Muted>{t("userDetail.since", { date: formatDateTime(s.created_at) })}</Muted></li>)}
          </ul>
        )}
      </Section>
      <Section title={t("userDetail.sections.lifecycle")}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canSupport && <Button size="sm" variant="secondary" iconLeft="key-round" onClick={() => open({ kind: "reset" })}>{t("userDetail.actions.sendReset")}</Button>}
          {u.can_manage && u.status !== "deactivated" && <Button size="sm" variant="secondary" iconLeft="user-x" onClick={() => open({ kind: "deactivate" })}>{t("userDetail.actions.deactivate")}</Button>}
          {u.can_delete && <Button size="sm" variant="danger" iconLeft="trash-2" onClick={() => open({ kind: "delete" })}>{t("userDetail.actions.delete")}</Button>}
        </div>
        <p style={{ marginTop: 12 }}><Muted>{t("userDetail.lifecycleNote")}</Muted></p>
      </Section>
    </>
  );
}

function Activity({ u }: { u: AdminUserDetail }) {
  const { t } = useTranslation("admin");
  const labels = useAuditLabels();
  if (u.audit_events === null) return <EmptyState icon="lock" title={t("userDetail.auditRestrictedTitle")} description={t("userDetail.auditRestrictedText")} />;
  return (
    <Section title={t("userDetail.sections.audit")} description={t("userDetail.auditDesc", { count: 50 })}>
      {!u.audit_events.length ? <Muted>{t("userDetail.noEvents")}</Muted> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {u.audit_events.map((e) => (
            <li key={e.id} className="ik-list-row" style={{ alignItems: "flex-start" }}>
              <span>
                <b style={{ fontWeight: 500 }}>{labels.action(e.action)}</b>
                <span style={{ display: "block" }}><Muted>{e.actor_id === u.id ? t("userDetail.byTheUser") : e.actor_id ? t("userDetail.byUser", { id: e.actor_id }) : t("userDetail.bySystem")}{e.reason ? ` · ${e.reason}` : ""} · {e.action}</Muted></span>
              </span>
              <span style={{ textAlign: "right" }}><StatusPill status={e.outcome} kind="outcome" /><span style={{ display: "block", marginTop: 4 }}><Muted>{formatDateTime(e.created_at)}</Muted></span></span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Every dialog closes only after the API confirms; errors stay inside the dialog. */
function UserDialogs({ u, dialog, close }: { u: AdminUserDetail; dialog: Dialog | null; close: () => void }) {
  const { t } = useTranslation("admin");
  const statusLabel = useStatusLabel();
  const toast = useToast();
  const navigate = useNavigate();
  const roles = useRoles();
  const plans = useAdminPlans();
  const [name, setName] = useState(u.full_name);
  const [email, setEmail] = useState(u.email);
  const [roleKey, setRoleKey] = useState("");
  const [planKey, setPlanKey] = useState("");
  const [days, setDays] = useState("");
  const [trial, setTrial] = useState(false);
  const [atPeriodEnd, setAtPeriodEnd] = useState(false);
  const [newStatus, setNewStatus] = useState<SubscriptionStatus>("active");
  useEffect(() => {
    if (!dialog) return;
    setName(u.full_name); setEmail(u.email); setRoleKey(""); setPlanKey(""); setDays(""); setTrial(false); setAtPeriodEnd(false); setNewStatus("active");
  }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useAdminMutation(async ({ run }: { run: () => Promise<{ message?: string } | unknown> }) => run());
  const done = (title: string, description?: string) => { toast({ title, description }); close(); m.reset(); };
  const run = (fn: () => Promise<unknown>, title: string, after?: () => void) =>
    m.mutate({ run: fn }, { onSuccess: (r) => { const msg = (r as { message?: string } | undefined)?.message; done(title, msg); after?.(); } });
  const cancel = () => { m.reset(); close(); };
  const err = m.error ? errorMessage(m.error) : undefined;
  const k = dialog?.kind;
  const sub = u.subscription;
  const assignablePlans = (plans.data ?? []).filter((p) => p.is_active && !p.is_default);
  const grantable = (roles.data ?? []).filter((r) => !u.roles.includes(r.key) && r.key !== "user");
  const roleName = (r: string, fallback?: string) => t(`common:roles.${r}`, { defaultValue: fallback ?? humanize(r) });

  return (
    <>
      <ConfirmActionDialog open={k === "edit"} title={t("userDetail.dialogs.edit.title")} confirmLabel={t("common:actions.saveChanges")} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        confirmDisabled={name.trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
        description={t("userDetail.dialogs.edit.description")}
        onConfirm={(reason) => run(() => manageApi.updateUser(u.id, { reason, ...(name.trim() !== u.full_name ? { full_name: name.trim() } : {}), ...(email.trim().toLowerCase() !== u.email ? { email: email.trim() } : {}) }), t("userDetail.toasts.updated"))}>
        <Input label={t("userDetail.dialogs.edit.fullName")} value={name} onChange={(e) => setName(e.target.value)} />
        <Input label={t("userDetail.dialogs.edit.email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </ConfirmActionDialog>
      <ConfirmActionDialog open={k === "suspend"} title={t("userDetail.dialogs.suspend.title", { name: u.full_name })} confirmLabel={t("userDetail.dialogs.suspend.confirm")} requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.suspend.description")}
        onConfirm={(reason) => run(() => manageApi.suspend(u.id, reason), t("userDetail.toasts.suspended"))} />
      <ConfirmActionDialog open={k === "deactivate"} title={t("userDetail.dialogs.deactivate.title", { name: u.full_name })} confirmLabel={t("userDetail.dialogs.deactivate.confirm")} requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.deactivate.description")}
        onConfirm={(reason) => run(() => manageApi.deactivate(u.id, reason), t("userDetail.toasts.deactivated"))} />
      <ConfirmActionDialog open={k === "reactivate"} title={t("userDetail.dialogs.reactivate.title", { name: u.full_name })} confirmLabel={t("userDetail.dialogs.reactivate.confirm")} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        onConfirm={(reason) => run(() => manageApi.reactivate(u.id, reason), t("userDetail.toasts.reactivated"))} />
      <ConfirmActionDialog open={k === "sessions"} title={t("userDetail.dialogs.sessions.title")} confirmLabel={t("userDetail.dialogs.sessions.confirm")} requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.sessions.description")}
        onConfirm={(reason) => run(() => manageApi.revokeSessions(u.id, reason), t("userDetail.toasts.sessionsRevoked"))} />
      <ConfirmActionDialog open={k === "reset"} title={t("userDetail.dialogs.reset.title")} confirmLabel={t("userDetail.dialogs.reset.confirm")} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.reset.description", { email: u.email })}
        onConfirm={(reason) => run(() => manageApi.sendPasswordReset(u.id, reason), t("userDetail.toasts.resetSent"))} />
      <ConfirmActionDialog open={k === "grant"} title={t("userDetail.dialogs.grant.title")} confirmLabel={t("userDetail.dialogs.grant.confirm")} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel} confirmDisabled={!roleKey}
        onConfirm={(reason) => run(() => manageApi.grantRole(u.id, roleKey, reason), t("userDetail.toasts.roleGranted"), () => setRoleKey(""))}>
        <Select label={t("userDetail.dialogs.grant.role")} value={roleKey} onChange={(e) => setRoleKey(e.target.value)} placeholder={t("userDetail.dialogs.grant.placeholder")}
          options={grantable.map((r) => ({ value: r.key, label: t("userDetail.dialogs.grant.option", { role: roleName(r.key, r.name), count: r.permissions.length }) }))} />
      </ConfirmActionDialog>
      <ConfirmActionDialog open={k === "revoke"} title={t("userDetail.dialogs.revoke.title", { role: dialog?.kind === "revoke" ? roleName(dialog.role) : "" })} confirmLabel={t("userDetail.dialogs.revoke.confirm")} requireReason busy={m.isPending} error={err} onCancel={cancel}
        onConfirm={(reason) => dialog?.kind === "revoke" && run(() => manageApi.revokeRole(u.id, dialog.role, reason), t("userDetail.toasts.roleRevoked"))} />
      <ConfirmActionDialog open={k === "delete"} title={t("userDetail.dialogs.delete.title")} confirmLabel={t("userDetail.dialogs.delete.confirm")} requireReason confirmText={u.email} busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.delete.description")}
        onConfirm={(reason) => m.mutate({ run: () => manageApi.deleteUser(u.id, u.email, reason) }, { onSuccess: () => { done(t("userDetail.toasts.deleted")); navigate("/admin/users", { replace: true }); } })} />
      <ConfirmActionDialog open={k === "assign"} title={sub ? t("userDetail.dialogs.assign.changeTitle") : t("userDetail.dialogs.assign.grantTitle")} confirmLabel={sub ? t("userDetail.dialogs.assign.changeConfirm") : t("userDetail.dialogs.assign.grantConfirm")} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        confirmDisabled={!planKey || (trial && !days)}
        description={sub ? t("userDetail.dialogs.assign.changeDescription") : t("userDetail.dialogs.assign.grantDescription")}
        onConfirm={(reason) => run(() => manageApi.assignSubscription(u.id, { plan_key: planKey, reason, days: days ? Number(days) : null, status: trial ? "trialing" : "active" }), t("userDetail.toasts.planUpdated"))}>
        <Select label={t("userDetail.dialogs.assign.plan")} value={planKey} onChange={(e) => setPlanKey(e.target.value)} placeholder={t("userDetail.dialogs.assign.placeholder")} options={assignablePlans.map((p) => ({ value: p.key, label: p.name }))} />
        <Input label={t("userDetail.dialogs.assign.days")} type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} />
        <Checkbox label={t("userDetail.dialogs.assign.trial")} description={t("userDetail.dialogs.assign.trialHint")} checked={trial} onChange={(e) => setTrial(e.target.checked)} />
      </ConfirmActionDialog>
      <ConfirmActionDialog open={k === "extend"} title={t("userDetail.dialogs.extend.title")} confirmLabel={t("userDetail.dialogs.extend.confirm")} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel} confirmDisabled={!days || Number(days) < 1}
        description={sub?.expires_at ? t("userDetail.dialogs.extend.currentEnd", { date: formatDateTime(sub.expires_at) }) : t("userDetail.dialogs.extend.noEnd")}
        onConfirm={(reason) => sub && run(() => manageApi.extendSubscription(sub.id, { days: Number(days), reason }), t("userDetail.toasts.extended"))}>
        <Input label={t("userDetail.dialogs.extend.days")} type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} />
      </ConfirmActionDialog>
      <ConfirmActionDialog open={k === "cancel"} title={t("userDetail.dialogs.cancel.title")} confirmLabel={t("userDetail.dialogs.cancel.confirm")} requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.cancel.description")}
        onConfirm={(reason) => sub && run(() => manageApi.cancelSubscription(sub.id, { at_period_end: atPeriodEnd, reason }), t("userDetail.toasts.canceled"))}>
        {sub?.expires_at && <Checkbox label={t("userDetail.dialogs.cancel.atPeriodEnd")} description={t("userDetail.dialogs.cancel.accessUntil", { date: formatDateTime(sub.expires_at) })} checked={atPeriodEnd} onChange={(e) => setAtPeriodEnd(e.target.checked)} />}
      </ConfirmActionDialog>
      <ConfirmActionDialog open={k === "status"} title={t("userDetail.dialogs.status.title")} confirmLabel={t("userDetail.dialogs.status.confirm")} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.status.description")}
        onConfirm={(reason) => sub && run(() => manageApi.setSubscriptionStatus(sub.id, { status: newStatus, reason }), t("userDetail.toasts.statusChanged"))}>
        <Select label={t("userDetail.dialogs.status.newStatus")} value={newStatus} onChange={(e) => setNewStatus(e.target.value as SubscriptionStatus)}
          options={(["active", "past_due", "canceled", "expired"] as const).map((v) => ({ value: v, label: statusLabel(v, "subscription") }))} />
      </ConfirmActionDialog>
    </>
  );
}
