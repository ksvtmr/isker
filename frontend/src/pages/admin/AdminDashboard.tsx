import { BarChart, Card, CardHeader, ChartCard, EmptyState, StatCard } from "@isker/design-system";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { can, useMe } from "../../api/auth";
import { useAnalyticsOverview, type AuditEntry } from "../../api/adminManage";
import { ErrorState, PageSkeleton } from "../../components/States";
import { ADMIN_SECTIONS } from "../../layouts/AdminShell";
import { formatDate, formatNumber, formatPercent } from "../../utils/format";
import { AdminPageHeader, formatDateTime, Muted, StatusPill, useAuditLabels } from "./common";

function AuditList({ rows, empty }: { rows: AuditEntry[]; empty: string }) {
  const { t } = useTranslation("admin");
  const labels = useAuditLabels();
  if (!rows.length) return <p style={{ padding: "0 24px 24px", fontSize: 14, color: "var(--color-neutral-500)" }}>{empty}</p>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: "0 24px 16px" }}>
      {rows.map((r) => (
        <li key={r.id} className="ik-list-row" style={{ alignItems: "flex-start" }}>
          <span style={{ minWidth: 0 }}>
            <b style={{ fontWeight: 500 }}>{labels.action(r.action)}</b>
            <span style={{ display: "block" }}><Muted>
              {r.actor_email ?? (r.actor_id ? t("audit.userId", { id: r.actor_id }) : t("audit.systemOrAnonymous"))}
              {r.target_type && r.target_id !== null ? ` → ${t("audit.target", { type: labels.target(r.target_type), id: r.target_id })}` : ""}
              {r.reason ? ` · ${r.reason}` : ""}
            </Muted></span>
          </span>
          <span style={{ textAlign: "right", flex: "none" }}><StatusPill status={r.outcome} kind="outcome" /><span style={{ display: "block", marginTop: 4 }}><Muted>{formatDateTime(r.created_at)}</Muted></span></span>
        </li>
      ))}
    </ul>
  );
}

/** Admin home. Staff without analytics.view see their available sections instead of figures. */
export function AdminDashboard() {
  const { t } = useTranslation("admin");
  const { data: me } = useMe();
  const canAnalytics = can(me, "analytics.view");
  if (!canAnalytics) {
    const sections = ADMIN_SECTIONS.filter((s) => s.id !== "dashboard" && can(me, s.permission));
    return (
      <>
        <AdminPageHeader title={t("dashboard.sectionsTitle")} subtitle={t("dashboard.sectionsSubtitle")} />
        {sections.length === 0 ? <EmptyState icon="lock" title={t("dashboard.noSectionsTitle")} description={t("dashboard.noSectionsText")} /> : (
          <div className="ik-grid-cards">
            {sections.map((s) => (
              <Card key={s.id} padding={20}><Link to={s.path} style={{ fontWeight: 600 }}>{t(s.labelKey)}</Link></Card>
            ))}
          </div>
        )}
      </>
    );
  }
  return <AnalyticsDashboard />;
}

