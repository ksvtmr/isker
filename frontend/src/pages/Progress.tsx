import { Card, ChartCard, CompareBars, EmptyState, Icon, LineChart, PageHeader, ScoreValue, StatCard, Tabs } from "@isker/design-system";
import { useState } from "react";
import { useProgress } from "../api/progress";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { AREA_COLOR, formatDate, shortMonth, signed } from "../utils/format";

const AREAS = [{ value: "ideas", label: "Ideas & Opportunities" }, { value: "resources", label: "Resources" }, { value: "action", label: "Into Action" }] as const;

export function ProgressPage() {
  const { data: p, isLoading, error, refetch } = useProgress();
  const [area, setArea] = useState("all");
  if (isLoading) return <PageSkeleton />;
  if (error || !p) return <><PageHeader title="Your Progress" /><ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!p.snapshots.length) {
    return <><PageHeader title="Your Progress" /><EmptyState icon="trending-up" title="No progress data yet" description="Complete your first assessment to start tracking your development." action={<LinkButton to="/assessment">Start Assessment</LinkButton>} /></>;
  }

  const snaps = p.snapshots;
  const labels = snaps.map((s) => `${s.label.split(" · ")[0]} · ${shortMonth(s.date)}`);
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
      <PageHeader title="Your Progress" subtitle={`How your competencies changed across ${snaps.length} measurement${snaps.length === 1 ? "" : "s"}.`} />
      <div style={{ marginBottom: 24, overflowX: "auto" }}>
        <Tabs ariaLabel="Filter by area" value={area} onChange={setArea} tabs={[{ value: "all", label: "All competencies" }, ...AREAS]} />
      </div>
      <div className="ik-grid3" style={{ marginBottom: 24 }}>
        <Card padding={24}>
          <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{area === "all" ? "Entrepreneurial Score" : AREAS.find((a) => a.value === area)?.label}</p>
          <div style={{ marginTop: 8 }}><ScoreValue value={last} label="Current score" /></div>
          <dl className="ik-kv" style={{ marginTop: 16 }}>
            {prev !== null && <><dt>Previous</dt><dd>{prev}</dd></>}
            <dt>Change</dt><dd style={{ fontWeight: 600, color: last - (prev ?? last) >= 0 ? "var(--color-growth-600)" : "var(--color-error)" }}>{prev !== null ? signed(last - prev) : "—"}</dd>
            <dt>Since first</dt><dd>{signed(last - first) || "0"}</dd>
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
          <ChartCard title="Score history" description={labels.join(" → ")}
            legend={area === "all" ? [{ label: "Overall", color: "var(--color-brand-600)" }, ...AREAS.map((a) => ({ label: a.label, color: AREA_COLOR[a.value] }))] : undefined}
            summary={snaps.length > 1 ? `Score moved from ${first} to ${last} (${signed(last - first)}).` : "Reassess to see how your scores change."}>
            <LineChart height={240} labels={labels} min={min} ticks={[min, Math.round((min + 100) / 2), 100]} series={series} ariaLabel="Score history by area" />
          </ChartCard>
        </div>
      </div>
      <div className="ik-grid4" style={{ marginBottom: 24 }}>
        <StatCard label="Completed learning" value={p.completed_resources} description="Articles, videos, courses" icon="book-open" tone="growth" />
        <StatCard label="Completed practice" value={p.completed_tasks} description="Practical tasks with feedback" icon="pencil-ruler" />
        <StatCard label="Reflections" value={p.reflections} description="Plan reflection steps" icon="message-square-text" tone="neutral" />
        <StatCard label="Reassessments" value={p.reassessments} description={`${snaps.length} measurements in total`} icon="refresh-cw" tone="neutral" />
      </div>
      <div className="ik-grid2">
        <ChartCard title="Competency growth" description="First measurement → latest, largest changes first"
          summary={growth[0] ? `Largest change: ${growth[0].name} (${signed(growth[0].change_since_first)}).` : "Growth appears after your second measurement."}>
          {growth.length ? <CompareBars items={growth.map((t) => ({ label: t.name, before: t.first, after: t.current }))} beforeLabel="First" afterLabel="Latest" />
            : <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>No competency has been measured twice yet.</p>}
        </ChartCard>
        <Card padding={24}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Recent activities</h2>
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
          ) : <p style={{ marginTop: 8, fontSize: 14, color: "var(--color-neutral-500)" }}>Complete learning or practice activities to see them here.</p>}
        </Card>
      </div>
    </>
  );
}
