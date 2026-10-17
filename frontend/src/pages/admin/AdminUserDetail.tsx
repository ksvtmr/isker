import { Badge, Button, Card, CardHeader, Checkbox, ConfirmActionDialog, EmptyState, InlineAlert, Input, KeyValueList, LevelBadge, Select, Tabs, tabPanelProps } from "@isker/design-system";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useAdminMutation } from "../../api/admin";
import { humanize, manageApi, useAdminPlans, useAdminUser, useRoles, type AdminUserDetail, type AuditEntry, type UserUpdateInput } from "../../api/adminManage";
import { featureLabel } from "../../api/billing";
import { can, useMe } from "../../api/auth";
import { ApiError, errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import { LANGUAGE_NAMES, LANGUAGES, isLanguage } from "../../i18n/config";
import type { SubscriptionStatus } from "../../types/api";
import { educationLabel } from "../../features/options";
import i18n from "../../i18n";
import { formatDate, formatNumber } from "../../utils/format";
import { AdminPageHeader, formatDateTime, Muted, RoleBadges, StatusPill, useAuditLabels, useStatusLabel } from "./common";

type Dialog =
  | { kind: "suspend" } | { kind: "reactivate" } | { kind: "deactivate" } | { kind: "sessions" } | { kind: "verify" }
  | { kind: "reset" } | { kind: "grant" } | { kind: "revoke"; role: string } | { kind: "delete" }
  | { kind: "assign" } | { kind: "extend" } | { kind: "cancel" } | { kind: "status" };

const TAB_IDS = ["profile", "subscription", "progress", "activity", "history"] as const;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <Card><CardHeader title={title} description={description} action={action} /><div style={{ padding: "0 24px 24px" }}>{children}</div></Card>;
}

/** Translated label of a permission key (the key itself is shown next to it for administrators). */
export function permissionLabel(key: string): string {
  return i18n.t(`admin:permissions.${key}`, { defaultValue: i18n.t("admin:userDetail.unknownPermission", { key }) });
}

/**
 * Description for a success toast: only a translated message — the API's English `message` is never shown.
 * Known `code`s are translated; otherwise the toast title (already a translated success text) is enough.
 */
export function resultDescription(r: unknown): string | undefined {
  const res = (r ?? {}) as { code?: string | null; delivered?: boolean | null; revoked_sessions?: number | null };
  if (res.code && i18n.exists(`admin:userDetail.results.${res.code}`)) return i18n.t(`admin:userDetail.results.${res.code}`, { count: res.revoked_sessions ?? 0 });
  if (res.delivered === false) return i18n.t("admin:userDetail.results.notDelivered");
  if (typeof res.revoked_sessions === "number") return i18n.t("admin:userDetail.results.sessionsRevoked", { count: res.revoked_sessions });
  return undefined;
}

const languageName = (code: string | null | undefined, none: string) => (code && isLanguage(code) ? LANGUAGE_NAMES[code] : none);

export function AdminUserDetailPage() {
  const { t } = useTranslation("admin");
  const id = Number(useParams().id);
  const { data: me } = useMe();
  const { data: u, isLoading, error, refetch } = useAdminUser(id);
  const [tab, setTab] = useState("profile");
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
    profile: t("userDetail.tabs.profile"), subscription: t("userDetail.tabs.subscription"), progress: t("userDetail.tabs.progress"),
    activity: t("userDetail.tabs.activity"), history: t("userDetail.tabs.history"),
  };
  const tabs = TAB_IDS.map((value) => ({ value, label: tabLabels[value] }));
  const close = () => setDialog(null);

  const actions = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {u.can_manage && u.status === "active" && <Button size="sm" variant="secondary" iconLeft="ban" onClick={() => open({ kind: "suspend" })}>{t("userDetail.actions.suspend")}</Button>}
      {u.can_manage && u.status !== "active" && <Button size="sm" variant="secondary" iconLeft="undo-2" onClick={() => open({ kind: "reactivate" })}>{t("userDetail.actions.reactivate")}</Button>}
    </div>
  );

  return (
    <>
      <AdminPageHeader crumbs={[{ label: t("crumbs.users"), to: "/admin/users" }, { label: u.full_name }]} docTitle={u.full_name}
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
      <div style={{ marginBottom: 20, overflowX: "auto" }}><Tabs id="admin-user" variant="line" ariaLabel={t("userDetail.tabsAria")} tabs={tabs} value={tab} onChange={setTab} /></div>
      <div {...tabPanelProps("admin-user", tab)} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {tab === "profile" && <ProfileTab u={u} canSupport={canSupport} open={open} onReload={() => refetch()} />}
        {tab === "subscription" && <SubscriptionTab u={u} canManage={canSubs} open={open} />}
        {tab === "progress" && <Progress u={u} />}
        {tab === "activity" && <Activity u={u} canSupport={canSupport} open={open} />}
        {tab === "history" && <History u={u} />}
      </div>
      <UserDialogs u={u} dialog={dialog} close={close} />
    </>
  );
}

