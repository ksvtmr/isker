import { Button, Card, EmptyState, GapBadge, InlineAlert, Modal, PageHeader, PlanStep, ProgressBar, StatusBadge, Textarea, type PlanStepStatus } from "@isker/design-system";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useStartAttempt } from "../api/assessments";
import { errorMessage } from "../api/client";
import { usePlan, useReflect } from "../api/recommendations";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { useToast } from "../components/Toaster";
import type { Activity, Recommendation } from "../types/api";
import { formatDate, gapLabel } from "../utils/format";

function stepStatus(a: Activity, acts: Activity[]): PlanStepStatus {
  if (a.status === "done") return "done";
  if (a.locked) return "locked";
  const firstOpen = acts.find((x) => x.status !== "done" && !x.locked);
  return firstOpen?.id === a.id || a.status === "in_progress" ? "current" : "todo";
}

function PlanDetail({ rec }: { rec: Recommendation }) {
  const navigate = useNavigate();
  const toast = useToast();
  const reflect = useReflect();
  const start = useStartAttempt();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const acts = rec.activities;
  const by = (k: Activity["kind"]) => acts.find((a) => a.kind === k);
  const learn = by("learn"), practice = by("practice"), refl = by("reflect"), re = by("reassess");

  const saveReflection = () =>
    refl && reflect.mutate({ activityId: refl.id, text }, {
      onSuccess: () => { setOpen(false); setText(""); toast({ title: "Reflection saved" }); },
    });
  const reassess = () =>
    start.mutate({ scope: "competency", competency_id: rec.competency_id }, { onSuccess: (r) => navigate(`/assessment/${r.attempt.id}`) });

  return (
    <Card padding={28}>
      <PlanStep step="gap" status="done" title={rec.competency_name} meta={`Current ${rec.current} / 100 · Target ${rec.target} / 100`}>
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <GapBadge gap={gapLabel(rec.band)} />
          <span style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>{rec.reason}</span>
        </div>
      </PlanStep>
      {learn && (
        <PlanStep step="learn" status={stepStatus(learn, acts)} title={learn.title}
          meta={[learn.duration_minutes && `${learn.duration_minutes} min`, learn.type].filter(Boolean).join(" · ")}
          action={learn.resource_id && (learn.status === "done"
            ? <LinkButton to={`/learning/${learn.resource_id}`} size="sm" variant="ghost">Review</LinkButton>
            : <LinkButton to={`/learning/${learn.resource_id}`} size="sm" iconLeft="book-open">{learn.status === "in_progress" ? "Continue Learning" : "Start Learning"}</LinkButton>)} />
      )}
      {practice && (
        <PlanStep step="practice" status={stepStatus(practice, acts)} title={practice.title}
          meta={[practice.duration_minutes && `${practice.duration_minutes} min`, "Practical task"].filter(Boolean).join(" · ")}
          action={practice.task_id && (practice.status === "done"
            ? <LinkButton to={`/practice/${practice.task_id}`} size="sm" variant="ghost">View feedback</LinkButton>
            : <LinkButton to={`/practice/${practice.task_id}`} size="sm" variant={stepStatus(practice, acts) === "current" ? "primary" : "secondary"} iconLeft="pencil-ruler">
                {practice.status === "in_progress" ? "Continue Practice" : "Start Practice"}
              </LinkButton>)} />
      )}
      {refl && (
        <PlanStep step="reflect" status={stepStatus(refl, acts)} title={refl.prompt ?? refl.title}
          action={refl.status === "done"
            ? <p style={{ fontSize: 14, color: "var(--color-neutral-600)", fontStyle: "italic" }}>“{refl.response_text}”</p>
            : <Button size="sm" variant={stepStatus(refl, acts) === "current" ? "primary" : "secondary"} iconLeft="message-square-text" onClick={() => setOpen(true)}>Write Reflection</Button>} />
      )}
      {re && (
        <PlanStep step="reassess" last status={stepStatus(re, acts)}
          title={re.status === "done" ? `Reassessed ${rec.competency_name}` : re.locked ? "Available after completing the activities above" : `Ready to reassess ${rec.competency_name}`}
          meta={!re.locked && re.status !== "done" ? "About 5 minutes · only this competency" : undefined}
          action={!re.locked && re.status !== "done" && <Button size="sm" variant="success" iconLeft="refresh-cw" loading={start.isPending} onClick={reassess}>Start Reassessment</Button>} />
      )}
      {start.error && <div style={{ marginTop: 12 }}><InlineAlert>{errorMessage(start.error)}</InlineAlert></div>}
      <Modal open={open} onClose={() => setOpen(false)} title="Write reflection" description={refl?.prompt ?? undefined}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={text.trim().length < 10} loading={reflect.isPending} onClick={saveReflection}>Save reflection</Button></>}>
        {reflect.error && <div style={{ marginBottom: 12 }}><InlineAlert>{errorMessage(reflect.error)}</InlineAlert></div>}
        <Textarea label="Your reflection" rows={5} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} hint="At least 10 characters." placeholder="The assumption I'm least sure about is…" />
      </Modal>
    </Card>
  );
}

