import { Button, Card, Icon, InlineAlert, Modal, PageHeader, Select, type IconName } from "@isker/design-system";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { assessmentsApi, useAssessmentOverview, useStartAttempt } from "../api/assessments";
import { errorMessage } from "../api/client";
import { useScoreProfile } from "../api/competencies";
import { useSpaClick } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { formatDate } from "../utils/format";

export function AssessmentIntro() {
  const overview = useAssessmentOverview();
  const profile = useScoreProfile();
  const start = useStartAttempt();
  const navigate = useNavigate();
  const spa = useSpaClick();
  const [competency, setCompetency] = useState("");
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);

  if (overview.isLoading) return <PageSkeleton cards={0} />;
  if (overview.error || !overview.data) return <><PageHeader title="Assessment" /><ErrorState error={overview.error} onRetry={() => overview.refetch()} /></>;

  const { assessment, in_progress: current, completed } = overview.data;
  const hasProfile = completed.length > 0;
  const go = (scope: "full" | "competency", competency_id?: number) =>
    start.mutate({ scope, competency_id }, { onSuccess: (r) => navigate(`/assessment/${r.attempt.id}`) });

  const restart = async () => {
    if (!current) return;
    setRestarting(true);
    try {
      await assessmentsApi.abandon(current.id);
      go("full");
    } finally {
      setRestarting(false);
      setConfirmRestart(false);
    }
  };

  const facts: [IconName, string, string][] = [
    ["list-checks", `${assessment.question_count} questions`, "Self-assessment, situations, open answers and a short practical task"],
    ["clock", `About ${assessment.estimated_minutes} minutes`, "Answers save automatically — continue any time"],
    ["lock", "Private", "Only you see your answers. AI scores open answers against published rubrics."],
  ];
  const doneSections = (() => {
    if (!current) return -1;
    let acc = 0;
    return assessment.sections.findIndex((s) => (acc += s.count) > current.current_index);
  })();

  return (
    <>
      <PageHeader title={assessment.title} subtitle={`Measure the 15 EntreComp competencies and get a profile with strengths, gaps and a development plan.`} />
      {start.error && <div style={{ marginBottom: 16 }}><InlineAlert>{errorMessage(start.error)}</InlineAlert></div>}
      <div className="ik-grid3" style={{ alignItems: "start", marginBottom: 24 }}>
        <Card padding={28} className="ik-span2">
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {facts.map(([ic, t, d]) => (
              <div key={t} style={{ display: "flex", gap: 14 }}>
                <span style={{ width: 40, height: 40, flex: "none", borderRadius: 10, display: "grid", placeItems: "center", background: "var(--color-brand-50)", color: "var(--color-brand-600)" }}><Icon name={ic} size={18} /></span>
                <div><p style={{ fontSize: 15, fontWeight: 600 }}>{t}</p><p style={{ marginTop: 2, fontSize: 14, color: "var(--color-neutral-500)" }}>{d}</p></div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--color-neutral-100)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            {current ? (
              <>
                <Button size="lg" iconRight="arrow-right" onClick={() => navigate(`/assessment/${current.id}`)}>Continue assessment</Button>
                <span style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>
                  {current.scope === "competency" ? `Reassessing ${current.competency?.name} · ` : ""}You stopped at question {current.current_index + 1} of {current.total}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRestart(true)}>Start over</Button>
              </>
            ) : (
              <Button size="lg" iconRight="arrow-right" loading={start.isPending} onClick={() => go("full")}>
                {hasProfile ? "Retake Full Assessment" : "Start Assessment"}
              </Button>
            )}
          </div>
        </Card>
        <Card padding={20}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Sections</h2>
          {assessment.sections.map((s, i) => {
            const st = doneSections < 0 ? "todo" : i < doneSections ? "done" : i === doneSections ? "current" : "todo";
            return (
              <div key={s.name} style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
                <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center", background: st === "done" ? "var(--color-growth-50)" : st === "current" ? "var(--color-brand-50)" : "var(--color-neutral-100)", color: st === "done" ? "var(--color-growth-600)" : st === "current" ? "var(--color-brand-600)" : "var(--color-neutral-400)" }}>
                  <Icon name={st === "done" ? "check" : "circle-dot"} size={12} />
                </span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{s.name}</span>
                <span style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{s.count} {s.count === 1 ? "question" : "questions"}</span>
              </div>
            );
          })}
        </Card>
      </div>

      {hasProfile && (
        <div className="ik-grid2" style={{ alignItems: "start" }}>
          <Card padding={24}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Reassess one competency</h2>
            <p style={{ marginTop: 4, fontSize: 14, color: "var(--color-neutral-500)" }}>Answer only the questions for one competency (about 5 minutes). Previous scores are kept in your history.</p>
            <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 220px" }}>
                <Select label="Competency" placeholder="Choose a competency" value={competency} onChange={(e) => setCompetency(e.target.value)}
                  options={(profile.data?.competencies ?? []).map((c) => ({ value: String(c.competency_id), label: `${c.name}${c.score !== null ? ` · ${c.score}` : ""}` }))} />
              </div>
              <Button variant="secondary" iconLeft="refresh-cw" disabled={!competency || !!current} loading={start.isPending} onClick={() => go("competency", Number(competency))}>Reassess</Button>
            </div>
            {current && <p className="isk-hint" style={{ marginTop: 8 }}>Finish or restart your open assessment first.</p>}
          </Card>
          <Card padding={24}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Assessment history</h2>
            <div className="ik-table-wrap" style={{ marginTop: 8 }}>
              <table className="ik-table">
                <thead><tr><th>Assessment</th><th>Date</th><th className="num">Score</th></tr></thead>
                <tbody>
                  {completed.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <a href={`/results?attempt=${a.id}`} onClick={spa(`/results?attempt=${a.id}`)} className="ik-link">
                          {a.scope === "competency" ? `Reassessment · ${a.competency?.name}` : `Assessment ${a.sequence}`}
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

      <Modal open={confirmRestart} onClose={() => setConfirmRestart(false)} title="Start over?"
        description="Your open assessment will be discarded and a new one will start from question 1."
        footer={<><Button variant="secondary" onClick={() => setConfirmRestart(false)}>Keep going</Button><Button variant="danger" loading={restarting} onClick={restart}>Start over</Button></>} />
    </>
  );
}
