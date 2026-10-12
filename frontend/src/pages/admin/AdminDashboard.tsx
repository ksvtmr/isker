import { BarChart, Card, CardHeader, ChartCard, EmptyState, StatCard } from "@isker/design-system";
import { Link } from "react-router-dom";
import { can, useMe } from "../../api/auth";
import { humanize, useAnalyticsOverview, type AuditEntry } from "../../api/adminManage";
import { ErrorState, PageSkeleton } from "../../components/States";
import { ADMIN_SECTIONS } from "../../layouts/AdminShell";
import { formatDate } from "../../utils/format";
import { AdminPageHeader, formatDateTime, Muted, StatusPill } from "./common";

function AuditList({ rows, empty }: { rows: AuditEntry[]; empty: string }) {
  if (!rows.length) return <p style={{ padding: "0 24px 24px", fontSize: 14, color: "var(--color-neutral-500)" }}>{empty}</p>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: "0 24px 16px" }}>
      {rows.map((r) => (
        <li key={r.id} className="ik-list-row" style={{ alignItems: "flex-start" }}>
          <span style={{ minWidth: 0 }}>
            <b style={{ fontWeight: 500 }}>{humanize(r.action)}</b>
            <span style={{ display: "block" }}><Muted>{r.actor_email ?? (r.actor_id ? `User #${r.actor_id}` : "System / anonymous")}{r.target_type && r.target_id !== null ? ` → ${r.target_type} #${r.target_id}` : ""}{r.reason ? ` · ${r.reason}` : ""}</Muted></span>
          </span>
          <span style={{ textAlign: "right", flex: "none" }}><StatusPill status={r.outcome} /><span style={{ display: "block", marginTop: 4 }}><Muted>{formatDateTime(r.created_at)}</Muted></span></span>
        </li>
      ))}
    </ul>
  );
}

/** Admin home. Staff without analytics.view see their available sections instead of figures. */
export function AdminDashboard() {
  const { data: me } = useMe();
  const canAnalytics = can(me, "analytics.view");
  if (!canAnalytics) {
    const sections = ADMIN_SECTIONS.filter((s) => s.id !== "dashboard" && can(me, s.permission));
    return (
      <>
        <AdminPageHeader title="Administration" subtitle="Sections available to your role." />
        {sections.length === 0 ? <EmptyState icon="lock" title="No sections available" description="Your role has no administration permissions yet." /> : (
          <div className="ik-grid-cards">
            {sections.map((s) => (
              <Card key={s.id} padding={20}><Link to={s.path} style={{ fontWeight: 600 }}>{s.label}</Link></Card>
            ))}
          </div>
        )}
      </>
    );
  }
  return <AnalyticsDashboard />;
}

function AnalyticsDashboard() {
  const { data: o, isLoading, error, refetch } = useAnalyticsOverview(30);
  if (isLoading) return <PageSkeleton chart />;
  if (error || !o) return <><AdminPageHeader title="Dashboard" /><ErrorState error={error} onRetry={() => refetch()} /></>;
  const s = o.subscriptions;
  return (
    <>
      <AdminPageHeader title="Dashboard" subtitle={`Live figures from the database · updated ${formatDateTime(o.generated_at)}`} />
      <div className="ik-grid4" style={{ marginBottom: 20 }}>
        <StatCard label="Users" value={o.users.total} description={`${o.users.active} active · ${o.users.suspended} suspended · ${o.users.deactivated} closed`} icon="users" />
        <StatCard label="Active in last 7 days" value={o.users.active_last_7_days} description={`${o.users.new_last_7_days} new this week`} icon="trending-up" tone="growth" />
        <StatCard label="Completed assessments" value={o.assessments.completed} description={o.assessments.completion_rate === null ? "No assessments started yet" : `${o.assessments.completion_rate}% of started assessments`} icon="clipboard-check" tone="neutral" />
        <StatCard label="Paid / granted plans" value={s.paid_users + s.granted_free_of_charge} description={`${s.free_users} on Free · ${s.by_status.expired} expired · ${s.by_status.canceled} canceled`} icon="credit-card" tone="neutral" />
      </div>
      <div className="ik-grid3" style={{ marginBottom: 20 }}>
        <div className="ik-span2">
          <ChartCard title="Registrations" description={`New accounts per day, last ${o.window_days} days (${o.users.new_in_window} total)`}>
            {o.users.new_in_window === 0 ? <p style={{ fontSize: 14, color: "var(--color-neutral-500)", padding: "24px 0" }}>No registrations in this period.</p>
              : <BarChart ariaLabel={`Registrations per day over the last ${o.window_days} days`} data={o.registrations.map((d) => ({ label: formatDate(d.date, { day: "numeric", month: "short" }), value: d.count }))} />}
          </ChartCard>
        </div>
        <Card>
          <CardHeader title="Learning activity" description={`Last ${o.window_days} days unless noted`} />
          <dl className="ik-kv" style={{ padding: "0 24px 24px" }}>
            <dt>Learners active</dt><dd>{o.learning.learners_active_in_window}</dd>
            <dt>Resources completed</dt><dd>{o.learning.resources_completed_in_window} <Muted>({o.learning.resources_completed} all time)</Muted></dd>
            <dt>Practical tasks completed</dt><dd>{o.learning.tasks_completed} <Muted>all time</Muted></dd>
            <dt>Plan activities done</dt><dd>{o.learning.plan_activities_completed} <Muted>all time</Muted></dd>
            <dt>Reassessments</dt><dd>{o.assessments.reassessments_completed}</dd>
          </dl>
        </Card>
      </div>
      <div className="ik-grid2">
        <Card>
          <CardHeader title="Recent admin actions" action={o.recent_admin_actions ? <Link to="/admin/audit-logs?action=admin.">Audit log</Link> : undefined} />
          {o.recent_admin_actions ? <AuditList rows={o.recent_admin_actions} empty="No admin actions recorded yet." /> : <p style={{ padding: "0 24px 24px", fontSize: 14, color: "var(--color-neutral-500)" }}>Requires the audit.view permission.</p>}
        </Card>
        <Card>
          <CardHeader title="Security events" description={o.security_summary ? `${o.security_summary.failed_logins_7_days} failed sign-ins and ${o.security_summary.access_denied_7_days} denied requests in the last 7 days` : undefined}
            action={o.security_events ? <Link to="/admin/audit-logs?security_only=true">View all</Link> : undefined} />
          {o.security_events ? <AuditList rows={o.security_events} empty="No security events recorded." /> : <p style={{ padding: "0 24px 24px", fontSize: 14, color: "var(--color-neutral-500)" }}>Requires the audit.view permission.</p>}
        </Card>
      </div>
    </>
  );
}