export function DevelopmentPlanPage() {
  const { data: plan, isLoading, error, refetch } = usePlan();
  const [params, setParams] = useSearchParams();
  if (isLoading) return <PageSkeleton />;
  if (error || !plan) return <><PageHeader title="Your Development Plan" /><ErrorState error={error} onRetry={() => refetch()} /></>;

  if (!plan.recommendations.length) {
    return (
      <>
        <PageHeader title="Your Development Plan" />
        <EmptyState icon="route" title="No plan yet" description="Complete the assessment. Your plan is built from your priority competency gaps." action={<LinkButton to="/assessment">Start Assessment</LinkButton>} />
      </>
    );
  }
  const focus = params.get("focus");
  const sel = plan.recommendations.find((r) => r.competency_code === focus) ?? plan.recommendations[0];

  return (
    <>
      <PageHeader title="Your Development Plan" subtitle="Personalised from your competency gaps and goals: Learn → Practice → Reflect → Reassess." />
      <Card padding={20} style={{ marginBottom: 24 }}>
        <ProgressBar label={`Plan progress · ${plan.done} of ${plan.total} activities`} value={plan.progress_pct} color="var(--color-growth-500)" />
      </Card>
      <div className="ik-plan">
        <nav aria-label="Priorities" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {plan.recommendations.map((r) => (
            <button key={r.id} type="button" onClick={() => setParams({ focus: r.competency_code })} className="ik-plan-item" aria-current={r.id === sel.id || undefined}>
              <span style={{ fontSize: 12, color: "var(--color-neutral-500)", fontWeight: 500 }}>Priority {r.priority}</span>
              <span style={{ marginTop: 4, display: "block", fontSize: 15, fontWeight: 600, color: "var(--color-neutral-900)" }}>{r.competency_name}</span>
              <span style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13, color: "var(--color-neutral-600)", fontVariantNumeric: "tabular-nums" }}><b style={{ color: "var(--color-neutral-900)" }}>{r.current}</b> → {r.target}</span>
                <GapBadge gap={gapLabel(r.band)} suffix="priority" />
              </span>
              <span style={{ marginTop: 10, display: "block" }}><ProgressBar value={r.progress_pct} showValue={false} height={4} color="var(--color-growth-500)" ariaLabel={`${r.progress_pct}% complete`} /></span>
            </button>
          ))}
          {plan.completed.length > 0 && (
            <Card padding={16}>
              <p style={{ fontSize: 13, fontWeight: 600 }}>Completed cycles</p>
              <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
                {plan.completed.map((r) => (
                  <li key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "6px 0" }}>
                    <span>{r.competency_name}</span><StatusBadge status="done">{formatDate(r.created_at, { month: "short", year: "numeric" })}</StatusBadge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </nav>
        <PlanDetail key={sel.id} rec={sel} />
      </div>
    </>
  );
}
