import {
  AIInsight, Card, CompetencyCard, EmptyState, GapBadge, LevelBadge, LineChart, PageHeader, ProgressBar,
  RecommendationCard, ScoreValue, SectionTitle, StatCard, Icon,
} from "@isker/design-system";
import { useNavigate } from "react-router-dom";
import { useProgress, useDashboard } from "../api/progress";
import { LinkButton, useSpaClick } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import type { CompetencyScore, Dashboard } from "../types/api";
import { AREA_COLOR, confidenceLabel, gapLabel, greeting, shortMonth, signed } from "../utils/format";

function ScoreHero({ d }: { d: Dashboard }) {
  const p = d.profile;
  const progress = useProgress();
  const snaps = progress.data?.snapshots ?? [];
  return (
    <Card padding={24} className="ik-span2">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>Entrepreneurial Score</p>
          <div style={{ marginTop: 10 }}><ScoreValue value={p.overall} label="Entrepreneurial score" /></div>
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {p.level && <LevelBadge level={p.level} showDot />}
            {p.change !== null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 14, fontWeight: 500, color: p.change >= 0 ? "var(--color-growth-600)" : "var(--color-error)" }}>
                <Icon name="trending-up" size={16} />
                {signed(p.change)} points since your last assessment
              </span>
            )}
          </div>
        </div>
        {snaps.length > 1 && (
          <div style={{ flex: "1 1 320px", maxWidth: 560 }}>
            <LineChart height={180} labels={snaps.map((s) => shortMonth(s.date))} ticks={[25, 50, 75, 100]} min={Math.max(0, Math.min(...snaps.map((s) => s.overall)) - 15)}
              series={[{ values: snaps.map((s) => s.overall), color: "var(--color-brand-600)" }]} ariaLabel="Overall score history" />
          </div>
        )}
      </div>
    </Card>
  );
}