function ProfileTab({ u, canSupport, open, onReload }: { u: AdminUserDetail; canSupport: boolean; open: (d: Dialog) => void; onReload: () => void }) {
  const { t } = useTranslation("admin");
  const p = u.profile;
  const none = t("common:state.none");
  const roleName = (r: string) => t(`common:roles.${r}`, { defaultValue: humanize(r) });
  const methods = (u.auth_methods ?? []).map((m) => t(`userDetail.authMethods.${m}`)).join(", ") || t("userDetail.authMethods.none");
  return (
    <>
      <div className="ik-grid2" style={{ alignItems: "start" }}>
        <Section title={t("userDetail.sections.account")}>
          <KeyValueList items={[
            { label: t("userDetail.fields.id"), value: t("common:format.id", { id: u.id }) },
            { label: t("userDetail.fields.registered"), value: formatDateTime(u.created_at) },
            { label: t("userDetail.fields.email"), value: <>{u.email} {u.email_verified ? <Badge tone="success">{t("userDetail.emailConfirmed")}</Badge> : <Badge tone="warning">{t("userDetail.emailNotConfirmed")}</Badge>}</> },
            { label: t("userDetail.fields.language"), value: languageName(u.language, t("userDetail.languageNotChosen")) },
            { label: t("userDetail.fields.signIn"), value: methods },
            { label: t("userDetail.fields.status"), value: <StatusPill status={u.status} kind="account" /> },
            { label: t("userDetail.fields.roles"), value: <RoleBadges roles={u.roles} /> },
            { label: t("userDetail.fields.plan"), value: u.plan_name },
            { label: t("userDetail.fields.onboarding"), value: u.onboarding_completed ? t("userDetail.onboardingDone") : t("userDetail.onboardingNotDone") },
            { label: t("userDetail.fields.terms"), value: u.terms_accepted_at ? t("userDetail.termsAccepted", { date: formatDate(u.terms_accepted_at), version: u.terms_version ?? none }) : none },
          ]} />
          {!u.email_verified && canSupport && u.status === "active" && (
            <div style={{ marginTop: 12 }}><Button size="sm" variant="secondary" iconLeft="mail" onClick={() => open({ kind: "verify" })}>{t("userDetail.actions.resendVerification")}</Button></div>
          )}
        </Section>
        {u.can_manage ? <EditForm u={u} onReload={onReload} /> : (
          <Section title={t("userDetail.sections.profile")}>
            {!p ? <Muted>{t("userDetail.noProfile")}</Muted> : <QuestionnaireList u={u} />}
          </Section>
        )}
      </div>
      {u.can_manage && p && <Section title={t("userDetail.sections.profile")}><QuestionnaireList u={u} /></Section>}
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
        {u.permissions.length ? (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 13 }}>{t("userDetail.permissionsSummary", { count: u.permissions.length })}</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
              {u.permissions.map((p) => <li key={p}>{permissionLabel(p)} <Muted><code>{p}</code></Muted></li>)}
            </ul>
          </details>
        ) : <p style={{ marginTop: 12 }}><Muted>{t("userDetail.noPermissions")}</Muted></p>}
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

