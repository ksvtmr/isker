import { BarChart, Card, CardHeader, ChartCard, ProgressBar, StatCard, Tabs } from "@isker/design-system";
import { Fragment, useState } from "react";
import { useAdminStats } from "../../api/admin";
import { humanize, useAnalyticsOverview } from "../../api/adminManage";
import { ErrorState, PageSkeleton } from "../../components/States";
import { formatDate } from "../../utils/format";
import { AdminPageHeader, Muted } from "./common";

const WINDOWS = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];

export function AdminAnalytics() {
  const [days, setDays] = useState("30");
  const o = useAnalyticsOverview(Number(days));
  const stats = useAdminStats();
  const header = <AdminPageHeader crumbs={[{ label: "Analytics" }]} title="Analytics" subtitle="Aggregated from the database. No personal data is shown here."
    action={<Tabs ariaLabel="Time window" tabs={WINDOWS} value={days} onChange={setDays} />} />;
  if (o.isLoading || stats.isLoading) return <>{header}<PageSkeleton chart /></>;
  if (o.error || !o.data) return <>{header}<ErrorState error={o.error} onRetry={() => o.refetch()} /></>;
  const a = o.data;
  const funnel = [
    { label: "Registered", value: a.users.total },
    { label: "Onboarded", value: a.users.onboarded },
    { label: "Started an assessment", value: a.assessments.started },
    { label: "Completed an assessment", value: a.assessments.completed },
  ];
  const top = Math.max(1, ...funnel.map((f) => f.value));
  return (
    <>
      {header}
      <div className="ik-grid4" style={{ marginBottom: 20 }}>
        <StatCard label="New users" value={a.users.new_in_window} description={`in the last ${a.window_days} days`} icon="users" />
        <StatCard label="Active users" value={a.users.active_in_window} description={`seen in the last ${a.window_days} days`} icon="trending-up" tone="growth" />
        <StatCard label="Completion rate" value={a.assessments.completion_rate === null ? "—" : `${a.assessments.completion_rate}%`} description={`${a.assessments.abandoned} abandoned · ${a.assessments.in_progress} in progress`} icon="clipboard-check" tone="neutral" />
        <StatCard label="Average overall score" value={a.assessments.average_overall ?? "—"} description="Completed attempts" icon="target" tone="neutral" />
      </div>
      <div className="ik-grid2" style={{ marginBottom: 20 }}>
        <ChartCard title="Registrations" description={`Per day, last ${a.window_days} days`}>
          {a.users.new_in_window === 0 ? <p style={{ fontSize: 14, color: "var(--color-neutral-500)", padding: "24px 0" }}>No registrations in this period.</p>
            : <BarChart ariaLabel={`Registrations per day, last ${a.window_days} days`} data={a.registrations.map((d) => ({ label: formatDate(d.date, { day: "numeric", month: "short" }), value: d.count }))} />}
        </ChartCard>
        <Card>
          <CardHeader title="Journey funnel" description="All time" />
          <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            {funnel.map((f) => <ProgressBar key={f.label} label={f.label} value={f.value} max={top} showValue={false} ariaLabel={`${f.label}: ${f.value}`} />)}
            <Muted>{funnel.map((f) => `${f.label}: ${f.value}`).join(" · ")}</Muted>
          </div>
        </Card>
      </div>
      <div className="ik-grid2">
        <Card>
          <CardHeader title="Subscriptions" />
          <dl className="ik-kv" style={{ padding: "0 24px 24px" }}>
            <dt>On the Free plan</dt><dd>{a.subscriptions.free_users}</dd>
            <dt>Paid plans</dt><dd>{a.subscriptions.paid_users}</dd>
            <dt>Granted (no payment)</dt><dd>{a.subscriptions.granted_free_of_charge}</dd>
            {Object.entries(a.subscriptions.by_status).map(([k, v]) => <Fragment key={k}><dt>{humanize(k)}</dt><dd>{v}</dd></Fragment>)}
            <dt>Expiring in 7 days</dt><dd>{a.subscriptions.expiring_in_7_days}</dd>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Average score by competency" description="Across all measurements" />
          <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
            {!stats.data || stats.data.competency_averages.every((c) => c.average === null) ? <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>No competencies have been measured yet.</p> :
              stats.data.competency_averages.map((c) => (
                <div key={c.code} style={{ display: "grid", gridTemplateColumns: "minmax(0,180px) 1fr 64px", gap: 12, alignItems: "center", fontSize: 13 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>{c.name}</span>
                  <ProgressBar value={c.average ?? 0} showValue={false} height={6} ariaLabel={`${c.name}: average ${c.average ?? "not measured"}`} />
                  <span style={{ textAlign: "right", color: "var(--color-neutral-600)" }}>{c.average ?? "—"} <Muted>n={c.measurements}</Muted></span>
                </div>
              ))}
          </div>
        </Card>
      </div>
    </>
  );
}
