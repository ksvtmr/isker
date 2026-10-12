import { Badge, Button, Card, CardHeader, Checkbox, ConfirmActionDialog, EmptyState, InlineAlert, Input, KeyValueList, LevelBadge, Select, Tabs } from "@isker/design-system";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAdminMutation } from "../../api/admin";
import { ROLE_LABELS, humanize, manageApi, useAdminPlans, useAdminUser, useRoles, type AdminUserDetail } from "../../api/adminManage";
import { can, useMe } from "../../api/auth";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import type { SubscriptionStatus } from "../../types/api";
import { formatDate } from "../../utils/format";
import { AdminPageHeader, formatDateTime, Muted, RoleBadges, StatusPill } from "./common";

type Dialog =
  | { kind: "edit" } | { kind: "suspend" } | { kind: "reactivate" } | { kind: "deactivate" } | { kind: "sessions" }
  | { kind: "reset" } | { kind: "grant" } | { kind: "revoke"; role: string } | { kind: "delete" }
  | { kind: "assign" } | { kind: "extend" } | { kind: "cancel" } | { kind: "status" };

const TABS = [
  { value: "overview", label: "Overview" }, { value: "learning", label: "Assessments & progress" },
  { value: "subscription", label: "Subscription" }, { value: "security", label: "Roles & security" }, { value: "activity", label: "Activity" },
];

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <Card><CardHeader title={title} description={description} action={action} /><div style={{ padding: "0 24px 24px" }}>{children}</div></Card>;
}

export function AdminUserDetailPage() {
  const id = Number(useParams().id);
  const { data: me } = useMe();
  const { data: u, isLoading, error, refetch } = useAdminUser(id);
  const [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !u) {
    return <><AdminPageHeader crumbs={[{ label: "Users", to: "/admin/users" }, { label: `User #${id}` }]} title="User" /><ErrorState error={error} onRetry={() => refetch()} /></>;
  }
  const isSelf = me?.id === u.id;
  const canSupport = can(me, "users.support") && !isSelf;
  const canSubs = can(me, "subscriptions.manage");
  const open = (d: Dialog) => setDialog(d);
  const close = () => setDialog(null);

  const actions = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {u.can_manage && <Button size="sm" variant="secondary" iconLeft="pencil" onClick={() => open({ kind: "edit" })}>Edit</Button>}
      {u.can_manage && u.status === "active" && <Button size="sm" variant="secondary" iconLeft="ban" onClick={() => open({ kind: "suspend" })}>Suspend</Button>}
      {u.can_manage && u.status !== "active" && <Button size="sm" variant="secondary" iconLeft="undo-2" onClick={() => open({ kind: "reactivate" })}>Reactivate</Button>}
    </div>
  );

  return (
    <>
      <AdminPageHeader crumbs={[{ label: "Users", to: "/admin/users" }, { label: u.full_name }]}
        title={<span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{u.full_name} <StatusPill status={u.status} /></span>}
        subtitle={<>{u.email} · registered {formatDate(u.created_at)}{isSelf ? " · this is you" : ""}</>} action={actions} />
      {u.status !== "active" && (
        <div style={{ marginBottom: 16 }}>
          <InlineAlert tone="warning" title={`Account ${u.status}`}>
            {u.status_reason ? `Reason: ${u.status_reason}. ` : ""}{u.status_changed_at ? `Changed ${formatDateTime(u.status_changed_at)}.` : ""}
            {u.deletion_requested_at ? " The user closed the account themselves." : ""}
          </InlineAlert>
        </div>
      )}
      <div style={{ marginBottom: 20, overflowX: "auto" }}><Tabs variant="line" ariaLabel="User details" tabs={TABS} value={tab} onChange={setTab} /></div>
      <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
  const p = u.profile;
  return (
    <div className="ik-grid2" style={{ alignItems: "start" }}>
      <Section title="Account">
        <KeyValueList items={[
          { label: "Email", value: <>{u.email} {u.email_verified_at ? <Badge tone="success">Confirmed</Badge> : <Badge tone="warning">Not confirmed</Badge>}</> },
          { label: "Roles", value: <RoleBadges roles={u.roles} /> },
          { label: "Plan", value: u.plan_name },
          { label: "Onboarding", value: u.onboarding_completed ? "Completed" : "Not completed" },
          { label: "Terms accepted", value: u.terms_accepted_at ? `${formatDate(u.terms_accepted_at)} (version ${u.terms_version})` : "—" },
          { label: "Last sign-in", value: formatDateTime(u.last_login_at) },
          { label: "Last active", value: formatDateTime(u.last_seen_at) },
        ]} />
      </Section>
      <Section title="Profile">
        {!p ? <Muted>No profile yet.</Muted> : (
          <KeyValueList items={[
            { label: "Education", value: p.education ?? "—" },
            { label: "Experience", value: p.entrepreneurial_experience ? humanize(String(p.entrepreneurial_experience)) : "—" },
            { label: "Preferred format", value: p.preferred_learning_format ? humanize(String(p.preferred_learning_format)) : "—" },
            { label: "Weekly time", value: p.weekly_learning_minutes ? `${p.weekly_learning_minutes} min` : "—" },
            { label: "Goals", value: u.goals.length ? u.goals.join(", ") : "—" },
            { label: "Background", value: p.background ?? "—" },
          ]} />
        )}
      </Section>
    </div>
  );
}

