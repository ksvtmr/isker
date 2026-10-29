import { Button, Card, Icon, InlineAlert, LanguageSelect, Modal, Select, type IconName } from "@isker/design-system";
import { PageHeader } from "../components/PageTitle";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAbandonAttempt, useAssessmentOverview, useStartAttempt } from "../api/assessments";
import { errorMessage } from "../api/client";
import { useScoreProfile } from "../api/competencies";
import { useSpaClick } from "../components/RouterLink";
import { ErrorState, PageSkeleton, ApiErrorAlert } from "../components/States";
import { formatDate } from "../utils/format";
import { appHref } from "../utils/appHref";
import type { Language } from "../i18n/config";
import { useLanguage } from "../i18n/useLanguage";

export function AssessmentIntro() {
  const { t } = useTranslation("assessment");
  const overview = useAssessmentOverview();
  const profile = useScoreProfile();
  const start = useStartAttempt();
  const navigate = useNavigate();
  const spa = useSpaClick();
  const [competency, setCompetency] = useState("");
  const [confirmRestart, setConfirmRestart] = useState(false);
  const abandon = useAbandonAttempt();
  const { language, setLanguage, options } = useLanguage();

  if (overview.isLoading) return <PageSkeleton cards={0} />;
  if (overview.error || !overview.data) return <><PageHeader title={t("assessmentIntro.title")} /><ErrorState error={overview.error} onRetry={() => overview.refetch()} /></>;

  const { assessment, in_progress: current, completed } = overview.data;
  const hasProfile = completed.length > 0;
  const go = (scope: "full" | "competency", competency_id?: number) =>
    start.mutate({ scope, competency_id }, { onSuccess: (r) => navigate(`/assessment/${r.attempt.id}`) });

  // Abandon (invalidates overview, dashboard, plan and usage), then start a fresh attempt. A failure stays visible
  // in the dialog instead of silently starting nothing.
  const restart = () => {
    if (!current) return;
    abandon.mutate(current.id, {
      onSuccess: () => { setConfirmRestart(false); go("full"); },
    });
  };
  const closeRestart = () => { setConfirmRestart(false); abandon.reset(); };
  const sectionState = (st: "done" | "current" | "todo") => t(`assessmentIntro.sectionState.${st}`);

  const facts: [IconName, string, string][] = [
    ["list-checks", t("assessmentIntro.facts.questions", { count: assessment.question_count }), t("assessmentIntro.facts.questionsText")],
    ["clock", t("assessmentIntro.facts.minutes", { count: assessment.estimated_minutes }), t("assessmentIntro.facts.minutesText")],
    ["lock", t("assessmentIntro.facts.private"), t("assessmentIntro.facts.privateText")],
  ];
  const doneSections = (() => {
    if (!current) return -1;
    let acc = 0;
    return assessment.sections.findIndex((s) => (acc += s.count) > current.current_index);
  })();

  return (
    <>
      <PageHeader title={assessment.title} subtitle={profile.data?.competencies.length ? t("assessmentIntro.subtitle", { count: profile.data.competencies.length }) : t("assessmentIntro.subtitleGeneric")} />
      {start.error && <div style={{ marginBottom: 16 }}><ApiErrorAlert error={start.error} /></div>}
      {!hasProfile && (
        // First visit: why the assessment comes first, how results are used, and its language.
        <Card padding={28} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600, margin: 0 }}>{t("firstTime.title")}</h2>
          <p style={{ marginTop: 8, lineHeight: 1.6 }}>{t("firstTime.why")}</p>
          <p style={{ marginTop: 8, lineHeight: 1.6, color: "var(--color-neutral-600)" }}>{t("firstTime.use")}</p>
          <div style={{ marginTop: 16, maxWidth: 320 }}>
            <LanguageSelect compact={false} label={t("firstTime.language")} value={language} options={options} onChange={(v) => setLanguage(v as Language)} />
            <p className="isk-hint" style={{ marginTop: 6 }}>{t("firstTime.languageHint")}</p>
          </div>
        </Card>
      )}
      <div className="ik-grid3" style={{ alignItems: "start", marginBottom: 24 }}>
        <Card padding={28} className="ik-span2">
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {facts.map(([ic, title, d]) => (
              <div key={ic} style={{ display: "flex", gap: 14 }}>
                <span style={{ width: 40, height: 40, flex: "none", borderRadius: 10, display: "grid", placeItems: "center", background: "var(--color-brand-50)", color: "var(--color-brand-600)" }}><Icon name={ic} size={18} /></span>
                <div><p style={{ fontSize: 15, fontWeight: 600 }}>{title}</p><p style={{ marginTop: 2, fontSize: 14, color: "var(--color-neutral-500)" }}>{d}</p></div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--color-neutral-100)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            {current ? (
              <>
                <Button size="lg" iconRight="arrow-right" onClick={() => navigate(`/assessment/${current.id}`)}>{t("assessmentIntro.continueButton")}</Button>
                <span style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>
                  {current.scope === "competency" ? `${t("assessmentIntro.reassessing", { name: current.competency?.name ?? "" })} · ` : ""}
                  {t("assessmentIntro.stoppedAt", { current: current.current_index + 1, total: current.total })}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRestart(true)}>{t("assessmentIntro.startOver")}</Button>
              </>
            ) : (
              <Button size="lg" iconRight="arrow-right" loading={start.isPending} onClick={() => go("full")}>
                {hasProfile ? t("assessmentIntro.retakeButton") : t("assessmentIntro.startButton")}
              </Button>
            )}
          </div>
        </Card>
        <Card padding={20}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t("assessmentIntro.sections")}</h2>
          {assessment.sections.map((s, i) => {
            const st = doneSections < 0 ? "todo" : i < doneSections ? "done" : i === doneSections ? "current" : "todo";
            return (
              <div key={s.name} style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
                <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center", background: st === "done" ? "var(--color-growth-50)" : st === "current" ? "var(--color-brand-50)" : "var(--color-neutral-100)", color: st === "done" ? "var(--color-growth-600)" : st === "current" ? "var(--color-brand-600)" : "var(--color-neutral-400)" }}>
                  <Icon name={st === "done" ? "check" : "circle-dot"} size={12} />
                </span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{s.name}{current && <span className="isk-sr-only"> — {sectionState(st)}</span>}</span>
                <span style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{t("assessmentIntro.sectionQuestions", { count: s.count })}</span>
              </div>
            );
          })}
        </Card>
      </div>

      {hasProfile && (
        <div className="ik-grid2" style={{ alignItems: "start" }}>
          <Card padding={24}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t("assessmentIntro.reassessTitle")}</h2>
            <p style={{ marginTop: 4, fontSize: 14, color: "var(--color-neutral-500)" }}>{t("assessmentIntro.reassessText")}</p>
            <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 220px" }}>
                <Select label={t("assessmentIntro.competencyLabel")} placeholder={t("assessmentIntro.competencyPlaceholder")} value={competency} onChange={(e) => setCompetency(e.target.value)}
                  options={(profile.data?.competencies ?? []).map((c) => ({ value: String(c.competency_id), label: `${c.name}${c.score !== null ? ` · ${c.score}` : ""}` }))} />
              </div>
              <Button variant="secondary" iconLeft="refresh-cw" disabled={!competency || !!current} loading={start.isPending} onClick={() => go("competency", Number(competency))}>{t("assessmentIntro.reassessButton")}</Button>
            </div>
            {current && <p className="isk-hint" style={{ marginTop: 8 }}>{t("assessmentIntro.finishOpenFirst")}</p>}
          </Card>
          <Card padding={24}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t("assessmentIntro.historyTitle")}</h2>
            <div className="ik-table-wrap" style={{ marginTop: 8 }}>
              <table className="ik-table">
                <thead><tr><th>{t("assessmentIntro.history.assessment")}</th><th>{t("assessmentIntro.history.date")}</th><th className="num">{t("assessmentIntro.history.score")}</th></tr></thead>
                <tbody>
                  {completed.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <a href={appHref(`/results?attempt=${a.id}`)} onClick={spa(`/results?attempt=${a.id}`)} className="ik-link">
                          {a.scope === "competency" ? t("assessmentIntro.history.reassessment", { name: a.competency?.name ?? "" }) : t("assessmentIntro.history.full", { n: a.sequence })}
                        </a>
                      </td>
                      <td>{formatDate(a.completed_at)}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{a.overall_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      <Modal open={confirmRestart} onClose={closeRestart} title={t("assessmentIntro.restartTitle")}
        description={t("assessmentIntro.restartText")}
        footer={<><Button variant="secondary" onClick={closeRestart}>{t("assessmentIntro.keepGoing")}</Button><Button variant="danger" loading={abandon.isPending || start.isPending} onClick={restart}>{t("assessmentIntro.startOver")}</Button></>}>
        {abandon.error ? <InlineAlert title={t("assessmentIntro.restartFailed")}>{errorMessage(abandon.error)}</InlineAlert> : undefined}
      </Modal>
    </>
  );
}
