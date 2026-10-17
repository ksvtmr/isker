import { BarChart, Card, CardHeader, ChartCard, ProgressBar, StatCard, Tabs, tabPanelProps } from "@isker/design-system";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminStats } from "../../api/admin";
import { useAnalyticsOverview } from "../../api/adminManage";
import { ErrorState, PageSkeleton } from "../../components/States";
import { formatDate, formatNumber, formatPercent } from "../../utils/format";
import { AdminPageHeader, Muted, useStatusLabel } from "./common";

export function AdminAnalytics() {
  const { t } = useTranslation("admin");
  const statusLabel = useStatusLabel();
  const [days, setDays] = useState("30");
  const o = useAnalyticsOverview(Number(days));
  const stats = useAdminStats();
  const windows = [7, 30, 90].map((d) => ({ value: String(d), label: t("analytics.days", { count: d }) }));
  const header = <AdminPageHeader crumbs={[{ label: t("crumbs.analytics") }]} title={t("analytics.title")} subtitle={t("analytics.subtitle")}
    action={<Tabs id="analytics-window" ariaLabel={t("analytics.window")} tabs={windows} value={days} onChange={setDays} />} />;
  if (o.isLoading || stats.isLoading) return <>{header}<PageSkeleton chart /></>;
  if (o.error || !o.data) return <>{header}<ErrorState error={o.error} onRetry={() => o.refetch()} /></>;
  const a = o.data;
  const n = formatNumber;
  const funnel = [
    { key: "registered", label: t("analytics.funnel.registered"), value: a.users.total },
    { key: "onboarded", label: t("analytics.funnel.onboarded"), value: a.users.onboarded },
    { key: "started", label: t("analytics.funnel.started"), value: a.assessments.started },
    { key: "completed", label: t("analytics.funnel.completed"), value: a.assessments.completed },
  ];
  const top = Math.max(1, ...funnel.map((f) => f.value));
  const pair = (label: string, value: number) => t("analytics.labelValue", { label, value: n(value) });
  return (
    <>
      {header}
      <div {...tabPanelProps("analytics-window", days)}>
      <div className="ik-grid4" style={{ marginBottom: 20 }}>
        <StatCard label={t("analytics.stats.newUsers")} value={n(a.users.new_in_window)} description={t("analytics.stats.inLastDays", { count: a.window_days })} icon="users" />
        <StatCard label={t("analytics.stats.activeUsers")} value={n(a.users.active_in_window)} description={t("analytics.stats.seenInLastDays", { count: a.window_days })} icon="trending-up" tone="growth" />
        <StatCard label={t("analytics.stats.completionRate")} value={a.assessments.completion_rate === null ? t("common:state.none") : formatPercent(a.assessments.completion_rate)}
          description={t("analytics.stats.completionDesc", { abandoned: n(a.assessments.abandoned), inProgress: n(a.assessments.in_progress) })} icon="clipboard-check" tone="neutral" />
        <StatCard label={t("analytics.stats.averageScore")} value={a.assessments.average_overall === null ? t("common:state.none") : n(a.assessments.average_overall)} description={t("analytics.stats.averageScoreDesc")} icon="target" tone="neutral" />
      </div>
      <div className="ik-grid2" style={{ marginBottom: 20 }}>
        <ChartCard title={t("analytics.registrations")} description={t("analytics.registrationsDesc", { count: a.window_days })}>
          {a.users.new_in_window === 0 ? <p style={{ fontSize: 14, color: "var(--color-neutral-500)", padding: "24px 0" }}>{t("analytics.noRegistrations")}</p>
            : <BarChart ariaLabel={t("analytics.registrationsAria", { count: a.window_days })} data={a.registrations.map((d) => ({ label: formatDate(d.date, { day: "numeric", month: "short" }), value: d.count }))} />}
        </ChartCard>
        <Card>
          <CardHeader title={t("analytics.funnelTitle")} description={t("analytics.allTime")} />
          <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            {funnel.map((f) => <ProgressBar key={f.key} label={f.label} value={f.value} max={top} showValue={false} ariaLabel={pair(f.label, f.value)} />)}
            <Muted>{funnel.map((f) => pair(f.label, f.value)).join(" · ")}</Muted>
          </div>
        </Card>
      </div>
      <div className="ik-grid2">
        <Card>
          <CardHeader title={t("analytics.subscriptions")} />
          <dl className="ik-kv" style={{ padding: "0 24px 24px" }}>
            <dt>{t("analytics.freePlan")}</dt><dd>{n(a.subscriptions.free_users)}</dd>
            <dt>{t("analytics.paidPlans")}</dt><dd>{n(a.subscriptions.paid_users)}</dd>
            <dt>{t("analytics.granted")}</dt><dd>{n(a.subscriptions.granted_free_of_charge)}</dd>
            {Object.entries(a.subscriptions.by_status).map(([k, v]) => <Fragment key={k}><dt>{statusLabel(k, "subscription")}</dt><dd>{n(v)}</dd></Fragment>)}
            <dt>{t("analytics.expiring7")}</dt><dd>{n(a.subscriptions.expiring_in_7_days)}</dd>
          </dl>
        </Card>
        <Card>
          <CardHeader title={t("analytics.byCompetency")} description={t("analytics.byCompetencyDesc")} />
          <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
            {stats.error ? <ErrorState error={stats.error} onRetry={() => stats.refetch()} /> :
              !stats.data || stats.data.competency_averages.every((c) => c.average === null) ? <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{t("analytics.noMeasurements")}</p> :
              stats.data.competency_averages.map((c) => (
                <div key={c.code} style={{ display: "grid", gridTemplateColumns: "minmax(0,180px) 1fr 64px", gap: 12, alignItems: "center", fontSize: 13 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>{c.name}</span>
                  <ProgressBar value={c.average ?? 0} showValue={false} height={6}
                    ariaLabel={c.average === null ? t("analytics.averageNotMeasured", { name: c.name }) : t("analytics.averageAria", { name: c.name, value: n(c.average) })} />
                  <span style={{ textAlign: "right", color: "var(--color-neutral-600)" }}>{c.average === null ? t("common:state.none") : n(c.average)} <Muted>{t("analytics.measurements", { count: c.measurements })}</Muted></span>
                </div>
              ))}
          </div>
        </Card>
      </div>
      </div>
    </>
  );
}
