import {
  AIInsight, Card, CompetencyCard, EmptyState, GapBadge, LevelBadge, LineChart, PageHeader, ProgressBar,
  RecommendationCard, ScoreValue, SectionTitle, StatCard, Icon, Stepper, type StepperStep,
} from "@isker/design-system";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useProgress, useDashboard } from "../api/progress";
import { LinkButton, useSpaClick } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import type { CompetencyScore, Dashboard } from "../types/api";
import { AREA_COLOR, confidenceLabel, difficultyLabel, formatPercent, gapLabel, greeting, shortMonth, signed } from "../utils/format";

function ScoreHero({ d }: { d: Dashboard }) {
  const { t } = useTranslation("dashboard");
  const p = d.profile;
  const progress = useProgress();
  const snaps = progress.data?.snapshots ?? [];
  return (
    <Card padding={24} className="ik-span2">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{t("dashboard.score.title")}</p>
          <div style={{ marginTop: 10 }}><ScoreValue value={p.overall} label={t("dashboard.score.label")} /></div>
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {p.level && <LevelBadge level={p.level} showDot />}
            {p.change !== null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 14, fontWeight: 500, color: p.change >= 0 ? "var(--color-growth-700)" : "var(--color-error)" }}>
                <Icon name="trending-up" size={16} />
                {t("dashboard.score.change", { change: signed(p.change) })}
              </span>
            )}
          </div>
        </div>
        {snaps.length > 1 && (
          <div style={{ flex: "1 1 320px", maxWidth: 560 }}>
            <LineChart height={180} labels={snaps.map((s) => shortMonth(s.date))} ticks={[25, 50, 75, 100]} min={Math.max(0, Math.min(...snaps.map((s) => s.overall)) - 15)}
              series={[{ values: snaps.map((s) => s.overall), color: "var(--color-brand-600)" }]} ariaLabel={t("dashboard.score.chartAria")} />
          </div>
        )}
      </div>
    </Card>
  );
}

/** The product loop as a stepper: what's done and what to do next (first unfinished step is "current"). */
function JourneyStepper({ d }: { d: Dashboard }) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const nr = d.next_reassessment;
  const has = d.profile.has_profile;
  const planDone = d.plan_total > 0 && d.plan_done >= d.plan_total;
  const raw: (Omit<StepperStep, "status"> & { done: boolean; to: string })[] = [
    { label: t("journey.assess"), description: has ? t("journey.assessDone") : d.in_progress_attempt_id ? t("journey.assessInProgress") : t("journey.assessDuration"), done: has, to: d.in_progress_attempt_id ? `/assessment/${d.in_progress_attempt_id}` : "/assessment" },
    { label: t("journey.review"), description: t("journey.reviewDescription"), done: has, to: "/competencies" },
    { label: t("journey.learn"), description: has ? t("journey.activities", { done: d.plan_done, count: d.plan_total }) : t("journey.personalPlan"), done: planDone, to: "/development-plan" },
    { label: t("journey.reassess"), description: nr ? (nr.ready ? t("journey.availableNow") : t("common:time.inDays", { count: nr.days })) : t("journey.afterPlan"), done: false, to: "/assessment" },
  ];
  const current = raw.findIndex((r) => !r.done);
  const steps: StepperStep[] = raw.map((r, i) => ({ label: r.label, description: r.description, status: r.done ? "done" : i === current ? "current" : "todo", href: r.to, onClick: () => navigate(r.to) }));
  return <div style={{ marginBottom: 24 }}><Stepper label={t("journey.label")} steps={steps} /></div>;
}

