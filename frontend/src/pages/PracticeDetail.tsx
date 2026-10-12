import { AIInsight, Button, Card, EmptyState, LevelBadge, PageHeader, ProgressBar, ScoreValue, StatusBadge, Textarea } from "@isker/design-system";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useCompleteTask, useStartTask, useSubmitTask, useTask } from "../api/learning";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton, ApiErrorAlert } from "../components/States";
import { useToast } from "../components/Toaster";
import { confidenceLabel, difficultyLabel } from "../utils/format";

export function PracticeDetailPage() {
  const { t } = useTranslation("learning");
  const id = Number(useParams().id);
  const { data: task, isLoading, error, refetch } = useTask(id);
  const start = useStartTask();
  const submit = useSubmitTask();
  const complete = useCompleteTask();
  const navigate = useNavigate();
  const toast = useToast();
  const [text, setText] = useState("");
  useEffect(() => { if (task?.response_text) setText(task.response_text); }, [task?.response_text]);

  if (isLoading) return <PageSkeleton cards={0} />;
  if (error || !task) {
    if (error instanceof ApiError && error.status === 404) return <EmptyState icon="search-x" title={t("practiceDetail.notFound")} action={<LinkButton to="/practice">{t("practiceDetail.allTasks")}</LinkButton>} />;
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }
  const done = task.status === "completed";
  const len = text.trim().length;
  const fb = task.feedback;
  const mutationError = start.error ?? submit.error ?? complete.error;

  return (
    <>
      <PageHeader back={{ label: t("common:nav.practice"), href: "/practice", onClick: () => navigate("/practice") }}
        eyebrow={`${t("practiceDetail.practicalTask")} · ${t("common:time.minutes", { count: task.duration_minutes })} · ${difficultyLabel(task.difficulty)}`} title={task.title} subtitle={task.description} />
      {mutationError && <div style={{ marginBottom: 16 }}><ApiErrorAlert error={mutationError} /></div>}
      <div className="ik-grid3" style={{ alignItems: "start" }}>
        <div className="ik-span2" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card padding={28}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t("practiceDetail.taskHeading")}</h2>
            <p style={{ marginTop: 8, fontSize: 15, lineHeight: 1.6, color: "var(--color-neutral-700)" }}>{task.instructions}</p>
            {!task.status ? (
              <div style={{ marginTop: 20 }}><Button size="lg" iconLeft="pencil-ruler" loading={start.isPending} onClick={() => start.mutate(task.id)}>{t("practiceDetail.startTask")}</Button></div>
            ) : (
              <div style={{ marginTop: 20 }}>
                <Textarea label={t("practiceDetail.responseLabel")} rows={9} maxLength={6000} value={text} disabled={done} onChange={(e) => setText(e.target.value)}
                  hint={done ? t("practiceDetail.hintDone") : len < task.min_length ? t("practiceDetail.hintMore", { count: task.min_length - len }) : t("practiceDetail.hintReady")} />
                {!done && (
                  <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <Button iconLeft="sparkles" disabled={len < task.min_length} loading={submit.isPending}
                      onClick={() => submit.mutate({ id: task.id, text }, { onSuccess: () => toast({ title: t("practiceDetail.feedbackReadyTitle"), description: t("practiceDetail.feedbackReadyText") }) })}>
                      {fb ? t("practiceDetail.resubmit") : t("practiceDetail.submit")}
                    </Button>
                    {task.status === "submitted" && (
                      <Button variant="success" iconLeft="check" loading={complete.isPending}
                        onClick={() => complete.mutate(task.id, { onSuccess: () => toast({ title: t("practiceDetail.completedTitle"), description: t("practiceDetail.completedText") }) })}>
                        {t("practiceDetail.markComplete")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
          {fb && (
            <AIInsight title={t("practiceDetail.aiFeedback")} context={t("practiceDetail.aiContext", { competency: task.competency_name })} confidence={confidenceLabel(fb.confidence)}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <ScoreValue value={fb.score} size={32} label={t("practiceDetail.taskScore")} /><LevelBadge level={fb.level} />
              </div>
              {fb.explanation && <p style={{ marginTop: 10 }}>{fb.explanation}</p>}
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, background: "#fff", padding: 14, borderRadius: 10, border: "1px solid var(--color-brand-100)" }}>
                {fb.criteria.map((c) => <ProgressBar key={c.criterion} label={t("practiceDetail.criterionLabel", { criterion: c.criterion, rating: c.rating })} value={c.rating * 25} showValue={false} ariaLabel={t("practiceDetail.criterionAria", { criterion: c.criterion, rating: c.rating })} />)}
              </div>
              {fb.strengths.length > 0 && <p style={{ marginTop: 12 }}><b>{t("practiceDetail.strengths")}</b> {fb.strengths.join(", ")}.</p>}
              {fb.development_areas.length > 0 && <p style={{ marginTop: 4 }}><b>{t("practiceDetail.workOn")}</b> {fb.development_areas.join(", ")}.</p>}
              {fb.evidence.length > 0 && <p style={{ marginTop: 4, color: "var(--color-neutral-600)" }}>{t("practiceDetail.evidence", { text: fb.evidence[0] })}</p>}
            </AIInsight>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card padding={20}>
            <p style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>{t("practiceDetail.develops")}</p>
            <LinkButton to={`/competencies/${task.competency_code}`} variant="ghost" size="sm" style={{ paddingLeft: 0 }}>{task.competency_name}</LinkButton>
            <div style={{ marginTop: 8 }}>{done ? <StatusBadge status="done">{t("common:progressStatus.completed")}</StatusBadge> : task.status ? <StatusBadge status="progress">{task.status === "submitted" ? t("practiceDetail.feedbackReady") : t("common:progressStatus.in_progress")}</StatusBadge> : <StatusBadge status="todo">{t("common:progressStatus.not_started")}</StatusBadge>}</div>
            {task.reason && <p style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5, color: "var(--color-neutral-600)" }}>{task.reason}</p>}
            {done && <div style={{ marginTop: 16 }}><LinkButton to="/development-plan" variant="secondary" fullWidth iconRight="arrow-right">{t("practiceDetail.backToPlan")}</LinkButton></div>}
          </Card>
          <Card padding={20}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>{t("practiceDetail.howAssessed")}</h2>
            <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-700)" }}>
              {task.rubric.map((r) => <li key={r.criterion}><b>{r.criterion}</b> — {r.description}</li>)}
            </ul>
            <p style={{ marginTop: 10, fontSize: 12, color: "var(--color-neutral-500)" }}>{t("practiceDetail.rubricNote")}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
