import { AIInsight, Card, CompetencyCard, EmptyState, GapBadge, ProgressBar, SectionTitle, Tabs, Button, tabPanelProps } from "@isker/design-system";
import { PageHeader } from "../components/PageTitle";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useGaps, useScoreProfile } from "../api/competencies";
import { LinkButton, useSpaClick } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { AREA_COLOR, formatDate, gapLabel } from "../utils/format";

function GapTable() {
  const { t } = useTranslation("assessment");
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
            <caption className="isk-sr-only">{t("competencies.gapTable.caption")}</caption>
            <thead><tr><th>{t("common:format.numberHeader")}</th><th>{t("competencies.gapTable.competency")}</th><th className="num">{t("competencies.gapTable.score")}</th><th className="num">{t("competencies.gapTable.target")}</th><th style={{ width: "24%" }}>{t("competencies.gapTable.distance")}</th><th>{t("competencies.gapTable.gap")}</th><th>{t("competencies.gapTable.priority")}</th><th><span className="isk-sr-only">{t("competencies.gapTable.action")}</span></th></tr></thead>
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
                  <td><ProgressBar value={g.current} target={g.target} showValue={false} height={6} ariaLabel={t("competencies.gapTable.distanceAria", { name: g.name, current: g.current, target: g.target })}
                    color={g.gap >= 20 ? "var(--color-error)" : g.gap >= 10 ? "var(--color-warning)" : "var(--color-growth-500)"} /></td>
                  <td><GapBadge gap={gapLabel(g.band)} suffix={g.gap > 0 ? `· ${g.gap}` : ""} /></td>
                  <td style={{ fontSize: 13, color: "var(--color-neutral-700)" }}>{g.priority_label}</td>
                  <td style={{ textAlign: "right" }}>{g.gap >= 10 && <LinkButton to={`/development-plan?focus=${g.code}`} size="sm" variant="ghost">{t("competencies.gapTable.plan")}</LinkButton>}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>{t("competencies.gapTable.noRows")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-neutral-100)" }}>
          <Button size="sm" variant="ghost" iconRight={showAll ? "chevron-up" : "chevron-down"} onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
            {showAll ? t("competencies.gapTable.showPriorityOnly") : t("competencies.gapTable.showAll", { count: gaps.length })}
          </Button>
        </div>
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <AIInsight title={t("competencies.howTitle")} context={t("competencies.howContext")}>
          {t("competencies.howText")}
          {top && top.gap > 0 && <> <b>{top.name}</b> {t("competencies.topRank", { count: top.gap, target: top.target })}</>}
        </AIInsight>
        <Card padding={20}>
          <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{t("competencies.nextStep")}</p>
          <p style={{ marginTop: 4, fontSize: 15, fontWeight: 600 }}>{t("competencies.nextStepTitle")}</p>
          <div style={{ marginTop: 14 }}><LinkButton to="/development-plan" fullWidth>{t("competencies.openPlan")}</LinkButton></div>
        </Card>
      </div>
    </div>
  );
}

export function CompetenciesPage() {
  const { t } = useTranslation("assessment");
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "gaps" ? "gaps" : "profile";
  const { data: p, isLoading, error, refetch } = useScoreProfile();
  const navigate = useNavigate();
  const [area, setArea] = useState("all");

  if (isLoading) return <PageSkeleton />;
  if (error || !p) return <><PageHeader title={t("competencies.title")} /><ErrorState error={error} onRetry={() => refetch()} /></>;

  const tabs = <div style={{ marginBottom: 24 }}><Tabs id="competency-views" variant="line" ariaLabel={t("competencies.viewsAria")} value={tab} onChange={(v) => setParams(v === "gaps" ? { tab: "gaps" } : {})} tabs={[{ value: "profile", label: t("competencies.tabProfile", { count: p.competencies.length }) }, { value: "gaps", label: t("competencies.tabGaps") }]} /></div>;

  if (!p.has_profile) {
    return (
      <>
        <PageHeader title={t("competencies.title")} subtitle={t("competencies.emptySubtitle", { count: p.competencies.length, areas: t("competencies.areasCount", { count: p.areas.length }) })} />
        <EmptyState icon="radar" title={t("competencies.emptyTitle")} description={t("competencies.emptyText")} action={<LinkButton to="/assessment">{t("assessmentIntro.startButton")}</LinkButton>} />
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
        title={tab === "gaps" ? t("competencies.gapsTitle") : t("competencies.profileTitle")}
        subtitle={tab === "gaps" ? t("competencies.gapsSubtitle") : t("competencies.profileSubtitle", { date: formatDate(p.assessed_at) })}
      />
      {tabs}
      <div {...tabPanelProps("competency-views", tab)}>
      {tab === "gaps" ? <GapTable /> : (
        <>
          <div style={{ marginBottom: 24, overflowX: "auto" }}>
            <Tabs id="competency-areas" ariaLabel={t("competencies.areaFilterAria")} value={area} onChange={setArea} tabs={[{ value: "all", label: t("competencies.allCompetencies") }, ...p.areas.map((a) => ({ value: a.code, label: a.name }))]} />
          </div>
          <div {...tabPanelProps("competency-areas", area)}>
          {areas.map((a) => (
            <section key={a.code} style={{ marginBottom: 32 }} aria-labelledby={`area-${a.code}`}>
              <SectionTitle
                title={<span id={`area-${a.code}`} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: AREA_COLOR[a.code] }} />{a.name}</span>}
                description={t("competencies.areaScore", { score: a.score ?? t("common:state.none") })}
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
          </div>
        </>
      )}
      </div>
    </>
  );
}
