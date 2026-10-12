import { Button, Card, EmptyState, GapBadge, Modal, PageHeader, PlanStep, ProgressBar, StatusBadge, Textarea, type PlanStepStatus } from "@isker/design-system";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useStartAttempt } from "../api/assessments";
import { usePlan, useReflect } from "../api/recommendations";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton, ApiErrorAlert } from "../components/States";
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
  const { t } = useTranslation("learning");
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
      onSuccess: () => { setOpen(false); setText(""); toast({ title: t("plan.reflectionSaved") }); },
    });
  const reassess = () =>
    start.mutate({ scope: "competency", competency_id: rec.competency_id }, { onSuccess: (r) => navigate(`/assessment/${r.attempt.id}`) });

  return (
    <Card padding={28}>
      <PlanStep step="gap" status="done" title={rec.competency_name} meta={t("plan.gapMeta", { current: rec.current, target: rec.target })}>
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <GapBadge gap={gapLabel(rec.band)} />
          <span style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>{rec.reason}</span>
        </div>
      </PlanStep>
      {learn && (
        <PlanStep step="learn" status={stepStatus(learn, acts)} title={learn.title}
          meta={[learn.duration_minutes && t("common:time.minutes", { count: learn.duration_minutes }), learn.type && t(`common:resourceTypes.${learn.type}`, { defaultValue: learn.type })].filter(Boolean).join(" · ")}
          action={learn.resource_id && (learn.status === "done"
            ? <LinkButton to={`/learning/${learn.resource_id}`} size="sm" variant="ghost">{t("plan.review")}</LinkButton>
            : <LinkButton to={`/learning/${learn.resource_id}`} size="sm" iconLeft="book-open">{learn.status === "in_progress" ? t("plan.continueLearning") : t("plan.startLearning")}</LinkButton>)} />
      )}
      {practice && (
        <PlanStep step="practice" status={stepStatus(practice, acts)} title={practice.title}
          meta={[practice.duration_minutes && t("common:time.minutes", { count: practice.duration_minutes }), t("plan.practicalTask")].filter(Boolean).join(" · ")}
          action={practice.task_id && (practice.status === "done"
            ? <LinkButton to={`/practice/${practice.task_id}`} size="sm" variant="ghost">{t("plan.viewFeedback")}</LinkButton>
            : <LinkButton to={`/practice/${practice.task_id}`} size="sm" variant={stepStatus(practice, acts) === "current" ? "primary" : "secondary"} iconLeft="pencil-ruler">
                {practice.status === "in_progress" ? t("plan.continuePractice") : t("plan.startPractice")}
              </LinkButton>)} />
      )}
      {refl && (
        <PlanStep step="reflect" status={stepStatus(refl, acts)} title={refl.prompt ?? refl.title}
          action={refl.status === "done"
            ? <p style={{ fontSize: 14, color: "var(--color-neutral-600)", fontStyle: "italic" }}>{t("plan.reflectionQuote", { text: refl.response_text })}</p>
            : <Button size="sm" variant={stepStatus(refl, acts) === "current" ? "primary" : "secondary"} iconLeft="message-square-text" onClick={() => setOpen(true)}>{t("plan.writeReflection")}</Button>} />
      )}
      {re && (
        <PlanStep step="reassess" last status={stepStatus(re, acts)}
          title={re.status === "done" ? t("plan.reassessed", { competency: rec.competency_name }) : re.locked ? t("plan.reassessLocked") : t("plan.reassessReady", { competency: rec.competency_name })}
          meta={!re.locked && re.status !== "done" ? t("plan.reassessMeta") : undefined}
          action={!re.locked && re.status !== "done" && <Button size="sm" variant="success" iconLeft="refresh-cw" loading={start.isPending} onClick={reassess}>{t("plan.startReassessment")}</Button>} />
      )}
      {start.error && <div style={{ marginTop: 12 }}><ApiErrorAlert error={start.error} /></div>}
      <Modal open={open} onClose={() => setOpen(false)} title={t("plan.reflectionTitle")} description={refl?.prompt ?? undefined}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>{t("common:actions.cancel")}</Button><Button disabled={text.trim().length < 10} loading={reflect.isPending} onClick={saveReflection}>{t("plan.saveReflection")}</Button></>}>
        {reflect.error && <div style={{ marginBottom: 12 }}><ApiErrorAlert error={reflect.error} /></div>}
        <Textarea label={t("plan.reflectionLabel")} rows={5} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} hint={t("plan.reflectionHint")} placeholder={t("plan.reflectionPlaceholder")} />
      </Modal>
    </Card>
  );
}

export function DevelopmentPlanPage() {
  const { t } = useTranslation("learning");
  const { data: plan, isLoading, error, refetch } = usePlan();
  const [params, setParams] = useSearchParams();
  if (isLoading) return <PageSkeleton />;
  if (error || !plan) return <><PageHeader title={t("plan.title")} /><ErrorState error={error} onRetry={() => refetch()} /></>;

  if (!plan.recommendations.length) {
    return (
      <>
        <PageHeader title={t("plan.title")} />
        <EmptyState icon="route" title={t("plan.emptyTitle")} description={t("plan.emptyText")} action={<LinkButton to="/assessment">{t("plan.startAssessment")}</LinkButton>} />
      </>
    );
  }
  const focus = params.get("focus");
  const sel = plan.recommendations.find((r) => r.competency_code === focus) ?? plan.recommendations[0];

  return (
    <>
      <PageHeader title={t("plan.title")} subtitle={t("plan.subtitle")} />
      <Card padding={20} style={{ marginBottom: 24 }}>
        <ProgressBar label={t("plan.progress", { done: plan.done, count: plan.total })} value={plan.progress_pct} color="var(--color-growth-500)" />
      </Card>
      <div className="ik-plan">
        <nav aria-label={t("plan.prioritiesAria")} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {plan.recommendations.map((r) => (
            <button key={r.id} type="button" onClick={() => setParams({ focus: r.competency_code })} className="ik-plan-item" aria-current={r.id === sel.id || undefined}>
              <span style={{ fontSize: 12, color: "var(--color-neutral-500)", fontWeight: 500 }}>{t("plan.priority", { n: r.priority })}</span>
              <span style={{ marginTop: 4, display: "block", fontSize: 15, fontWeight: 600, color: "var(--color-neutral-900)" }}>{r.competency_name}</span>
              <span style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13, color: "var(--color-neutral-600)", fontVariantNumeric: "tabular-nums" }}><b style={{ color: "var(--color-neutral-900)" }}>{r.current}</b> → {r.target}</span>
                <GapBadge gap={gapLabel(r.band)} suffix={t("common:ds.prioritySuffix")} />
              </span>
              <span style={{ marginTop: 10, display: "block" }}><ProgressBar value={r.progress_pct} showValue={false} height={4} color="var(--color-growth-500)" ariaLabel={t("plan.percentComplete", { value: r.progress_pct })} /></span>
            </button>
          ))}
          {plan.completed.length > 0 && (
            <Card padding={16}>
              <p style={{ fontSize: 13, fontWeight: 600 }}>{t("plan.completedCycles")}</p>
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