function QuestionnaireList({ u }: { u: AdminUserDetail }) {
  const { t } = useTranslation("admin");
  const p = u.profile;
  const none = t("common:state.none");
  if (!p) return null;
  return (
    <KeyValueList items={[
      { label: t("userDetail.fields.education"), value: p.education ? educationLabel(String(p.education)) : none },
      { label: t("userDetail.fields.experience"), value: p.entrepreneurial_experience ? t(`admin:userDetail.experience.${p.entrepreneurial_experience}`, { defaultValue: humanize(String(p.entrepreneurial_experience)) }) : none },
      { label: t("userDetail.fields.format"), value: p.preferred_learning_format ? t(`admin:userDetail.format.${p.preferred_learning_format}`, { defaultValue: humanize(String(p.preferred_learning_format)) }) : none },
      { label: t("userDetail.fields.weeklyTime"), value: p.weekly_learning_minutes ? t("common:time.minutes", { count: Number(p.weekly_learning_minutes) }) : none },
      { label: t("userDetail.fields.goals"), value: u.goals.length ? u.goals.join(", ") : none },
      { label: t("userDetail.fields.background"), value: p.background ?? none },
    ]} />
  );
}

interface FormValues { full_name: string; email: string; language: string; reason: string }
const fromUser = (u: AdminUserDetail): FormValues => ({ full_name: u.full_name, email: u.email, language: u.language ?? "", reason: "" });

/**
 * Inline profile editor with optimistic locking: the version loaded with the form is sent as expected_version, so an
 * edit based on stale data is refused (409 VERSION_CONFLICT) instead of silently overwriting another admin's change.
 */
function EditForm({ u, onReload }: { u: AdminUserDetail; onReload: () => void }) {
  const { t } = useTranslation("admin");
  const toast = useToast();
  const [values, setValues] = useState<FormValues>(() => fromUser(u));
  const [baseVersion, setBaseVersion] = useState(u.lock_version);
  const [base, setBase] = useState<FormValues>(() => fromUser(u));
  const [submitted, setSubmitted] = useState(false);
  const m = useAdminMutation((body: UserUpdateInput) => manageApi.updateUser(u.id, body));
  const dirty = values.full_name !== base.full_name || values.email !== base.email || values.language !== base.language;
  // A refetch (focus, live sync, another dialog) brings newer data: adopt it unless the form has unsaved edits.
  useEffect(() => {
    if (u.lock_version === baseVersion || dirty) return;
    const next = fromUser(u);
    setValues(next); setBase(next); setBaseVersion(u.lock_version); m.reset();
  }, [u.lock_version]); // eslint-disable-line react-hooks/exhaustive-deps
  const staleWhileEditing = dirty && u.lock_version !== baseVersion;
  const conflict = m.error instanceof ApiError && m.error.code === "VERSION_CONFLICT";
  const errors = {
    full_name: values.full_name.trim().length < 2 ? t("userDetail.form.nameInvalid") : undefined,
    email: !EMAIL_RE.test(values.email.trim()) ? t("userDetail.form.emailInvalid") : undefined,
    reason: values.reason.trim().length < 3 ? t("userDetail.form.reasonInvalid") : undefined,
  };
  const server = m.error instanceof ApiError ? m.error.fieldErrors() : {};
  const show = (k: keyof typeof errors) => (submitted || (k !== "reason" && values[k] !== base[k]) ? errors[k] : undefined) ?? server[k];
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const reset = () => { setValues(base); setSubmitted(false); m.reset(); };
  const reload = () => { const next = fromUser(u); setValues(next); setBase(next); setBaseVersion(u.lock_version); setSubmitted(false); m.reset(); onReload(); };
  const save = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!dirty || errors.full_name || errors.email || errors.reason) return;
    const body: UserUpdateInput = { reason: values.reason.trim(), expected_version: baseVersion };
    if (values.full_name.trim() !== base.full_name) body.full_name = values.full_name.trim();
    if (values.email.trim().toLowerCase() !== base.email) body.email = values.email.trim();
    if (values.language && values.language !== base.language) body.language = values.language;
    m.mutate(body, {
      onSuccess: (fresh) => {
        const next = fromUser(fresh);
        setValues(next); setBase(next); setBaseVersion(fresh.lock_version); setSubmitted(false);
        toast({ title: t("userDetail.toasts.updated") });
      },
      onError: (err) => { if (!(err instanceof ApiError && err.code === "VERSION_CONFLICT")) toast({ title: t("userDetail.toasts.saveFailed"), description: errorMessage(err), variant: "error" }); },
    });
  };
  return (
    <Section title={t("userDetail.form.title")} description={t("userDetail.form.description")}>
      <form onSubmit={save} noValidate aria-label={t("userDetail.form.title")} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {conflict && (
          <InlineAlert tone="warning" title={t("userDetail.conflict.title")}>
            {t("userDetail.conflict.text")}{" "}
            <Button type="button" size="sm" variant="secondary" onClick={reload}>{t("userDetail.conflict.reload")}</Button>
          </InlineAlert>
        )}
        {!conflict && staleWhileEditing && <InlineAlert tone="info">{t("userDetail.conflict.changedMeanwhile")}</InlineAlert>}
        {m.error && !conflict && <InlineAlert>{errorMessage(m.error)}</InlineAlert>}
        <Input label={t("userDetail.dialogs.edit.fullName")} value={values.full_name} onChange={set("full_name")} error={show("full_name")} maxLength={120} />
        <Input label={t("userDetail.dialogs.edit.email")} type="email" value={values.email} onChange={set("email")} error={show("email")}
          hint={values.email.trim().toLowerCase() !== base.email ? t("userDetail.dialogs.edit.description") : undefined} />
        <Select label={t("userDetail.fields.language")} value={values.language} onChange={set("language")}
          placeholder={base.language ? undefined : t("userDetail.languageNotChosen")}
          options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))} />
        <Input label={t("userDetail.form.reason")} value={values.reason} onChange={set("reason")} error={show("reason")} maxLength={500} hint={t("userDetail.form.reasonHint")} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button type="submit" loading={m.isPending} disabled={!dirty || m.isPending}>{m.isPending ? t("common:state.saving") : t("common:actions.saveChanges")}</Button>
          <Button type="button" variant="ghost" onClick={reset} disabled={(!dirty && !values.reason) || m.isPending}>{t("userDetail.form.reset")}</Button>
          {dirty && !m.isPending && <Muted>{t("userDetail.form.unsaved")}</Muted>}
        </div>
      </form>
    </Section>
  );
}

