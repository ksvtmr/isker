import { AIInsight, Button, Card, ChartCard, EmptyState, GapBadge, Icon, LevelBadge, LineChart, ProgressBar, ScoreValue, SectionTitle, StatusBadge } from "@isker/design-system";
import { PageHeader } from "../components/PageTitle";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useStartAttempt } from "../api/assessments";
import { ApiError } from "../api/client";
import { useCompetencyDetail } from "../api/competencies";
import { LinkButton, useSpaClick } from "../components/RouterLink";
import { ErrorState, PageSkeleton, ApiErrorAlert } from "../components/States";
import type { Difficulty, RecommendedItem } from "../types/api";
import { confidenceLabel, difficultyLabel, formatDate, gapLabel, shortMonth, signed } from "../utils/format";

/** Badge tone and translation key per progress/submission status. */
const STATUS_LABEL: Record<string, [Parameters<typeof StatusBadge>[0]["status"], string]> = {
  completed: ["done", "common:progressStatus.completed"], in_progress: ["progress", "common:progressStatus.in_progress"],
  started: ["progress", "assessment:competencyDetail.status.started"], submitted: ["progress", "assessment:competencyDetail.status.submitted"],
  not_started: ["todo", "common:progressStatus.not_started"],
};

function ItemList({ items, base, recommendedId }: { items: RecommendedItem[]; base: string; recommendedId?: number }) {
  const { t } = useTranslation("assessment");
  const spa = useSpaClick();
  if (!items.length) return <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{t("competencyDetail.nothingAvailable")}</p>;
  return (
    <ul style={{ listStyle: "none", padding: 0 }}>
      {items.map((it) => {
        const [st, labelKey] = STATUS_LABEL[it.status ?? "not_started"] ?? STATUS_LABEL.not_started;
        return (
          <li key={it.id}>
            <a className="ik-list-row" href={`${base}/${it.id}`} onClick={spa(`${base}/${it.id}`)} style={{ textDecoration: "none" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>{it.title}</span>
                <span style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{it.type} · {t("common:time.minutes", { count: it.duration_minutes })} · {difficultyLabel(it.difficulty as Difficulty)}</span>
              </span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {it.id === recommendedId && <StatusBadge status="recommended">{t("competencyDetail.recommended")}</StatusBadge>}
                <StatusBadge status={st}>{t(labelKey)}</StatusBadge>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function CompetencyDetailPage() {
  const { t } = useTranslation("assessment");
  const { id = "" } = useParams();
  const { data: d, isLoading, error, refetch } = useCompetencyDetail(id);
  const start = useStartAttempt();
  const navigate = useNavigate();

  if (isLoading) return <PageSkeleton />;
  if (error || !d) {
    if (error instanceof ApiError && error.status === 404) {
      return <EmptyState icon="search-x" title={t("competencyDetail.notFoundTitle")} description={t("competencyDetail.notFoundText")} action={<LinkButton to="/competencies">{t("competencyDetail.allCompetencies")}</LinkButton>} />;
    }
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  const c = d.competency, cur = d.current;
  const back = { label: t("common:nav.competencies"), href: "/competencies", onClick: () => navigate("/competencies") };
  const reassess = () => start.mutate({ scope: "competency", competency_id: c.id }, { onSuccess: (r) => navigate(`/assessment/${r.attempt.id}`) });
  const reassessBtn = <Button variant="secondary" iconLeft="refresh-cw" loading={start.isPending} onClick={reassess}>{t("competencyDetail.reassess")}</Button>;

  if (cur.score === null) {
    return (
      <>
        <PageHeader back={back} eyebrow={c.area.name} title={c.name} />
        <Card padding={24} style={{ marginBottom: 24 }}><p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--color-neutral-700)" }}>{c.description}</p></Card>
        <EmptyState icon="clipboard-check" title={t("competencyDetail.notAssessedTitle")} description={t("competencyDetail.notAssessedText")} action={<LinkButton to="/assessment">{t("assessmentIntro.startButton")}</LinkButton>} />
      </>
    );
  }

  // Only rubric criteria that evidence this competency (an open answer can cover several competencies).
  const strengths = d.criteria.filter((k) => k.score >= 75).map((k) => k.criterion);
  const devAreas = d.criteria.filter((k) => k.score <= 50).map((k) => k.criterion);
  const avgConf = d.ai.length ? d.ai.reduce((s, a) => s + (a.confidence ?? 0), 0) / d.ai.length : cur.confidence;
  const methods: [string, number | null][] = [
    [t("competencyDetail.methods.self"), d.method_scores.self],
    [t("competencyDetail.methods.situational"), d.method_scores.situational],
    [t("competencyDetail.methods.open"), d.method_scores.open],
  ];
  const first = d.history[0]?.score;
  const hist = d.history;

  return (
    <>
      <PageHeader back={back} eyebrow={c.area.name} title={c.name} action={reassessBtn} />
      {start.error && <div style={{ marginBottom: 16 }}><ApiErrorAlert error={start.error} /></div>}

      <div className="ik-grid3" style={{ marginBottom: 24 }}>
        <Card padding={24}>
          <ScoreValue value={cur.score} label={t("common:ds.scoreAria", { name: c.name })} />
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {cur.level && <LevelBadge level={cur.level} showDot />}
            <GapBadge gap={gapLabel(cur.gap_band)} />
          </div>
          <div style={{ marginTop: 20 }}><ProgressBar value={cur.score} target={cur.target} showValue={false} ariaLabel={t("competencyDetail.progressAria", { score: cur.score, target: cur.target })} /></div>
          <dl className="ik-kv" style={{ marginTop: 16 }}>
            <dt>{t("competencyDetail.target")}</dt><dd>{t("competencyDetail.targetValue", { target: cur.target })} · {cur.gap ? t("competencyDetail.pointsToGo", { count: cur.gap }) : t("competencyDetail.reached")}</dd>
            {cur.change !== null && <><dt>{t("competencyDetail.progress")}</dt><dd style={{ color: cur.change >= 0 ? "var(--color-growth-700)" : "var(--color-error)", fontWeight: 500 }}>{t("competencyDetail.sincePrevious", { change: signed(cur.change) })}</dd></>}
            {first !== undefined && hist.length > 1 && <><dt>{t("competencyDetail.sinceFirst")}</dt><dd>{t("competencyDetail.sinceFirstValue", { count: Math.abs(cur.score - first), value: signed(cur.score - first) })}</dd></>}
            <dt>{t("competencyDetail.measured")}</dt><dd>{formatDate(cur.assessed_at)}</dd>
          </dl>
          <p style={{ marginTop: 16, fontSize: 14, lineHeight: "22px", color: "var(--color-neutral-600)" }}>{c.description}</p>
        </Card>
        <div className="ik-span2">
          <AIInsight title={t("competencyDetail.whyTitle")} context={`${c.name} · ${cur.score}`} confidence={confidenceLabel(avgConf)}>
            <p>{d.explanation}</p>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, background: "#fff", padding: 14, borderRadius: 10, border: "1px solid var(--color-brand-100)" }}>
              {methods.filter(([, v]) => v !== null).map(([k, v]) => <ProgressBar key={k} label={k} value={Math.round(v!)} />)}
            </div>
            {d.criteria.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-neutral-500)" }}>{t("competencyDetail.rubricCriteria")}</p>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                  {d.criteria.map((k) => <ProgressBar key={k.criterion} label={k.criterion} value={k.score} color="var(--color-brand-500)" />)}
                </div>
              </div>
            )}
            {d.ai[0] && (
              // Learners see only what kind of feedback this is; engine, model and prompt versions are admin details.
              <p style={{ marginTop: 12, fontSize: 12, color: "var(--color-neutral-500)" }}>
                {d.ai[0].provider === "mock" ? t("competencyDetail.ruleBasedFeedback") : t("competencyDetail.aiFeedback")}
              </p>
            )}
          </AIInsight>
        </div>
      </div>

      <div className="ik-grid3" style={{ marginBottom: 24 }}>
        <Card padding={24} className="ik-span2">
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t("competencyDetail.evidenceTitle")}</h2>
          <p style={{ marginTop: 4, fontSize: 13, color: "var(--color-neutral-500)" }}>{t("competencyDetail.evidenceText")}</p>
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
            {!d.evidence.length && <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{t("competencyDetail.noEvidence")}</p>}
          </div>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card padding={20}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t("competencyDetail.strengths")}</h2>
            {strengths.length ? <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>{strengths.map((s) => <li key={s}>{s}</li>)}</ul>
              : <p style={{ marginTop: 6, fontSize: 14, color: "var(--color-neutral-500)" }}>{t("competencyDetail.strengthsEmpty")}</p>}
          </Card>
          <Card padding={20}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t("competencyDetail.devGaps")}</h2>
            {devAreas.length ? <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>{devAreas.map((s) => <li key={s}>{s}</li>)}</ul>
              : <p style={{ marginTop: 6, fontSize: 14, color: "var(--color-neutral-500)" }}>{cur.gap ? t("competencyDetail.closeGap", { count: cur.gap }) : t("competencyDetail.noGaps")}</p>}
          </Card>
        </div>
      </div>

      <div className="ik-grid3">
        <div className="ik-span2">
          <SectionTitle title={t("competencyDetail.opportunities")} action={d.recommendation_id ? <LinkButton to={`/development-plan?focus=${c.code}`} variant="ghost" size="sm" iconRight="arrow-right">{t("competencyDetail.openPlan")}</LinkButton> : undefined} />
          <div className="ik-grid2">
            <Card padding={20}><h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{t("competencyDetail.recommendedLearning")}</h3><ItemList items={d.resources} base="/learning" recommendedId={d.recommendation_id ? d.resources[0]?.id : undefined} /></Card>
            <Card padding={20}><h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{t("competencyDetail.recommendedPractice")}</h3><ItemList items={d.tasks} base="/practice" recommendedId={d.recommendation_id ? d.tasks[0]?.id : undefined} /></Card>
          </div>
        </div>
        <ChartCard title={t("competencyDetail.historyTitle")} description={t("competencyDetail.historyText")}
          summary={hist.length > 1
            ? t("competencyDetail.historySummary", { scores: hist.map((h) => h.score).join(" → "), change: signed(cur.score - hist[0].score), date: formatDate(hist[0].date, { month: "long", year: "numeric" }) })
            : t("competencyDetail.historyEmpty")}>
          <LineChart height={180} labels={hist.map((h) => shortMonth(h.date))} ariaLabel={t("competencyDetail.historyAria", { name: c.name })}
            series={[{ values: hist.map((h) => h.score), color: "var(--color-brand-600)" }, { values: hist.map(() => cur.target), color: "var(--color-neutral-300)", dashed: true }]} />
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--color-neutral-500)" }}>{t("competencyDetail.reassessCount", { count: d.reassess_question_count })}</p>
        </ChartCard>
      </div>
    </>
  );
}
