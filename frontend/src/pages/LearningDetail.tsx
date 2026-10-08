import { Button, Card, EmptyState, Icon, InlineAlert, PageHeader, Prose, ProgressBar, StatusBadge } from "@isker/design-system";
import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, errorMessage } from "../api/client";
import { useCompleteResource, useResource, useResourceProgress, useStartResource } from "../api/learning";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { useToast } from "../components/Toaster";
import { DIFFICULTY_LABEL, RESOURCE_TYPE_LABEL, formatDate } from "../utils/format";

export function LearningDetailPage() {
  const id = Number(useParams().id);
  const { data: r, isLoading, error, refetch } = useResource(id);
  const start = useStartResource();
  const complete = useCompleteResource();
  const progress = useResourceProgress();
  const navigate = useNavigate();
  const toast = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const reported = useRef(false);

  // Reaching the end of the content records reading progress (the user still marks it complete).
  useEffect(() => {
    const el = endRef.current;
    if (!r || r.status !== "in_progress" || !el || typeof IntersectionObserver === "undefined") return;
    const ob = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !reported.current && r.progress_pct < 90) {
        reported.current = true;
        progress.mutate({ id: r.id, pct: 90 });
      }
    });
    ob.observe(el);
    return () => ob.disconnect();
  }, [r, progress]);

  if (isLoading) return <PageSkeleton cards={0} />;
  if (error || !r) {
    if (error instanceof ApiError && error.status === 404) return <EmptyState icon="search-x" title="Resource not found" action={<LinkButton to="/learning">All resources</LinkButton>} />;
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  const started = r.status !== "not_started";
  return (
    <>
      <PageHeader back={{ label: "Learning", href: "/learning", onClick: () => navigate("/learning") }}
        eyebrow={`${RESOURCE_TYPE_LABEL[r.type]} · ${r.duration_minutes} min · ${DIFFICULTY_LABEL[r.difficulty]}`} title={r.title} subtitle={r.description} />
      <div className="ik-grid3" style={{ alignItems: "start" }}>
        <Card padding={32} className="ik-span2">
          {!started ? (
            <div>
              <p style={{ fontSize: 15, color: "var(--color-neutral-700)" }}>Start this {RESOURCE_TYPE_LABEL[r.type].toLowerCase()} to track your progress. It counts towards your plan for <b>{r.competency_name}</b>.</p>
              {start.error && <div style={{ marginTop: 12 }}><InlineAlert>{errorMessage(start.error)}</InlineAlert></div>}
              <div style={{ marginTop: 20 }}><Button size="lg" iconLeft="book-open" loading={start.isPending} onClick={() => start.mutate(r.id)}>Start {RESOURCE_TYPE_LABEL[r.type]}</Button></div>
            </div>
          ) : (
            <article aria-label={r.title}>
              <Prose source={r.content} />
              {r.url && <p style={{ marginTop: 16 }}><a href={r.url} target="_blank" rel="noreferrer">Open the external material <Icon name="external-link" size={14} /></a></p>}
              <div ref={endRef} />
            </article>
          )}
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card padding={20}>
            <p style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>Competency</p>
            <LinkButton to={`/competencies/${r.competency_code}`} variant="ghost" size="sm" style={{ paddingLeft: 0 }}>{r.competency_name}</LinkButton>
            <div style={{ marginTop: 12 }}>
              {r.status === "completed" ? <StatusBadge status="done">Completed {formatDate(r.completed_at)}</StatusBadge>
                : r.status === "in_progress" ? <ProgressBar label="Progress" value={r.progress_pct} /> : <StatusBadge status="todo">Not started</StatusBadge>}
            </div>
            {r.status === "in_progress" && (
              <div style={{ marginTop: 16 }}>
                {complete.error && <div style={{ marginBottom: 12 }}><InlineAlert>{errorMessage(complete.error)}</InlineAlert></div>}
                <Button variant="success" iconLeft="check" fullWidth loading={complete.isPending}
                  onClick={() => complete.mutate(r.id, { onSuccess: () => toast({ title: "Marked as complete", description: "Added to your progress and plan." }) })}>
                  Mark as complete
                </Button>
              </div>
            )}
            {r.status === "completed" && <div style={{ marginTop: 16 }}><LinkButton to="/development-plan" fullWidth variant="secondary" iconRight="arrow-right">Back to plan</LinkButton></div>}
          </Card>
          {r.reason && (
            <Card padding={20}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Icon name="sparkles" size={16} color="var(--color-brand-600)" /><span style={{ fontSize: 13, fontWeight: 600 }}>Why it's recommended</span></div>
              <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: "var(--color-neutral-600)" }}>{r.reason}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
