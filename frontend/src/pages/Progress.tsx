import { Card, ChartCard, InlineAlert, CompareBars, EmptyState, Icon, LineChart, ScoreValue, StatCard, Tabs, tabPanelProps } from "@isker/design-system";
import { PageHeader } from "../components/PageTitle";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProgress } from "../api/progress";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { AREA_COLOR, formatDate, shortMonth, signed } from "../utils/format";

type AreaCode = "ideas" | "resources" | "action";

export function ProgressPage() {
  const { data: p, isLoading, error, refetch } = useProgress();
  const [area, setArea] = useState("all");
  const { t } = useTranslation("dashboard");
  const AREAS: { value: AreaCode; label: string }[] = [
    { value: "ideas", label: t("progress.areas.ideas") },
    { value: "resources", label: t("progress.areas.resources") },
    { value: "action", label: t("progress.areas.action") },
  ];
  if (isLoading) return <PageSkeleton />;
  if (error || !p) return <><PageHeader title={t("progress.title")} /><ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!p.snapshots.length) {
    return <><PageHeader title={t("progress.title")} /><EmptyState icon="trending-up" title={t("progress.empty.title")} description={t("progress.empty.description")} action={<LinkButton to="/assessment">{t("progress.empty.button")}</LinkButton>} /></>;
  }

  const snaps = p.snapshots;
  // Chart labels from structured fields (scope, competency, order of full assessments), not by parsing the API label.
  let fullN = 0;
  const labels = snaps.map((s) => {
    const kind = s.scope === "competency"
      ? t("progress.pointReassessment", { name: s.competency_name ?? "" })
      : t("progress.pointAssessment", { n: ++fullN });
    return t("progress.pointLabel", { kind, date: shortMonth(s.date) });
  });
  const pick = (s: (typeof snaps)[number]) => (area === "all" ? s.overall : s[area as "ideas" | "resources" | "action"]);
  const series = area === "all"
    ? [{ values: snaps.map((s) => s.overall), color: "var(--color-brand-600)" }, ...AREAS.map((a) => ({ values: snaps.map((s) => s[a.value]), color: AREA_COLOR[a.value], width: 1.5 }))]
    : [{ values: snaps.map(pick), color: AREA_COLOR[area] }];
  const first = pick(snaps[0]), last = pick(snaps[snaps.length - 1]), prev = snaps.length > 1 ? pick(snaps[snaps.length - 2]) : null;
  const trends = p.trends.filter((t) => area === "all" || t.area_code === area);
  const growth = trends.filter((t) => t.points.length > 1).sort((a, b) => b.change_since_first - a.change_since_first).slice(0, 6);
  const values = snaps.flatMap((s) => [s.overall, s.ideas, s.resources, s.action]);
  const min = Math.max(0, Math.floor((Math.min(...values) - 10) / 10) * 10);

  return (
    <>
      <PageHeader title={t("progress.title")} subtitle={t("progress.subtitle", { count: snaps.length })} />
      {p.locked_features?.includes("progress.history") && (
        <div style={{ marginBottom: 20 }}>
          <InlineAlert tone="info" title={t("progress.locked.title")}>
            {t("progress.locked.text")} <LinkButton to="/plans" size="sm" variant="ghost">{t("progress.locked.link")}</LinkButton>
          </InlineAlert>
        </div>
      )}
      <div style={{ marginBottom: 24, overflowX: "auto" }}>
        <Tabs id="progress-area" ariaLabel={t("progress.filterAria")} value={area} onChange={setArea} tabs={[{ value: "all", label: t("progress.allCompetencies") }, ...AREAS]} />
      </div>
      <div {...tabPanelProps("progress-area", area)} className="ik-grid3" style={{ marginBottom: 24 }}>
        <Card padding={24}>
          <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{area === "all" ? t("dashboard.score.title") : AREAS.find((a) => a.value === area)?.label}</p>
          <div style={{ marginTop: 8 }}><ScoreValue value={last} label={t("progress.currentScore")} /></div>
          <dl className="ik-kv" style={{ marginTop: 16 }}>
            {prev !== null && <><dt>{t("progress.previous")}</dt><dd>{prev}</dd></>}
            <dt>{t("progress.change")}</dt><dd style={{ fontWeight: 600, color: last - (prev ?? last) >= 0 ? "var(--color-growth-700)" : "var(--color-error)" }}>{prev !== null ? signed(last - prev) : "—"}</dd>
            <dt>{t("progress.sinceFirst")}</dt><dd>{signed(last - first) || "0"}</dd>
          </dl>
          <ul style={{ marginTop: 16, listStyle: "none", padding: 0 }}>
            {[...snaps].reverse().map((s) => (
              <li key={s.attempt_id} className="ik-list-row">
                <span><span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>{s.label}</span><span style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{formatDate(s.date)}</span></span>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{pick(s)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="ik-span2">
          <ChartCard title={t("progress.history.title")} description={labels.join(" → ")}
            legend={area === "all" ? [{ label: t("progress.history.overall"), color: "var(--color-brand-600)" }, ...AREAS.map((a) => ({ label: a.label, color: AREA_COLOR[a.value] }))] : undefined}
            summary={snaps.length > 1 ? t("progress.history.summary", { first, last, change: signed(last - first) || "0" }) : t("progress.history.single")}>
            <LineChart height={240} labels={labels} min={min} ticks={[min, Math.round((min + 100) / 2), 100]} series={series} ariaLabel={t("progress.history.chartAria")} />
          </ChartCard>
        </div>
      </div>
      <div className="ik-grid4" style={{ marginBottom: 24 }}>
        <StatCard label={t("progress.stats.learning")} value={p.completed_resources} description={t("progress.stats.learningDescription")} icon="book-open" tone="growth" />
        <StatCard label={t("progress.stats.practice")} value={p.completed_tasks} description={t("progress.stats.practiceDescription")} icon="pencil-ruler" />
        <StatCard label={t("progress.stats.reflections")} value={p.reflections} description={t("progress.stats.reflectionsDescription")} icon="message-square-text" tone="neutral" />
        <StatCard label={t("progress.stats.reassessments")} value={p.reassessments} description={t("progress.stats.reassessmentsDescription", { count: snaps.length })} icon="refresh-cw" tone="neutral" />
      </div>
      <div className="ik-grid2">
        <ChartCard title={t("progress.growth.title")} description={t("progress.growth.description")}
          summary={growth[0] ? t("progress.growth.summary", { name: growth[0].name, change: signed(growth[0].change_since_first) || "0" }) : t("progress.growth.empty")}>
          {growth.length ? <CompareBars items={growth.map((t) => ({ label: t.name, before: t.first, after: t.current }))} beforeLabel={t("progress.growth.first")} afterLabel={t("progress.growth.latest")} />
            : <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{t("progress.growth.none")}</p>}
        </ChartCard>
        <Card padding={24}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t("progress.recent.title")}</h2>
          {p.recent.length ? (
            <ul style={{ marginTop: 8, listStyle: "none", padding: 0 }}>
              {p.recent.map((a) => (
                <li key={a.title + a.date} className="ik-list-row">
                  <span style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                    <span aria-hidden="true" style={{ width: 32, height: 32, flex: "none", borderRadius: 8, display: "grid", placeItems: "center", background: "var(--color-growth-50)", color: "var(--color-growth-600)" }}><Icon name="check" size={16} /></span>
                    <span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>{a.title}</span><span style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{a.competency} · {a.type}</span></span>
                  </span>
                  <span style={{ fontSize: 12, color: "var(--color-neutral-500)", whiteSpace: "nowrap" }}>{formatDate(a.date, { day: "numeric", month: "short" })}</span>
                </li>
              ))}
            </ul>
          ) : <p style={{ marginTop: 8, fontSize: 14, color: "var(--color-neutral-500)" }}>{t("progress.recent.empty")}</p>}
        </Card>
      </div>
    </>
  );
}
