import { Button, Card, EmptyState, Icon, Prose, ProgressBar, StatusBadge } from "@isker/design-system";
import { PageHeader } from "../components/PageTitle";
import { ExternalLink } from "../components/ExternalLink";
import { useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useCompleteResource, useResource, useResourceProgress, useStartResource } from "../api/learning";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton, ApiErrorAlert } from "../components/States";
import { useToast } from "../components/Toaster";
import { difficultyLabel, formatDate, resourceTypeLabel } from "../utils/format";

export function LearningDetailPage() {
  const { t } = useTranslation("learning");
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
    if (error instanceof ApiError && error.status === 404) return <EmptyState icon="search-x" title={t("learningDetail.notFound")} action={<LinkButton to="/learning">{t("learningDetail.allResources")}</LinkButton>} />;
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  const started = r.status !== "not_started";
  return (
    <>
      <PageHeader back={{ label: t("common:nav.learning"), href: "/learning", onClick: () => navigate("/learning") }}
        eyebrow={`${resourceTypeLabel(r.type)} · ${t("common:time.minutes", { count: r.duration_minutes })} · ${difficultyLabel(r.difficulty)}`} title={r.title} subtitle={r.description} />
      <div className="ik-grid3" style={{ alignItems: "start" }}>
        <Card padding={32} className="ik-span2">
          {!started ? (
            <div>
              <p style={{ fontSize: 15, color: "var(--color-neutral-700)" }}><Trans t={t} i18nKey="learningDetail.startIntro" values={{ competency: r.competency_name }} components={{ b: <b /> }} /></p>
              {start.error && <div style={{ marginTop: 12 }}><ApiErrorAlert error={start.error} /></div>}
              <div style={{ marginTop: 20 }}><Button size="lg" iconLeft="book-open" loading={start.isPending} onClick={() => start.mutate(r.id)}>{t("learningDetail.startButton")}</Button></div>
            </div>
          ) : (
            <article aria-label={r.title}>
              <Prose source={r.content} />
              {r.url && <p style={{ marginTop: 16 }}><ExternalLink href={r.url}>{t("learningDetail.openExternal")}</ExternalLink></p>}
              <div ref={endRef} />
            </article>
          )}
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card padding={20}>
            <p style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>{t("learningDetail.competency")}</p>
            <LinkButton to={`/competencies/${r.competency_code}`} variant="ghost" size="sm" style={{ paddingLeft: 0 }}>{r.competency_name}</LinkButton>
            <div style={{ marginTop: 12 }}>
              {r.status === "completed" ? <StatusBadge status="done">{t("learningDetail.completedOn", { date: formatDate(r.completed_at) })}</StatusBadge>
                : r.status === "in_progress" ? <ProgressBar label={t("common:ds.progress")} value={r.progress_pct} /> : <StatusBadge status="todo">{t("common:progressStatus.not_started")}</StatusBadge>}
            </div>
            {r.status === "in_progress" && (
              <div style={{ marginTop: 16 }}>
                {complete.error && <div style={{ marginBottom: 12 }}><ApiErrorAlert error={complete.error} /></div>}
                <Button variant="success" iconLeft="check" fullWidth loading={complete.isPending}
                  onClick={() => complete.mutate(r.id, { onSuccess: () => toast({ title: t("learningDetail.markedTitle"), description: t("learningDetail.markedText") }) })}>
                  {t("learningDetail.markComplete")}
                </Button>
              </div>
            )}
            {r.status === "completed" && <div style={{ marginTop: 16 }}><LinkButton to="/development-plan" fullWidth variant="secondary" iconRight="arrow-right">{t("learningDetail.backToPlan")}</LinkButton></div>}
          </Card>
          {r.reason && (
            <Card padding={20}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Icon name="sparkles" size={16} color="var(--color-brand-600)" /><span style={{ fontSize: 13, fontWeight: 600 }}>{t("learningDetail.whyRecommended")}</span></div>
              <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: "var(--color-neutral-600)" }}>{r.reason}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
