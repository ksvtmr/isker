import { AIInsight, Card, ChartCard, CompetencyCard, EmptyState, Icon, LevelBadge, PageHeader, ProgressBar, RadarChart, ScoreValue, SectionTitle, Tabs } from "@isker/design-system";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useResults } from "../api/assessments";
import { useScoreProfile } from "../api/competencies";
import { LinkButton, useSpaClick } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import type { CompetencyScore } from "../types/api";
import { AREA_COLOR, confidenceLabel, formatDate, gapLabel, signed } from "../utils/format";

function Row({ c, tone }: { c: CompetencyScore; tone: string }) {
  const spa = useSpaClick();
  return (
    <li>
      <a className="ik-list-row" href={`/competencies/${c.code}`} onClick={spa(`/competencies/${c.code}`)} style={{ textDecoration: "none" }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</span>
        <span style={{ fontSize: 16, fontWeight: 600, color: tone }}>{c.score}</span>
      </a>
    </li>
  );
}

export function ResultsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fallback = useScoreProfile();
  const attemptId = Number(params.get("attempt")) || fallback.data?.attempt_id || null;
  const { data, isLoading, error, refetch } = useResults(attemptId);
  const [view, setView] = useState("radar");

  if (fallback.isLoading || isLoading) return <PageSkeleton />;
  if (!attemptId) {
    return (
      <>
        <PageHeader title="Results" />
        <EmptyState icon="clipboard-check" title="No results yet" description="Complete the assessment to see your competency profile." action={<LinkButton to="/assessment">Start Assessment</LinkButton>} />
      </>
    );
  }
  if (error || !data) return <><PageHeader title="Results" /><ErrorState error={error} onRetry={() => refetch()} /></>;

  const { attempt, profile: p, measured } = data;
  const comps = p.competencies.filter((c) => c.score !== null);
  const isPartial = attempt.scope === "competency";
  const sorted = [...comps].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const gaps = p.priority_gaps;
  const radar = (
    <RadarChart
      size={440}
      axes={comps.map((c) => ({ label: c.name, short: c.short_name, color: (c.gap ?? 0) >= 20 ? "var(--gap-high-fg)" : undefined }))}
      series={[
        { values: comps.map((c) => c.score ?? 0), color: "var(--color-brand-600)" },
        { values: comps.map((c) => c.target), color: "var(--color-neutral-400)", dashed: true, fillOpacity: 0 },
      ]}
    />
  );
  const bars = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {sorted.map((c) => (
        <div key={c.code} style={{ display: "grid", gridTemplateColumns: "minmax(0,220px) minmax(0,1fr) 32px", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--color-neutral-700)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
          <ProgressBar value={c.score ?? 0} target={c.target} showValue={false} ariaLabel={`${c.name}: ${c.score}`}
            color={(c.gap ?? 0) >= 20 ? "var(--color-error)" : (c.gap ?? 0) >= 10 ? "var(--color-warning)" : "var(--color-brand-600)"} />
          <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right" }}>{c.score}</span>
        </div>
      ))}
    </div>
  );
  const summary = `Strongest: ${p.strengths.map((c) => `${c.name} (${c.score})`).join(", ")}.` +
    (gaps.length ? ` Furthest below target: ${gaps.map((c) => `${c.name} (${c.score})`).join(", ")}.` : " No competency is 10+ points below target.");

  return (
    <>
      <PageHeader
        eyebrow={`${isPartial ? `Reassessment · ${attempt.competency?.name}` : `Assessment ${attempt.sequence}`} · completed ${formatDate(attempt.completed_at)}`}
        title={attempt.sequence === 1 && !isPartial ? "Assessment Complete" : "Your Entrepreneurial Competency Profile"}
        subtitle={attempt.sequence === 1 && !isPartial ? "Here is your entrepreneurial competency profile." : undefined}
        action={<LinkButton to="/development-plan" iconRight="arrow-right">Create My Development Plan</LinkButton>}
      />

      {isPartial && measured.length > 0 && (
        <div className="ik-grid-cards" style={{ marginBottom: 24 }}>
          {measured.map((c) => (
            <Card key={c.code} padding={24}>
              <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{c.name}</p>
              <div style={{ marginTop: 8 }}><ScoreValue value={c.score} size={40} label={c.name} /></div>
              {c.change !== null && (
                <p style={{ marginTop: 10, fontSize: 14, fontWeight: 500, color: c.change >= 0 ? "var(--color-growth-600)" : "var(--color-error)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Icon name="trending-up" size={16} />{signed(c.change)} points since your previous measurement
                </p>
              )}
              <div style={{ marginTop: 12 }}><LinkButton to={`/competencies/${c.code}`} variant="secondary" size="sm">Why this score?</LinkButton></div>
            </Card>
          ))}
        </div>
      )}

      <div className="ik-grid3" style={{ marginBottom: 24 }}>
        <Card padding={24}>
          <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>Overall score</p>
          <div style={{ marginTop: 8 }}><ScoreValue value={p.overall} label="Overall score" /></div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {p.level && <LevelBadge level={p.level} showDot />}
            {p.change !== null && <span style={{ fontSize: 13, fontWeight: 500, color: p.change >= 0 ? "var(--color-growth-600)" : "var(--color-error)" }}>{signed(p.change)} vs previous</span>}
          </div>
          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 14 }}>
            {p.areas.map((a) => <ProgressBar key={a.code} label={a.name} value={a.score ?? 0} color={AREA_COLOR[a.code]} />)}
          </div>
        </Card>
        <div className="ik-span2">
          <ChartCard
            title={`All ${comps.length} competencies`}
            description="Solid line: your score. Dashed: your target."
            action={<Tabs ariaLabel="Chart type" value={view} onChange={setView} tabs={[{ value: "radar", label: "Radar" }, { value: "bars", label: "Bars" }]} />}
            summary={summary}
          >
            {view === "radar" ? radar : bars}
          </ChartCard>
        </div>
      </div>

      <div className="ik-grid3" style={{ marginBottom: 32 }}>
        <Card padding={20}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Your Strengths</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>{p.strengths.map((c) => <Row key={c.code} c={c} tone="var(--color-growth-600)" />)}</ul>
        </Card>
        <Card padding={20}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Priority Development Areas</h2>
          {gaps.length ? <ul style={{ listStyle: "none", padding: 0 }}>{gaps.map((c) => <Row key={c.code} c={c} tone="var(--gap-high-fg)" />)}</ul>
            : <p style={{ fontSize: 14, color: "var(--color-neutral-500)", padding: "12px 0" }}>Every competency is within 10 points of its target.</p>}
        </Card>
        {p.insight ? (
          <AIInsight context={`Profile · ${comps.length} competencies`} confidence={confidenceLabel(p.insight.confidence)}
            action={<LinkButton to="/development-plan" size="sm">Create My Development Plan</LinkButton>}>
            <b>{p.insight.headline}</b> {p.insight.body} {p.insight.next_step}
          </AIInsight>
        ) : <Card padding={20}><p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>No AI insight was generated for this attempt.</p></Card>}
      </div>

      <SectionTitle title="Competency scores" description="Open a competency to see the evidence and explanation behind its score." />
      <div className="ik-grid-cards">
        {sorted.map((c) => (
          <CompetencyCard key={c.code} name={c.name} area={c.area_name} score={c.score ?? 0} target={c.target} gap={gapLabel(c.gap_band)}
            href={`/competencies/${c.code}`} onClick={() => navigate(`/competencies/${c.code}`)} />
        ))}
      </div>
    </>
  );
}