function Progress({ u }: { u: AdminUserDetail }) {
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
      <Section title={t("userDetail.sections.entitlements")} description={t("userDetail.entitlementsDesc")}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {(u.entitlements ?? []).map((e) => (
            <li key={e.key} className="ik-list-row">
              <span>{featureLabel(e.key)}</span>
              {!e.enabled ? <Badge tone="neutral">{t("userDetail.entitlementOff")}</Badge>
                : e.kind === "limit" && e.limit !== null ? <Badge tone="info">{t("userDetail.entitlementLimit", { count: e.limit, days: e.window_days ?? 30 })}</Badge>
                : <Badge tone="success">{t("userDetail.entitlementOn")}</Badge>}
            </li>
          ))}
        </ul>
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

function Activity({ u, canSupport, open }: { u: AdminUserDetail; canSupport: boolean; open: (d: Dialog) => void }) {
  const { t } = useTranslation("admin");
  return (
    <>
      <div className="ik-grid2" style={{ alignItems: "start" }}>
        <Section title={t("userDetail.sections.lastActivity")} description={t("userDetail.lastActivityDesc")}>
          <KeyValueList items={[
            { label: t("userDetail.fields.lastSignIn"), value: u.last_login_at ? formatDateTime(u.last_login_at) : t("common:state.never") },
            { label: t("userDetail.fields.lastActive"), value: u.last_seen_at ? formatDateTime(u.last_seen_at) : t("common:state.never") },
          ]} />
        </Section>
        <Section title={t("userDetail.sections.sessions")} description={t("userDetail.sessionsCount", { count: u.sessions.length })}
          action={canSupport && u.sessions.length ? <Button size="sm" variant="secondary" iconLeft="log-out" onClick={() => open({ kind: "sessions" })}>{t("userDetail.actions.revokeSessions")}</Button> : undefined}>
          {!u.sessions.length ? <Muted>{t("userDetail.noSessions")}</Muted> : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {u.sessions.map((s) => <li key={s.id} className="ik-list-row"><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{s.user_agent ?? t("userDetail.unknownDevice")}</span><Muted>{t("userDetail.since", { date: formatDateTime(s.created_at) })}</Muted></li>)}
            </ul>
          )}
        </Section>
      </div>
      {u.activity == null ? <EmptyState icon="lock" title={t("userDetail.auditRestrictedTitle")} description={t("userDetail.auditRestrictedText")} /> : (
        <Section title={t("userDetail.sections.recentActivity")} description={t("userDetail.activityDesc", { count: 50 })}>
          <AuditList rows={u.activity} userId={u.id} empty={t("userDetail.noEvents")} />
        </Section>
      )}
    </>
  );
}