function AreaSummary({ code, name, items, score }: { code: string; name: string; items: CompetencyScore[]; score: number | null }) {
  const spa = useSpaClick();
  return (
    <Card padding={20}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: AREA_COLOR[code] }} />
          {name}
        </h3>
        <span style={{ fontSize: 20, fontWeight: 600 }} aria-label={`Area score ${score}`}>{score ?? "—"}</span>
      </div>
      <ul style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12, listStyle: "none", padding: 0 }}>
        {items.map((c) => (
          <li key={c.code}>
            <a href={`/competencies/${c.code}`} onClick={spa(`/competencies/${c.code}`)} className="ik-row-btn" style={{ textDecoration: "none" }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: "var(--color-neutral-700)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <span style={{ color: (c.gap ?? 0) >= 20 ? "var(--gap-high-fg)" : "var(--color-neutral-500)", fontVariantNumeric: "tabular-nums", fontWeight: (c.gap ?? 0) >= 20 ? 600 : 400 }}>{c.score}</span>
              </span>
              <ProgressBar value={c.score ?? 0} target={c.target} showValue={false} height={6} ariaLabel={`${c.name}: ${c.score} of 100, target ${c.target}`} />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function DashboardPage() {
  const { data: d, isLoading, error, refetch } = useDashboard();
  const navigate = useNavigate();
  if (isLoading) return <PageSkeleton />;
  if (error || !d) return <><PageHeader title="Dashboard" /><ErrorState error={error} onRetry={() => refetch()} title="We couldn't load your dashboard" /></>;

  const header = (
    <PageHeader
      title={`${greeting()}, ${d.user_name}`}
      subtitle="Continue developing your entrepreneurial competencies."
      action={d.profile.has_profile ? <LinkButton to="/development-plan" iconRight="arrow-right">Continue development</LinkButton> : undefined}
    />
  );

  if (!d.profile.has_profile) {
    return (
      <>
        {header}
        <EmptyState
          icon="clipboard-check"
          title={d.in_progress_attempt_id ? "Finish your first assessment" : "Complete your first assessment"}
          description="Your competency profile, gaps and development plan will appear here after you complete the assessment."
          action={<LinkButton to={d.in_progress_attempt_id ? `/assessment/${d.in_progress_attempt_id}` : "/assessment"}>{d.in_progress_attempt_id ? "Continue Assessment" : "Start Assessment"}</LinkButton>}
        />
      </>
    );
  }

  const p = d.profile;
  const strongest = p.strengths[0];
  const strengths = p.competencies.filter((c) => (c.score ?? 0) >= c.target);
  const priorityGaps = p.competencies.filter((c) => (c.gap ?? 0) >= 10);
  const rec = d.top_recommendation;
  const learn = rec?.activities.find((a) => a.kind === "learn");
  const nr = d.next_reassessment;

  return (
    <>
      {header}
      <div className="ik-grid3" style={{ marginBottom: 24 }}>
        <ScoreHero d={d} />
        {d.insight ? (
          <AIInsight
            context={strongest ? `${strongest.name} · ${strongest.score}` : undefined}
            confidence={confidenceLabel(d.insight.confidence)}
            action={rec && <LinkButton to={`/development-plan?focus=${rec.competency_code}`} size="sm" variant="secondary">Open development plan</LinkButton>}
          >
            <b>{d.insight.headline}</b> {d.insight.body} <b>Recommended next step:</b> {d.insight.next_step}
          </AIInsight>
        ) : (
          <Card padding={20}><p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>Your AI insight will appear after your next assessment.</p></Card>
        )}
      </div>

      <div className="ik-grid4" style={{ marginBottom: 32 }}>
        <StatCard label="Strengths" value={strengths.length} description={`${strengths.length === 1 ? "competency" : "competencies"} at or above target${strongest ? ` · strongest: ${strongest.name}` : ""}`} icon="trending-up" tone="growth" />
        <StatCard label="Priority Gap" value={priorityGaps.length} description={`${priorityGaps.length === 1 ? "competency" : "competencies"} 10+ points below target${p.priority_gaps[0] ? ` · top: ${p.priority_gaps[0].name}` : ""}`} icon="target" tone="warning" />
        <StatCard label="Development Progress" value={`${d.plan_progress_pct}%`} description={`${d.plan_done} of ${d.plan_total} plan activities done`} icon="route" />
        <StatCard
          label="Next Assessment"
          value={nr ? (nr.ready ? "Available now" : `In ${nr.days} days`) : "—"}
          description={nr?.competency_name ? `Reassess ${nr.competency_name}` : "Full reassessment"}
          icon="calendar-clock"
          tone="neutral"
        />
      </div>

      <SectionTitle
        title="Your Competency Profile"
        description={`15 EntreComp competencies grouped by area. The marker shows your target.`}
        action={<LinkButton to="/competencies" variant="ghost" size="sm" iconRight="arrow-right">View full profile</LinkButton>}
      />
      <div className="ik-grid3" style={{ marginBottom: 32 }}>
        {p.areas.map((a) => (
          <AreaSummary key={a.code} code={a.code} name={a.name} score={a.score} items={p.competencies.filter((c) => c.area_code === a.code)} />
        ))}
      </div>

      <SectionTitle
        title="Priority Gaps"
        description="Start with the gap that matters most for your goals."
        action={<LinkButton to="/competencies?tab=gaps" variant="ghost" size="sm" iconRight="arrow-right">Gap analysis</LinkButton>}
      />
      {rec ? (
        <div className="ik-grid3" style={{ marginBottom: 32 }}>
          <div className="ik-span2">
            <RecommendationCard
              competency={rec.competency_name}
              current={rec.current}
              target={rec.target}
              gap={gapLabel(rec.band)}
              title={rec.resource?.title ?? rec.competency_name}
              description={rec.resource?.description}
              type={rec.resource?.type}
              duration={rec.resource ? `${rec.resource.duration_minutes} min` : undefined}
              difficulty={rec.resource ? rec.resource.difficulty[0].toUpperCase() + rec.resource.difficulty.slice(1) : undefined}
              practice={rec.task ? { title: rec.task.title, duration: `${rec.task.duration_minutes} min` } : undefined}
              reason={rec.reason}
              cta={learn?.status === "done" ? "Continue plan" : "Start development"}
              onStart={() => navigate(learn && learn.status !== "done" && rec.resource ? `/learning/${rec.resource.id}` : `/development-plan?focus=${rec.competency_code}`)}
            />
          </div>
          <Card padding={20}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>Also below target</h3>
            <ul style={{ marginTop: 12, listStyle: "none", padding: 0 }}>
              {priorityGaps.filter((c) => c.code !== rec.competency_code).slice(0, 5).map((c) => (
                <li key={c.code}>
                  <a className="ik-list-row" href={`/competencies/${c.code}`} onClick={(e) => { e.preventDefault(); navigate(`/competencies/${c.code}`); }} style={{ textDecoration: "none" }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: "var(--color-neutral-800)" }}>{c.name}</span>
                      <span style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{c.score} → {c.target}</span>
                    </span>
                    <GapBadge gap={gapLabel(c.gap_band)} />
                  </a>
                </li>
              ))}
              {priorityGaps.length <= 1 && <li style={{ fontSize: 14, color: "var(--color-neutral-500)", padding: "12px 0" }}>No other competency is 10+ points below target.</li>}
            </ul>
          </Card>
        </div>
      ) : (
        <EmptyState icon="circle-check" title="No open priority gaps" description="All competencies meet your targets. Reassess to keep track of your development." action={<LinkButton to="/assessment">Reassess</LinkButton>} />
      )}

      <SectionTitle title="Strongest competencies" />
      <div className="ik-grid-cards">
        {p.strengths.map((c) => (
          <CompetencyCard key={c.code} name={c.name} area={c.area_name} score={c.score ?? 0} target={c.target} gap={gapLabel(c.gap_band)} href={`/competencies/${c.code}`} onClick={() => navigate(`/competencies/${c.code}`)} />
        ))}
      </div>
    </>
  );
}
