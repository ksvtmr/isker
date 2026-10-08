import {
  AIInsight, Button, Card, ChartCard, EmptyState, GapBadge, Icon, InlineAlert, LevelBadge, LineChart, PageHeader, ProgressBar,
  ScoreValue, SectionTitle, StatusBadge,
} from "@isker/design-system";
import { useNavigate, useParams } from "react-router-dom";
import { useStartAttempt } from "../api/assessments";
import { ApiError, errorMessage } from "../api/client";
import { useCompetencyDetail } from "../api/competencies";
import { LinkButton, useSpaClick } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import type { RecommendedItem } from "../types/api";
import { confidenceLabel, formatDate, gapLabel, shortMonth, signed } from "../utils/format";

const STATUS_LABEL: Record<string, [Parameters<typeof StatusBadge>[0]["status"], string]> = {
  completed: ["done", "Completed"], in_progress: ["progress", "In progress"], started: ["progress", "Started"],
  submitted: ["progress", "Submitted"], not_started: ["todo", "Not started"],
};

function ItemList({ items, base, recommendedId }: { items: RecommendedItem[]; base: string; recommendedId?: number }) {
  const spa = useSpaClick();
  if (!items.length) return <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>Nothing available yet.</p>;
  return (
    <ul style={{ listStyle: "none", padding: 0 }}>
      {items.map((it) => {
        const [st, label] = STATUS_LABEL[it.status ?? "not_started"] ?? STATUS_LABEL.not_started;
        return (
          <li key={it.id}>
            <a className="ik-list-row" href={`${base}/${it.id}`} onClick={spa(`${base}/${it.id}`)} style={{ textDecoration: "none" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>{it.title}</span>
                <span style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{it.type} · {it.duration_minutes} min · {it.difficulty[0].toUpperCase() + it.difficulty.slice(1)}</span>
              </span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {it.id === recommendedId && <StatusBadge status="recommended">Recommended</StatusBadge>}
                <StatusBadge status={st}>{label}</StatusBadge>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function CompetencyDetailPage() {
  const { id = "" } = useParams();
  const { data: d, isLoading, error, refetch } = useCompetencyDetail(id);
  const start = useStartAttempt();
  const navigate = useNavigate();

  if (isLoading) return <PageSkeleton />;
  if (error || !d) {
    if (error instanceof ApiError && error.status === 404) {
      return <EmptyState icon="search-x" title="Competency not found" description="This competency doesn't exist." action={<LinkButton to="/competencies">All competencies</LinkButton>} />;
    }
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  const c = d.competency, cur = d.current;
  const back = { label: "Competencies", href: "/competencies", onClick: () => navigate("/competencies") };
  const reassess = () => start.mutate({ scope: "competency", competency_id: c.id }, { onSuccess: (r) => navigate(`/assessment/${r.attempt.id}`) });
  const reassessBtn = <Button variant="secondary" iconLeft="refresh-cw" loading={start.isPending} onClick={reassess}>Reassess</Button>;

  if (cur.score === null) {
    return (
      <>
        <PageHeader back={back} eyebrow={c.area.name} title={c.name} />
        <Card padding={24} style={{ marginBottom: 24 }}><p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--color-neutral-700)" }}>{c.description}</p></Card>
        <EmptyState icon="clipboard-check" title="Not assessed yet" description="Complete the assessment to see your score and the evidence behind it." action={<LinkButton to="/assessment">Start Assessment</LinkButton>} />
      </>
    );
  }

  const strengths = [...new Set(d.ai.flatMap((a) => a.strengths))].slice(0, 4);
  const devAreas = [...new Set(d.ai.flatMap((a) => a.development_areas))].slice(0, 4);
  const avgConf = d.ai.length ? d.ai.reduce((s, a) => s + (a.confidence ?? 0), 0) / d.ai.length : cur.confidence;
  const methods: [string, number | null][] = [["Self-assessment", d.method_scores.self], ["Situational judgement", d.method_scores.situational], ["Open answers & practical task", d.method_scores.open]];
  const first = d.history[0]?.score;
  const hist = d.history;

  return (
    <>
      <PageHeader back={back} eyebrow={c.area.name} title={c.name} action={reassessBtn} />
      {start.error && <div style={{ marginBottom: 16 }}><InlineAlert>{errorMessage(start.error)}</InlineAlert></div>}

      <div className="ik-grid3" style={{ marginBottom: 24 }}>
        <Card padding={24}>
          <ScoreValue value={cur.score} label={`${c.name} score`} />
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {cur.level && <LevelBadge level={cur.level} showDot />}
            <GapBadge gap={gapLabel(cur.gap_band)} />
          </div>
          <div style={{ marginTop: 20 }}><ProgressBar value={cur.score} target={cur.target} showValue={false} ariaLabel={`Score ${cur.score}, target ${cur.target}`} /></div>
          <dl className="ik-kv" style={{ marginTop: 16 }}>
            <dt>Target</dt><dd>{cur.target} / 100{cur.gap ? ` · ${cur.gap} points to go` : " · reached"}</dd>
            {cur.change !== null && <><dt>Progress</dt><dd style={{ color: cur.change >= 0 ? "var(--color-growth-600)" : "var(--color-error)", fontWeight: 500 }}>{signed(cur.change)} since previous measurement</dd></>}
            {first !== undefined && hist.length > 1 && <><dt>Since first</dt><dd>{signed(cur.score - first)} points</dd></>}
            <dt>Measured</dt><dd>{formatDate(cur.assessed_at)}</dd>
          </dl>
          <p style={{ marginTop: 16, fontSize: 14, lineHeight: "22px", color: "var(--color-neutral-600)" }}>{c.description}</p>
        </Card>
        <div className="ik-span2">
          <AIInsight title="Why this score?" context={`${c.name} · ${cur.score}`} confidence={confidenceLabel(avgConf)}>
            <p>{d.explanation}</p>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, background: "#fff", padding: 14, borderRadius: 10, border: "1px solid var(--color-brand-100)" }}>
              {methods.filter(([, v]) => v !== null).map(([k, v]) => <ProgressBar key={k} label={k} value={Math.round(v!)} />)}
            </div>
            {d.criteria.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-neutral-500)" }}>Rubric criteria (open answers)</p>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                  {d.criteria.map((k) => <ProgressBar key={k.criterion} label={k.criterion} value={k.score} color="var(--color-brand-500)" />)}
                </div>
              </div>
            )}
            {d.ai[0] && <p style={{ marginTop: 12, fontSize: 12, color: "var(--color-neutral-500)" }}>Open answers evaluated by {d.ai[0].provider === "mock" ? "the rubric engine (mock AI)" : d.ai[0].model}{d.ai[0].prompt_version ? ` · prompt v${d.ai[0].prompt_version}` : ""}. Scores are computed from rubric ratings, not set by the model.</p>}
          </AIInsight>
        </div>
      </div>

      <div className="ik-grid3" style={{ marginBottom: 24 }}>
        <Card padding={24} className="ik-span2">
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Your evidence</h2>
          <p style={{ marginTop: 4, fontSize: 13, color: "var(--color-neutral-500)" }}>Taken from your latest assessment responses</p>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {d.evidence.map((e) => (
              <div key={e.source} className="ik-evidence">
                <p style={{ fontSize: 12, fontWeight: 500, color: "var(--color-neutral-500)" }}>{e.source}</p>
                <p style={{ marginTop: 6, fontSize: 14, lineHeight: "22px", color: "var(--color-neutral-800)" }}>{e.excerpt}</p>
                <p style={{ marginTop: 8, fontSize: 12, fontWeight: 500, color: e.positive ? "var(--color-growth-700)" : "var(--gap-medium-fg)", display: "flex", gap: 6, alignItems: "center" }}>
                  <Icon name={e.positive ? "circle-check" : "circle-alert"} size={13} />{e.tag}
                </p>
              </div>
            ))}
            {!d.evidence.length && <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>No evidence recorded for this measurement.</p>}
          </div>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card padding={20}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Strengths</h2>
            {strengths.length ? <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>{strengths.map((s) => <li key={s}>{s}</li>)}</ul>
              : <p style={{ marginTop: 6, fontSize: 14, color: "var(--color-neutral-500)" }}>Add more detail to open answers to surface specific strengths.</p>}
          </Card>
          <Card padding={20}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Development gaps</h2>
            {devAreas.length ? <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>{devAreas.map((s) => <li key={s}>{s}</li>)}</ul>
              : <p style={{ marginTop: 6, fontSize: 14, color: "var(--color-neutral-500)" }}>{cur.gap ? `Close the ${cur.gap}-point gap to your target with the plan below.` : "No specific gaps found."}</p>}
          </Card>
        </div>
      </div>

      <div className="ik-grid3">
        <div className="ik-span2">
          <SectionTitle title="Development opportunities" action={d.recommendation_id ? <LinkButton to={`/development-plan?focus=${c.code}`} variant="ghost" size="sm" iconRight="arrow-right">Open plan</LinkButton> : undefined} />
          <div className="ik-grid2">
            <Card padding={20}><h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Recommended learning</h3><ItemList items={d.resources} base="/learning" recommendedId={d.recommendation_id ? d.resources[0]?.id : undefined} /></Card>
            <Card padding={20}><h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Recommended practice</h3><ItemList items={d.tasks} base="/practice" recommendedId={d.recommendation_id ? d.tasks[0]?.id : undefined} /></Card>
          </div>
        </div>
        <ChartCard title="Previous scores" description="Score per measurement"
          summary={hist.length > 1 ? `${hist.map((h) => h.score).join(" → ")} (${signed(cur.score - hist[0].score)} since ${formatDate(hist[0].date, { month: "long", year: "numeric" })}).` : "Reassess to start tracking your progress."}>
          <LineChart height={180} labels={hist.map((h) => shortMonth(h.date))} ariaLabel={`${c.name} score history`}
            series={[{ values: hist.map((h) => h.score), color: "var(--color-brand-600)" }, { values: hist.map(() => cur.target), color: "var(--color-neutral-300)", dashed: true }]} />
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--color-neutral-500)" }}>Reassessing only this competency takes {d.reassess_question_count} questions.</p>
        </ChartCard>
      </div>
    </>
  );
}
