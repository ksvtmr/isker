import { AIInsight, Button, Card, EmptyState, InlineAlert, LevelBadge, PageHeader, ProgressBar, ScoreValue, StatusBadge, Textarea } from "@isker/design-system";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, errorMessage } from "../api/client";
import { useCompleteTask, useStartTask, useSubmitTask, useTask } from "../api/learning";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { useToast } from "../components/Toaster";
import { DIFFICULTY_LABEL, confidenceLabel } from "../utils/format";

export function PracticeDetailPage() {
  const id = Number(useParams().id);
  const { data: t, isLoading, error, refetch } = useTask(id);
  const start = useStartTask();
  const submit = useSubmitTask();
  const complete = useCompleteTask();
  const navigate = useNavigate();
  const toast = useToast();
  const [text, setText] = useState("");
  useEffect(() => { if (t?.response_text) setText(t.response_text); }, [t?.response_text]);

  if (isLoading) return <PageSkeleton cards={0} />;
  if (error || !t) {
    if (error instanceof ApiError && error.status === 404) return <EmptyState icon="search-x" title="Task not found" action={<LinkButton to="/practice">All tasks</LinkButton>} />;
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }
  const done = t.status === "completed";
  const len = text.trim().length;
  const fb = t.feedback;
  const mutationError = start.error ?? submit.error ?? complete.error;

  return (
    <>
      <PageHeader back={{ label: "Practice", href: "/practice", onClick: () => navigate("/practice") }}
        eyebrow={`Practical task · ${t.duration_minutes} min · ${DIFFICULTY_LABEL[t.difficulty]}`} title={t.title} subtitle={t.description} />
      {mutationError && <div style={{ marginBottom: 16 }}><InlineAlert>{errorMessage(mutationError)}</InlineAlert></div>}
      <div className="ik-grid3" style={{ alignItems: "start" }}>
        <div className="ik-span2" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card padding={28}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Task</h2>
            <p style={{ marginTop: 8, fontSize: 15, lineHeight: 1.6, color: "var(--color-neutral-700)" }}>{t.instructions}</p>
            {!t.status ? (
              <div style={{ marginTop: 20 }}><Button size="lg" iconLeft="pencil-ruler" loading={start.isPending} onClick={() => start.mutate(t.id)}>Start task</Button></div>
            ) : (
              <div style={{ marginTop: 20 }}>
                <Textarea label="Your response" rows={9} maxLength={6000} value={text} disabled={done} onChange={(e) => setText(e.target.value)}
                  hint={done ? "Completed — your response is saved." : len < t.min_length ? `${t.min_length - len} more characters for specific feedback.` : "Ready to submit."} />
                {!done && (
                  <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <Button iconLeft="sparkles" disabled={len < t.min_length} loading={submit.isPending}
                      onClick={() => submit.mutate({ id: t.id, text }, { onSuccess: () => toast({ title: "Feedback ready", description: "Review it, revise if you like, then mark the task complete." }) })}>
                      {fb ? "Resubmit for feedback" : "Submit for feedback"}
                    </Button>
                    {t.status === "submitted" && (
                      <Button variant="success" iconLeft="check" loading={complete.isPending}
                        onClick={() => complete.mutate(t.id, { onSuccess: () => toast({ title: "Task completed", description: "Added to your progress and plan." }) })}>
                        Mark complete
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
          {fb && (
            <AIInsight title="AI feedback" context={`${t.competency_name} · rubric-based`} confidence={confidenceLabel(fb.confidence)}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <ScoreValue value={fb.score} size={32} label="Task score" /><LevelBadge level={fb.level} />
              </div>
              {fb.explanation && <p style={{ marginTop: 10 }}>{fb.explanation}</p>}
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, background: "#fff", padding: 14, borderRadius: 10, border: "1px solid var(--color-brand-100)" }}>
                {fb.criteria.map((c) => <ProgressBar key={c.criterion} label={`${c.criterion} · ${c.rating}/4`} value={c.rating * 25} showValue={false} ariaLabel={`${c.criterion}: ${c.rating} of 4`} />)}
              </div>
              {fb.strengths.length > 0 && <p style={{ marginTop: 12 }}><b>Strengths:</b> {fb.strengths.join(", ")}.</p>}
              {fb.development_areas.length > 0 && <p style={{ marginTop: 4 }}><b>Work on:</b> {fb.development_areas.join(", ")}.</p>}
              {fb.evidence.length > 0 && <p style={{ marginTop: 4, color: "var(--color-neutral-600)" }}>Evidence: {fb.evidence[0]}</p>}
            </AIInsight>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card padding={20}>
            <p style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>Develops</p>
            <LinkButton to={`/competencies/${t.competency_code}`} variant="ghost" size="sm" style={{ paddingLeft: 0 }}>{t.competency_name}</LinkButton>
            <div style={{ marginTop: 8 }}>{done ? <StatusBadge status="done">Completed</StatusBadge> : t.status ? <StatusBadge status="progress">{t.status === "submitted" ? "Feedback ready" : "In progress"}</StatusBadge> : <StatusBadge status="todo">Not started</StatusBadge>}</div>
            {t.reason && <p style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5, color: "var(--color-neutral-600)" }}>{t.reason}</p>}
            {done && <div style={{ marginTop: 16 }}><LinkButton to="/development-plan" variant="secondary" fullWidth iconRight="arrow-right">Back to plan</LinkButton></div>}
          </Card>
          <Card padding={20}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>How it's assessed</h2>
            <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-700)" }}>
              {t.rubric.map((r) => <li key={r.criterion}><b>{r.criterion}</b> — {r.description}</li>)}
            </ul>
            <p style={{ marginTop: 10, fontSize: 12, color: "var(--color-neutral-500)" }}>Each criterion is rated 0–4. The score is the average, so the AI cannot set it freely.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
