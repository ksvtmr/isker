import { Card, ProgressBar, StatCard } from "@isker/design-system";
import { useAdminStats } from "../../api/admin";
import { ErrorState, PageSkeleton } from "../../components/States";

export function AdminOverview() {
  const { data: s, isLoading, error, refetch } = useAdminStats();
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !s) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <>
      <div className="ik-grid4" style={{ marginBottom: 24 }}>
        <StatCard label="Users" value={s.users} description={`${s.onboarded_users} onboarded`} icon="users" />
        <StatCard label="Completed assessments" value={s.completed_attempts} description={`${s.in_progress_attempts} in progress`} icon="clipboard-check" tone="growth" />
        <StatCard label="Average overall score" value={s.average_overall ?? "—"} description="Across completed attempts" icon="trending-up" tone="neutral" />
        <StatCard label="AI evaluations" value={s.ai_evaluations} description={`${s.ai_fallbacks} used the safe fallback`} icon="bot" tone={s.ai_fallbacks ? "warning" : "neutral"} />
      </div>
      <div className="ik-grid2" style={{ alignItems: "start" }}>
        <Card padding={24}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Average score by competency</h2>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {s.competency_averages.map((c) => (
              <div key={c.code} style={{ display: "grid", gridTemplateColumns: "minmax(0,200px) 1fr 70px", gap: 12, alignItems: "center", fontSize: 13 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <ProgressBar value={c.average ?? 0} showValue={false} height={6} ariaLabel={`${c.name} average ${c.average ?? "none"}`} />
                <span style={{ textAlign: "right", color: "var(--color-neutral-600)" }}>{c.average ?? "—"} · n={c.measurements}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card padding={24}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Learning activity</h2>
          <dl className="ik-kv" style={{ marginTop: 12 }}>
            <dt>Resources completed</dt><dd>{s.resources_completed}</dd>
            <dt>Practical tasks completed</dt><dd>{s.tasks_completed}</dd>
          </dl>
        </Card>
      </div>
    </>
  );
}