function AreaSummary({ code, name, items, score }: { code: string; name: string; items: CompetencyScore[]; score: number | null }) {
  const { t } = useTranslation("dashboard");
  const spa = useSpaClick();
  return (
    <Card padding={20}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: AREA_COLOR[code] }} />
          {name}
        </h3>
        <span style={{ fontSize: 20, fontWeight: 600 }} aria-label={t("dashboard.areaScoreAria", { score: score ?? "—" })}>{score ?? "—"}</span>
      </div>
      <ul style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12, listStyle: "none", padding: 0 }}>
        {items.map((c) => (
          <li key={c.code}>
            <a href={`/competencies/${c.code}`} onClick={spa(`/competencies/${c.code}`)} className="ik-row-btn" style={{ textDecoration: "none" }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: "var(--color-neutral-700)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <span style={{ color: (c.gap ?? 0) >= 20 ? "var(--gap-high-fg)" : "var(--color-neutral-500)", fontVariantNumeric: "tabular-nums", fontWeight: (c.gap ?? 0) >= 20 ? 600 : 400 }}>{c.score}</span>
              </span>
              <ProgressBar value={c.score ?? 0} target={c.target} showValue={false} height={6} ariaLabel={t("dashboard.competencyBarAria", { name: c.name, score: c.score ?? "—", target: c.target })} />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const { data: d, isLoading, error, refetch } = useDashboard();
  const navigate = useNavigate();
  if (isLoading) return <PageSkeleton />;
  if (error || !d) return <><PageHeader title={t("common:nav.dashboard")} /><ErrorState error={error} onRetry={() => refetch()} title={t("dashboard.loadError")} /></>;

  const header = (
    <PageHeader
      title={t("dashboard.greeting", { greeting: greeting(), name: d.user_name })}
      subtitle={t("dashboard.subtitle")}
      action={d.profile.has_profile ? <LinkButton to="/development-plan" iconRight="arrow-right">{t("dashboard.continueDevelopment")}</LinkButton> : undefined}
    />
  );

  if (!d.profile.has_profile) {
    return (
      <>
        {header}
        <JourneyStepper d={d} />
        <EmptyState
          icon="clipboard-check"
          title={d.in_progress_attempt_id ? t("dashboard.empty.finishTitle") : t("dashboard.empty.startTitle")}
          description={t("dashboard.empty.description")}
          action={<LinkButton to={d.in_progress_attempt_id ? `/assessment/${d.in_progress_attempt_id}` : "/assessment"}>{d.in_progress_attempt_id ? t("dashboard.empty.continueButton") : t("dashboard.empty.startButton")}</LinkButton>}
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
      <JourneyStepper d={d} />
      <div className="ik-grid3" style={{ marginBottom: 24 }}>
        <ScoreHero d={d} />
        {d.insight ? (
          <AIInsight
            context={strongest ? `${strongest.name} · ${strongest.score}` : undefined}
            confidence={confidenceLabel(d.insight.confidence)}
            action={rec && <LinkButton to={`/development-plan?focus=${rec.competency_code}`} size="sm" variant="secondary">{t("dashboard.openPlan")}</LinkButton>}
          >
            <b>{d.insight.headline}</b> {d.insight.body} <b>{t("dashboard.nextStep")}</b> {d.insight.next_step}
          </AIInsight>
        ) : (
          <Card padding={20}><p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{t("dashboard.insightEmpty")}</p></Card>
        )}
      </div>

      <div className="ik-grid4" style={{ marginBottom: 32 }}>
        <StatCard label={t("dashboard.stats.strengths")} value={strengths.length} description={t("dashboard.stats.strengthsDescription", { count: strengths.length }) + (strongest ? ` · ${t("dashboard.stats.strongest", { name: strongest.name })}` : "")} icon="trending-up" tone="growth" />
        <StatCard label={t("dashboard.stats.priorityGaps")} value={priorityGaps.length} description={t("dashboard.stats.priorityGapsDescription", { count: priorityGaps.length }) + (p.priority_gaps[0] ? ` · ${t("dashboard.stats.top", { name: p.priority_gaps[0].name })}` : "")} icon="target" tone="warning" />
        <StatCard label={t("dashboard.stats.progress")} value={formatPercent(d.plan_progress_pct, 0)} description={t("dashboard.stats.progressDescription", { done: d.plan_done, count: d.plan_total })} icon="route" />
        <StatCard
          label={t("dashboard.stats.nextAssessment")}
          value={nr ? (nr.ready ? t("journey.availableNow") : t("common:time.inDays", { count: nr.days })) : "—"}
          description={nr?.competency_name ? t("dashboard.stats.reassessCompetency", { name: nr.competency_name }) : t("dashboard.stats.fullReassessment")}
          icon="calendar-clock"
          tone="neutral"
        />
      </div>

      <SectionTitle
        title={t("dashboard.profile.title")}
        description={t("dashboard.profile.description")}
        action={<LinkButton to="/competencies" variant="ghost" size="sm" iconRight="arrow-right">{t("dashboard.profile.viewAll")}</LinkButton>}
      />
      <div className="ik-grid3" style={{ marginBottom: 32 }}>
        {p.areas.map((a) => (
          <AreaSummary key={a.code} code={a.code} name={a.name} score={a.score} items={p.competencies.filter((c) => c.area_code === a.code)} />
        ))}
      </div>

      <SectionTitle
        title={t("dashboard.gaps.title")}
        description={t("dashboard.gaps.description")}
        action={<LinkButton to="/competencies?tab=gaps" variant="ghost" size="sm" iconRight="arrow-right">{t("dashboard.gaps.analysis")}</LinkButton>}
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
              duration={rec.resource ? t("common:time.minutes", { count: rec.resource.duration_minutes }) : undefined}
              difficulty={rec.resource ? difficultyLabel(rec.resource.difficulty) : undefined}
              practice={rec.task ? { title: rec.task.title, duration: t("common:time.minutes", { count: rec.task.duration_minutes }) } : undefined}
              reason={rec.reason}
              cta={learn?.status === "done" ? t("dashboard.gaps.continuePlan") : t("dashboard.gaps.startDevelopment")}
              onStart={() => navigate(learn && learn.status !== "done" && rec.resource ? `/learning/${rec.resource.id}` : `/development-plan?focus=${rec.competency_code}`)}
            />
          </div>
          <Card padding={20}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>{t("dashboard.gaps.alsoBelow")}</h3>
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
              {priorityGaps.length <= 1 && <li style={{ fontSize: 14, color: "var(--color-neutral-500)", padding: "12px 0" }}>{t("dashboard.gaps.noOther")}</li>}
            </ul>
          </Card>
        </div>
      ) : (
        <EmptyState icon="circle-check" title={t("dashboard.gaps.emptyTitle")} description={t("dashboard.gaps.emptyDescription")} action={<LinkButton to="/assessment">{t("dashboard.gaps.reassess")}</LinkButton>} />
      )}

      <SectionTitle title={t("dashboard.strongest")} />
      <div className="ik-grid-cards">
        {p.strengths.map((c) => (
          <CompetencyCard key={c.code} name={c.name} area={c.area_name} score={c.score ?? 0} target={c.target} gap={gapLabel(c.gap_band)} href={`/competencies/${c.code}`} onClick={() => navigate(`/competencies/${c.code}`)} />
        ))}
      </div>
    </>
  );
}