function Learning({ u }: { u: AdminUserDetail }) {
  return (
    <>
      <div className="ik-grid2" style={{ alignItems: "start" }}>
        <Section title="Assessments" description={`${u.attempts.length} attempt(s)`}>
          {!u.attempts.length ? <Muted>No assessments started.</Muted> : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {u.attempts.map((a) => (
                <li key={a.id} className="ik-list-row">
                  <span>{a.scope === "full" ? "Full assessment" : "Competency reassessment"} <Muted>· started {formatDate(a.started_at)}</Muted></span>
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>{a.overall_score !== null && <b>{a.overall_score}</b>}<Badge tone={a.status === "completed" ? "success" : a.status === "abandoned" ? "neutral" : "info"}>{humanize(a.status)}</Badge></span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Learning and practice">
          <KeyValueList items={[
            { label: "Resources completed", value: u.learning.completed }, { label: "Resources in progress", value: u.learning.in_progress },
            { label: "Tasks completed", value: u.practice.completed }, { label: "Tasks in progress", value: u.practice.in_progress },
          ]} />
        </Section>
      </div>
      <Section title="Competency profile" description="Latest measurement per competency">
        {!u.competencies.length ? <Muted>Not assessed yet.</Muted> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {u.competencies.map((c) => (
              <li key={c.code} className="ik-list-row"><span>{c.name}</span><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><b>{c.score}</b>{c.level && <LevelBadge level={c.level} />}</span></li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function SubscriptionTab({ u, canManage, open }: { u: AdminUserDetail; canManage: boolean; open: (d: Dialog) => void }) {
  const s = u.subscription;
  return (
    <>
      <Section title={`Plan: ${u.plan_name}`} description={s ? `Source: ${s.source}${s.note ? ` · ${s.note}` : ""}` : "No subscription: the user is on the default plan."}
        action={canManage ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" variant="secondary" onClick={() => open({ kind: "assign" })}>{s ? "Change plan" : "Grant a plan"}</Button>
            {s && <Button size="sm" variant="secondary" onClick={() => open({ kind: "extend" })}>Extend</Button>}
            {s && <Button size="sm" variant="secondary" onClick={() => open({ kind: "status" })}>Change status</Button>}
            {s && <Button size="sm" variant="danger" onClick={() => open({ kind: "cancel" })}>Cancel subscription</Button>}
          </div>
        ) : undefined}>
        {s ? (
          <KeyValueList items={[
            { label: "Status", value: <StatusPill status={s.status} /> },
            { label: "Started", value: formatDateTime(s.started_at) },
            { label: "Ends", value: s.expires_at ? `${formatDateTime(s.expires_at)}${s.cancel_at_period_end ? " (canceled at period end)" : ""}` : "No end date" },
          ]} />
        ) : <Muted>Users without a subscription automatically get the Free plan.</Muted>}
      </Section>
      <Section title="Subscription history">
        {!u.subscription_history.length ? <Muted>No subscription events.</Muted> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {u.subscription_history.map((e) => (
              <li key={e.id} className="ik-list-row" style={{ alignItems: "flex-start" }}>
                <span>
                  <b style={{ fontWeight: 500 }}>{humanize(e.event_type)}</b>{e.to_status ? ` → ${e.to_status.replace("_", " ")}` : ""}
                  <span style={{ display: "block" }}><Muted>{e.source}{e.actor_id ? ` · by user #${e.actor_id}` : ""}{e.reason ? ` · ${e.reason}` : ""}</Muted></span>
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
  return (
    <>
      <Section title="Roles" description="Roles decide what this person can do. You can only grant roles ranked below your own."
        action={u.can_assign_roles ? <Button size="sm" variant="secondary" iconLeft="plus" onClick={() => open({ kind: "grant" })}>Grant role</Button> : undefined}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {u.roles.map((r) => (
            <li key={r} className="ik-list-row">
              <span>{ROLE_LABELS[r] ?? humanize(r)}</span>
              {u.can_assign_roles && <Button size="sm" variant="ghost" aria-label={`Revoke role ${ROLE_LABELS[r] ?? r}`} onClick={() => open({ kind: "revoke", role: r })}>Revoke</Button>}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Active sessions" description={`${u.sessions.length} signed-in device(s)`}
        action={canSupport && u.sessions.length ? <Button size="sm" variant="secondary" iconLeft="log-out" onClick={() => open({ kind: "sessions" })}>Sign out everywhere</Button> : undefined}>
        {!u.sessions.length ? <Muted>No active sessions.</Muted> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {u.sessions.map((s) => <li key={s.id} className="ik-list-row"><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{s.user_agent ?? "Unknown device"}</span><Muted>since {formatDateTime(s.created_at)}</Muted></li>)}
          </ul>
        )}
      </Section>
      <Section title="Account recovery and lifecycle">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canSupport && <Button size="sm" variant="secondary" iconLeft="key-round" onClick={() => open({ kind: "reset" })}>Send password reset link</Button>}
          {u.can_manage && u.status !== "deactivated" && <Button size="sm" variant="secondary" iconLeft="user-x" onClick={() => open({ kind: "deactivate" })}>Deactivate account</Button>}
          {u.can_delete && <Button size="sm" variant="danger" iconLeft="trash-2" onClick={() => open({ kind: "delete" })}>Delete permanently</Button>}
        </div>
        <p style={{ marginTop: 12 }}><Muted>Staff never see or set passwords. Deactivation keeps the data and can be undone; permanent deletion is only possible for deactivated accounts and requires a super administrator.</Muted></p>
      </Section>
    </>
  );
}

function Activity({ u }: { u: AdminUserDetail }) {
  if (u.audit_events === null) return <EmptyState icon="lock" title="Audit events are restricted" description="Viewing this user's audit trail requires the audit.view permission." />;
  return (
    <Section title="Audit trail" description="Actions by or about this account (latest 50)">
      {!u.audit_events.length ? <Muted>No events.</Muted> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {u.audit_events.map((e) => (
            <li key={e.id} className="ik-list-row" style={{ alignItems: "flex-start" }}>
              <span><b style={{ fontWeight: 500 }}>{humanize(e.action)}</b><span style={{ display: "block" }}><Muted>{e.actor_id === u.id ? "by the user" : e.actor_id ? `by user #${e.actor_id}` : "system"}{e.reason ? ` · ${e.reason}` : ""}</Muted></span></span>
              <span style={{ textAlign: "right" }}><StatusPill status={e.outcome} /><span style={{ display: "block", marginTop: 4 }}><Muted>{formatDateTime(e.created_at)}</Muted></span></span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Every dialog closes only after the API confirms; errors stay inside the dialog. */
function UserDialogs({ u, dialog, close }: { u: AdminUserDetail; dialog: Dialog | null; close: () => void }) {
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
  const run = (fn: () => Promise<unknown>, title: string | ((r: unknown) => string), after?: () => void) =>
    m.mutate({ run: fn }, { onSuccess: (r) => { const msg = (r as { message?: string } | undefined)?.message; done(typeof title === "function" ? title(r) : title, typeof title === "function" ? undefined : msg); after?.(); } });
  const cancel = () => { m.reset(); close(); };
  const err = m.error ? errorMessage(m.error) : undefined;
  const k = dialog?.kind;
  const sub = u.subscription;
  const assignablePlans = (plans.data ?? []).filter((p) => p.is_active && !p.is_default);
  const grantable = (roles.data ?? []).filter((r) => !u.roles.includes(r.key) && r.key !== "user");

  return (
    <>
      <ConfirmActionDialog open={k === "edit"} title="Edit account" confirmLabel="Save changes" tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        confirmDisabled={name.trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
        description="Changing the email removes its confirmed status."
        onConfirm={(reason) => run(() => manageApi.updateUser(u.id, { reason, ...(name.trim() !== u.full_name ? { full_name: name.trim() } : {}), ...(email.trim().toLowerCase() !== u.email ? { email: email.trim() } : {}) }), "Account updated")}>
        <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </ConfirmActionDialog>
      <ConfirmActionDialog open={k === "suspend"} title={`Suspend ${u.full_name}?`} confirmLabel="Suspend account" requireReason busy={m.isPending} error={err} onCancel={cancel}
        description="They'll be signed out on all devices and can't sign in until reactivated."
        onConfirm={(reason) => run(() => manageApi.suspend(u.id, reason), "Account suspended")} />
      <ConfirmActionDialog open={k === "deactivate"} title={`Deactivate ${u.full_name}?`} confirmLabel="Deactivate account" requireReason busy={m.isPending} error={err} onCancel={cancel}
        description="The account is closed and signed out. Data is kept and the account can be reactivated."
        onConfirm={(reason) => run(() => manageApi.deactivate(u.id, reason), "Account deactivated")} />
      <ConfirmActionDialog open={k === "reactivate"} title={`Reactivate ${u.full_name}?`} confirmLabel="Reactivate" tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        onConfirm={(reason) => run(() => manageApi.reactivate(u.id, reason), "Account reactivated")} />
      <ConfirmActionDialog open={k === "sessions"} title="Sign this user out everywhere?" confirmLabel="Sign out all devices" requireReason busy={m.isPending} error={err} onCancel={cancel}
        onConfirm={(reason) => run(() => manageApi.revokeSessions(u.id, reason), "Sessions revoked")} />
      <ConfirmActionDialog open={k === "reset"} title="Send a password reset link?" confirmLabel="Send link" tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={`A one-time link is sent to ${u.email}. You won't see the link or the new password.`}
        onConfirm={(reason) => run(() => manageApi.sendPasswordReset(u.id, reason), (r) => (r as { message: string }).message)} />
      <ConfirmActionDialog open={k === "grant"} title="Grant a role" confirmLabel="Grant role" tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel} confirmDisabled={!roleKey}
        onConfirm={(reason) => run(() => manageApi.grantRole(u.id, roleKey, reason), "Role granted", () => setRoleKey(""))}>
        <Select label="Role" value={roleKey} onChange={(e) => setRoleKey(e.target.value)} placeholder="Choose a role…"
          options={grantable.map((r) => ({ value: r.key, label: `${r.name} — ${r.permissions.length} permissions` }))} />
      </ConfirmActionDialog>
      <ConfirmActionDialog open={k === "revoke"} title={`Revoke the ${dialog?.kind === "revoke" ? ROLE_LABELS[dialog.role] ?? dialog.role : ""} role?`} confirmLabel="Revoke role" requireReason busy={m.isPending} error={err} onCancel={cancel}
        onConfirm={(reason) => dialog?.kind === "revoke" && run(() => manageApi.revokeRole(u.id, dialog.role, reason), "Role revoked")} />
      <ConfirmActionDialog open={k === "delete"} title="Delete this account permanently?" confirmLabel="Delete permanently" requireReason confirmText={u.email} busy={m.isPending} error={err} onCancel={cancel}
        description="All personal data, answers and progress are deleted. This cannot be undone. The audit log keeps only the numeric account id."
        onConfirm={(reason) => m.mutate({ run: () => manageApi.deleteUser(u.id, u.email, reason) }, { onSuccess: () => { done("Account deleted"); navigate("/admin/users", { replace: true }); } })} />
      <ConfirmActionDialog open={k === "assign"} title={sub ? "Change plan" : "Grant a plan"} confirmLabel={sub ? "Change plan" : "Grant plan"} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        confirmDisabled={!planKey || (trial && !days)}
        description={sub ? "The current subscription is canceled and replaced. This is recorded in the history." : "No payment is taken: this is a manual grant, recorded with your name and reason."}
        onConfirm={(reason) => run(() => manageApi.assignSubscription(u.id, { plan_key: planKey, reason, days: days ? Number(days) : null, status: trial ? "trialing" : "active" }), "Plan updated")}>
        <Select label="Plan" value={planKey} onChange={(e) => setPlanKey(e.target.value)} placeholder="Choose a plan…" options={assignablePlans.map((p) => ({ value: p.key, label: p.name }))} />
        <Input label="Duration in days (leave empty for no end date)" type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} />
        <Checkbox label="Mark as a trial" description="Trials need a duration." checked={trial} onChange={(e) => setTrial(e.target.checked)} />
      </ConfirmActionDialog>
      <ConfirmActionDialog open={k === "extend"} title="Extend subscription" confirmLabel="Extend" tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel} confirmDisabled={!days || Number(days) < 1}
        description={sub?.expires_at ? `Currently ends ${formatDateTime(sub.expires_at)}.` : "This subscription has no end date; extending adds an end date from today."}
        onConfirm={(reason) => sub && run(() => manageApi.extendSubscription(sub.id, { days: Number(days), reason }), "Subscription extended")}>
        <Input label="Add days" type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} />
      </ConfirmActionDialog>
      <ConfirmActionDialog open={k === "cancel"} title="Cancel subscription?" confirmLabel="Cancel subscription" requireReason busy={m.isPending} error={err} onCancel={cancel}
        description="The user returns to the Free plan when the subscription ends."
        onConfirm={(reason) => sub && run(() => manageApi.cancelSubscription(sub.id, { at_period_end: atPeriodEnd, reason }), "Subscription canceled")}>
        {sub?.expires_at && <Checkbox label="Cancel at the end of the current period" description={`Access continues until ${formatDateTime(sub.expires_at)}.`} checked={atPeriodEnd} onChange={(e) => setAtPeriodEnd(e.target.checked)} />}
      </ConfirmActionDialog>
      <ConfirmActionDialog open={k === "status"} title="Change subscription status" confirmLabel="Change status" tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        description="Only allowed transitions are accepted (for example active → past due, past due → active)."
        onConfirm={(reason) => sub && run(() => manageApi.setSubscriptionStatus(sub.id, { status: newStatus, reason }), "Status changed")}>
        <Select label="New status" value={newStatus} onChange={(e) => setNewStatus(e.target.value as SubscriptionStatus)}
          options={["active", "past_due", "canceled", "expired"].map((v) => ({ value: v, label: humanize(v) }))} />
      </ConfirmActionDialog>
    </>
  );
}