function History({ u }: { u: AdminUserDetail }) {
  const { t } = useTranslation("admin");
  if (u.change_history == null) return <EmptyState icon="lock" title={t("userDetail.auditRestrictedTitle")} description={t("userDetail.auditRestrictedText")} />;
  return (
    <Section title={t("userDetail.sections.history")} description={t("userDetail.historyDesc")}>
      <AuditList rows={u.change_history} userId={u.id} empty={t("userDetail.noChanges")} withChanges />
    </Section>
  );
}

type Change = { from?: unknown; to?: unknown; changed?: boolean };

function ChangeValue({ v }: { v: unknown }) {
  const { t } = useTranslation("admin");
  if (v === null || v === undefined || v === "") return <Muted>{t("common:state.none")}</Muted>;
  if (typeof v === "boolean") return <>{v ? t("common:state.yes") : t("common:state.no")}</>;
  if (Array.isArray(v)) return <>{v.map(String).join(", ") || t("common:state.none")}</>;
  return <>{String(v)}</>;
}

/** Audit rows; with `withChanges`, each changed field is listed old → new (secrets are only reported as changed). */
function AuditList({ rows, userId, empty, withChanges = false }: { rows: AuditEntry[]; userId: number; empty: string; withChanges?: boolean }) {
  const { t } = useTranslation("admin");
  const labels = useAuditLabels();
  if (!rows.length) return <Muted>{empty}</Muted>;
  const actor = (e: AuditEntry) => (e.actor_id === userId ? t("userDetail.byTheUser") : e.actor_id ? (e.actor_email ?? t("userDetail.byUser", { id: e.actor_id })) : t("userDetail.bySystem"));
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map((e) => {
        const ch = (withChanges && e.details && typeof e.details.changes === "object" ? e.details.changes : null) as Record<string, Change> | null;
        return (
          <li key={e.id} className="ik-list-row" style={{ alignItems: "flex-start" }}>
            <span style={{ minWidth: 0 }}>
              <b style={{ fontWeight: 500 }}>{labels.action(e.action)}</b>
              <span style={{ display: "block" }}><Muted>{actor(e)}{e.reason ? ` · ${t("userDetail.reasonShort", { reason: e.reason })}` : ""} · {e.action}</Muted></span>
              {ch && Object.keys(ch).length > 0 && (
                <ul aria-label={t("userDetail.changedFields")} style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
                  {Object.entries(ch).map(([field, c]) => (
                    <li key={field}>
                      <span style={{ fontWeight: 500 }}>{t(`userDetail.historyFields.${field}`, { defaultValue: humanize(field) })}</span>:{" "}
                      {c.changed ? t("userDetail.valueChanged") : <><ChangeValue v={c.from} /> → <ChangeValue v={c.to} /></>}
                    </li>
                  ))}
                </ul>
              )}
            </span>
            <span style={{ textAlign: "right" }}><StatusPill status={e.outcome} kind="outcome" /><span style={{ display: "block", marginTop: 4 }}><Muted>{formatDateTime(e.created_at)}</Muted></span></span>
          </li>
        );
      })}
    </ul>
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
  const [roleKey, setRoleKey] = useState("");
  const [planKey, setPlanKey] = useState("");
  const [days, setDays] = useState("");
  const [trial, setTrial] = useState(false);
  const [atPeriodEnd, setAtPeriodEnd] = useState(false);
  const [newStatus, setNewStatus] = useState<SubscriptionStatus>("active");
  useEffect(() => {
    if (!dialog) return;
    setRoleKey(""); setPlanKey(""); setDays(""); setTrial(false); setAtPeriodEnd(false); setNewStatus("active");
  }, [dialog]);
  const m = useAdminMutation(async ({ run }: { run: () => Promise<{ message?: string } | unknown> }) => run());
  const done = (title: string, description?: string) => { toast({ title, description }); close(); m.reset(); };
  const run = (fn: () => Promise<unknown>, title: string, after?: () => void) =>
    m.mutate({ run: fn }, { onSuccess: (r) => { done(title, resultDescription(r)); after?.(); } });
  const cancel = () => { m.reset(); close(); };
  const err = m.error ? errorMessage(m.error) : undefined;
  const k = dialog?.kind;
  const sub = u.subscription;
  const assignablePlans = (plans.data ?? []).filter((p) => p.is_active && !p.is_default);
  const grantable = (roles.data ?? []).filter((r) => !u.roles.includes(r.key) && r.key !== "user");
  const roleName = (r: string, fallback?: string) => t(`common:roles.${r}`, { defaultValue: fallback ?? humanize(r) });

  return (
    <>
      <ConfirmActionDialog open={k === "suspend"} title={t("userDetail.dialogs.suspend.title", { name: u.full_name })} confirmLabel={t("userDetail.dialogs.suspend.confirm")} requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.suspend.description")}
        onConfirm={(reason) => run(() => manageApi.suspend(u.id, reason, u.lock_version), t("userDetail.toasts.suspended"))} />
      <ConfirmActionDialog open={k === "deactivate"} title={t("userDetail.dialogs.deactivate.title", { name: u.full_name })} confirmLabel={t("userDetail.dialogs.deactivate.confirm")} requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.deactivate.description")}
        onConfirm={(reason) => run(() => manageApi.deactivate(u.id, reason, u.lock_version), t("userDetail.toasts.deactivated"))} />
      <ConfirmActionDialog open={k === "reactivate"} title={t("userDetail.dialogs.reactivate.title", { name: u.full_name })} confirmLabel={t("userDetail.dialogs.reactivate.confirm")} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        onConfirm={(reason) => run(() => manageApi.reactivate(u.id, reason, u.lock_version), t("userDetail.toasts.reactivated"))} />
      <ConfirmActionDialog open={k === "sessions"} title={t("userDetail.dialogs.sessions.title")} confirmLabel={t("userDetail.dialogs.sessions.confirm")} requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.sessions.description")}
        onConfirm={(reason) => run(() => manageApi.revokeSessions(u.id, reason), t("userDetail.toasts.sessionsRevoked"))} />
      <ConfirmActionDialog open={k === "reset"} title={t("userDetail.dialogs.reset.title")} confirmLabel={t("userDetail.dialogs.reset.confirm")} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.reset.description", { email: u.email })}
        onConfirm={(reason) => run(() => manageApi.sendPasswordReset(u.id, reason), t("userDetail.toasts.resetSent"))} />
      <ConfirmActionDialog open={k === "verify"} title={t("userDetail.dialogs.verify.title")} confirmLabel={t("userDetail.dialogs.verify.confirm")} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel}
        description={t("userDetail.dialogs.verify.description", { email: u.email })}
        onConfirm={(reason) => run(() => manageApi.resendVerification(u.id, reason), t("userDetail.toasts.verificationSent"))} />
      <ConfirmActionDialog open={k === "grant"} title={t("userDetail.dialogs.grant.title")} confirmLabel={t("userDetail.dialogs.grant.confirm")} tone="primary" requireReason busy={m.isPending} error={err} onCancel={cancel} confirmDisabled={!roleKey}
        onConfirm={(reason) => run(() => manageApi.grantRole(u.id, roleKey, reason, u.lock_version), t("userDetail.toasts.roleGranted"), () => setRoleKey(""))}>
        <Select label={t("userDetail.dialogs.grant.role")} value={roleKey} onChange={(e) => setRoleKey(e.target.value)} placeholder={t("userDetail.dialogs.grant.placeholder")}
          options={grantable.map((r) => ({ value: r.key, label: t("userDetail.dialogs.grant.option", { role: roleName(r.key, r.name), count: r.permissions.length }) }))} />
      </ConfirmActionDialog>
      <ConfirmActionDialog open={k === "revoke"} title={t("userDetail.dialogs.revoke.title", { role: dialog?.kind === "revoke" ? roleName(dialog.role) : "" })} confirmLabel={t("userDetail.dialogs.revoke.confirm")} requireReason busy={m.isPending} error={err} onCancel={cancel}
        onConfirm={(reason) => dialog?.kind === "revoke" && run(() => manageApi.revokeRole(u.id, dialog.role, reason, u.lock_version), t("userDetail.toasts.roleRevoked"))} />
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
