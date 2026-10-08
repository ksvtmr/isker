import { AIInsight, Card, CompetencyCard, EmptyState, GapBadge, PageHeader, ProgressBar, SectionTitle, Tabs, Button } from "@isker/design-system";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useGaps, useScoreProfile } from "../api/competencies";
import { LinkButton, useSpaClick } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { AREA_COLOR, formatDate, gapLabel } from "../utils/format";

function GapTable() {
  const { data: gaps, isLoading, error, refetch } = useGaps();
  const [showAll, setShowAll] = useState(false);
  const spa = useSpaClick();
  if (isLoading) return <PageSkeleton cards={0} chart={false} />;
  if (error || !gaps) return <ErrorState error={error} onRetry={() => refetch()} />;
  const rows = gaps.filter((g) => showAll || g.gap >= 10);
  const top = gaps[0];
  return (
    <div className="ik-grid3" style={{ alignItems: "start" }}>
      <Card className="ik-span2" style={{ overflow: "hidden" }}>
        <div className="ik-table-wrap">
          <table className="ik-table">
            <caption className="isk-sr-only">Competency gaps ordered by priority</caption>
            <thead><tr><th>#</th><th>Competency</th><th className="num">Score</th><th className="num">Target</th><th style={{ width: "24%" }}>Distance</th><th>Gap</th><th>Priority</th><th><span className="isk-sr-only">Action</span></th></tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.code}>
                  <td className="num" style={{ color: "var(--color-neutral-500)" }}>{g.priority_rank}</td>
                  <td>
                    <a className="ik-link" href={`/competencies/${g.code}`} onClick={spa(`/competencies/${g.code}`)}>{g.name}</a>
                    <div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{g.area_name}</div>
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{g.current}</td>
                  <td className="num">{g.target}</td>
                  <td><ProgressBar value={g.current} target={g.target} showValue={false} height={6} ariaLabel={`${g.name}: ${g.current} of target ${g.target}`}
                    color={g.gap >= 20 ? "var(--color-error)" : g.gap >= 10 ? "var(--color-warning)" : "var(--color-growth-500)"} /></td>
                  <td><GapBadge gap={gapLabel(g.band)} suffix={g.gap > 0 ? `· ${g.gap}` : ""} /></td>
                  <td style={{ fontSize: 13, color: "var(--color-neutral-700)" }}>{g.priority_label}</td>
                  <td style={{ textAlign: "right" }}>{g.gap >= 10 && <LinkButton to={`/development-plan?focus=${g.code}`} size="sm" variant="ghost">Plan</LinkButton>}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>No competency is 10 or more points below its target.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-neutral-100)" }}>
          <Button size="sm" variant="ghost" iconRight={showAll ? "chevron-up" : "chevron-down"} onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
            {showAll ? "Show priority gaps only" : `Show all ${gaps.length} competencies`}
          </Button>
        </div>
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <AIInsight title="How priorities are set" context="Gap · goals · importance">
          Priority combines the size of the gap (50%), how relevant the competency is to your goals (25%), its importance for
          early-stage ventures (15%) and how foundational it is for other competencies (10%).
          {top && top.gap > 0 && <> <b>{top.name}</b> ranks first: {top.gap} points below your target of {top.target}.</>}
        </AIInsight>
        <Card padding={20}>
          <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>Next step</p>
          <p style={{ marginTop: 4, fontSize: 15, fontWeight: 600 }}>Close your top gap with a 4-step plan</p>
          <div style={{ marginTop: 14 }}><LinkButton to="/development-plan" fullWidth>Open development plan</LinkButton></div>
        </Card>
      </div>
    </div>
  );
}

export function CompetenciesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "gaps" ? "gaps" : "profile";
  const { data: p, isLoading, error, refetch } = useScoreProfile();
  const navigate = useNavigate();
  const [area, setArea] = useState("all");

  if (isLoading) return <PageSkeleton />;
  if (error || !p) return <><PageHeader title="Competencies" /><ErrorState error={error} onRetry={() => refetch()} /></>;

  const tabs = <div style={{ marginBottom: 24 }}><Tabs variant="line" ariaLabel="Competency views" value={tab} onChange={(v) => setParams(v === "gaps" ? { tab: "gaps" } : {})} tabs={[{ value: "profile", label: "15 Competencies" }, { value: "gaps", label: "Gap analysis" }]} /></div>;

  if (!p.has_profile) {
    return (
      <>
        <PageHeader title="Competencies" subtitle="The 15 EntreComp competencies in three areas." />
        <EmptyState icon="radar" title="Your profile is empty" description="Complete the assessment to see a score, level and gap for each competency." action={<LinkButton to="/assessment">Start Assessment</LinkButton>} />
        <div style={{ marginTop: 32 }} className="ik-grid-cards">
          {p.competencies.map((c) => <CompetencyCard key={c.code} name={c.name} area={c.area_name} score={0} notAssessed description={c.description} />)}
        </div>
      </>
    );
  }

  const areas = p.areas.filter((a) => area === "all" || area === a.code);
  return (
    <>
      <PageHeader
        title={tab === "gaps" ? "Your Competency Gaps" : "Competency Profile"}
        subtitle={tab === "gaps" ? "Gap = target − score. High ≥ 20 points, Medium 10–19, Low under 10." : `Latest measurement ${formatDate(p.assessed_at)}. Open a competency to see the evidence behind its score.`}
      />
      {tabs}
      {tab === "gaps" ? <GapTable /> : (
        <>
          <div style={{ marginBottom: 24, overflowX: "auto" }}>
            <Tabs ariaLabel="Filter by area" value={area} onChange={setArea} tabs={[{ value: "all", label: "All competencies" }, ...p.areas.map((a) => ({ value: a.code, label: a.name }))]} />
          </div>
          {areas.map((a) => (
            <section key={a.code} style={{ marginBottom: 32 }} aria-labelledby={`area-${a.code}`}>
              <SectionTitle
                title={<span id={`area-${a.code}`} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: AREA_COLOR[a.code] }} />{a.name}</span>}
                description={`Area score ${a.score ?? "—"} / 100`}
              />
              <div className="ik-grid-cards">
                {p.competencies.filter((c) => c.area_code === a.code).map((c) => (
                  c.score === null
                    ? <CompetencyCard key={c.code} name={c.name} score={0} notAssessed description={c.description} />
                    : <CompetencyCard key={c.code} name={c.name} score={c.score} target={c.target} gap={gapLabel(c.gap_band)} description={c.explanation ? undefined : c.description}
                        href={`/competencies/${c.code}`} onClick={() => navigate(`/competencies/${c.code}`)} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  );
}