function AnalyticsDashboard() {
  const { t } = useTranslation("admin");
  const { data: o, isLoading, error, refetch } = useAnalyticsOverview(30);
  if (isLoading) return <PageSkeleton chart />;
  if (error || !o) return <><AdminPageHeader title={t("dashboard.title")} /><ErrorState error={error} onRetry={() => refetch()} /></>;
  const s = o.subscriptions;
  const n = formatNumber;
  const restricted = <p style={{ padding: "0 24px 24px", fontSize: 14, color: "var(--color-neutral-500)" }}>{t("dashboard.requiresAudit")}</p>;
  return (
    <>
      <AdminPageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle", { time: formatDateTime(o.generated_at) })} />
      <div className="ik-grid4" style={{ marginBottom: 20 }}>
        <StatCard label={t("dashboard.stats.users")} value={n(o.users.total)}
          description={t("dashboard.stats.usersDesc", { active: n(o.users.active), suspended: n(o.users.suspended), deactivated: n(o.users.deactivated) })} icon="users" />
        <StatCard label={t("dashboard.stats.active7")} value={n(o.users.active_last_7_days)} description={t("dashboard.stats.active7Desc", { count: o.users.new_last_7_days })} icon="trending-up" tone="growth" />
        <StatCard label={t("dashboard.stats.completed")} value={n(o.assessments.completed)}
          description={o.assessments.completion_rate === null ? t("dashboard.stats.completedNone") : t("dashboard.stats.completedDesc", { rate: formatPercent(o.assessments.completion_rate) })} icon="clipboard-check" tone="neutral" />
        <StatCard label={t("dashboard.stats.paid")} value={n(s.paid_users + s.granted_free_of_charge)}
          description={t("dashboard.stats.paidDesc", { free: n(s.free_users), expired: n(s.by_status.expired), canceled: n(s.by_status.canceled) })} icon="credit-card" tone="neutral" />
      </div>
      <div className="ik-grid3" style={{ marginBottom: 20 }}>
        <div className="ik-span2">
          <ChartCard title={t("dashboard.registrations")} description={t("dashboard.registrationsDesc", { count: o.window_days, total: n(o.users.new_in_window) })}>
            {o.users.new_in_window === 0 ? <p style={{ fontSize: 14, color: "var(--color-neutral-500)", padding: "24px 0" }}>{t("dashboard.noRegistrations")}</p>
              : <BarChart ariaLabel={t("dashboard.registrationsAria", { count: o.window_days })} data={o.registrations.map((d) => ({ label: formatDate(d.date, { day: "numeric", month: "short" }), value: d.count }))} />}
          </ChartCard>
        </div>
        <Card>
          <CardHeader title={t("dashboard.learning")} description={t("dashboard.learningDesc", { count: o.window_days })} />
          <dl className="ik-kv" style={{ padding: "0 24px 24px" }}>
            <dt>{t("dashboard.learnersActive")}</dt><dd>{n(o.learning.learners_active_in_window)}</dd>
            <dt>{t("dashboard.resourcesCompleted")}</dt><dd>{n(o.learning.resources_completed_in_window)} <Muted>{t("dashboard.allTimeCount", { count: o.learning.resources_completed })}</Muted></dd>
            <dt>{t("dashboard.tasksCompleted")}</dt><dd>{n(o.learning.tasks_completed)} <Muted>{t("dashboard.allTime")}</Muted></dd>
            <dt>{t("dashboard.planActivities")}</dt><dd>{n(o.learning.plan_activities_completed)} <Muted>{t("dashboard.allTime")}</Muted></dd>
            <dt>{t("dashboard.reassessments")}</dt><dd>{n(o.assessments.reassessments_completed)}</dd>
          </dl>
        </Card>
      </div>
      <div className="ik-grid2">
        <Card>
          <CardHeader title={t("dashboard.recentActions")} action={o.recent_admin_actions ? <Link to="/admin/audit-logs?action=admin.">{t("dashboard.auditLog")}</Link> : undefined} />
          {o.recent_admin_actions ? <AuditList rows={o.recent_admin_actions} empty={t("dashboard.noAdminActions")} /> : restricted}
        </Card>
        <Card>
          <CardHeader title={t("dashboard.securityEvents")}
            description={o.security_summary ? t("dashboard.securitySummary", { failed: n(o.security_summary.failed_logins_7_days), denied: n(o.security_summary.access_denied_7_days) }) : undefined}
            action={o.security_events ? <Link to="/admin/audit-logs?security_only=true">{t("common:actions.viewAll")}</Link> : undefined} />
          {o.security_events ? <AuditList rows={o.security_events} empty={t("dashboard.noSecurityEvents")} /> : restricted}
        </Card>
      </div>
    </>
  );
}
