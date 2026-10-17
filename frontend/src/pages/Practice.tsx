import { Card, EmptyState, Icon, StatusBadge, Tabs, tabPanelProps } from "@isker/design-system";
import { PageHeader } from "../components/PageTitle";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTasks } from "../api/learning";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { difficultyLabel } from "../utils/format";

const STATUS = { started: ["progress", "common:progressStatus.in_progress"], submitted: ["progress", "learning:practice.feedbackReady"], completed: ["done", "common:progressStatus.completed"] } as const;

export function PracticePage() {
  const { t } = useTranslation("learning");
  const { data, isLoading, error, refetch } = useTasks();
  const [filter, setFilter] = useState("all");
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !data) return <><PageHeader title={t("common:nav.practice")} /><ErrorState error={error} onRetry={() => refetch()} /></>;
  const items = data.filter((task) => filter === "all" || (filter === "recommended" ? task.recommended : filter === "done" ? task.status === "completed" : task.status && task.status !== "completed"));
  return (
    <>
      <PageHeader title={t("common:nav.practice")} subtitle={t("practice.subtitle")} />
      <div style={{ marginBottom: 20, overflowX: "auto" }}>
        <Tabs id="practice-filter" ariaLabel={t("practice.filterAria")} value={filter} onChange={setFilter} tabs={[{ value: "all", label: t("practice.allTasks") }, { value: "recommended", label: t("practice.recommended") }, { value: "active", label: t("common:progressStatus.in_progress") }, { value: "done", label: t("common:progressStatus.completed") }]} />
      </div>
      <div {...tabPanelProps("practice-filter", filter)}>
      {items.length ? (
        <div className="ik-grid-cards">
          {items.map((task) => {
            const st = task.status ? STATUS[task.status] : null;
            const action = task.status ? t("common:actions.open") : t("common:actions.start");
            return (
              <Card key={task.id} padding={20} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 500, color: "var(--color-neutral-600)" }}>
                    <span style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--color-neutral-100)" }}><Icon name="pencil-ruler" size={15} /></span>{t("practice.practicalTask")}
                  </span>
                  {task.recommended && <StatusBadge status="recommended">{t("practice.recommended")}</StatusBadge>}
                </div>
                <h2 style={{ marginTop: 14, fontSize: 16, fontWeight: 600 }}>{task.title}</h2>
                <p style={{ marginTop: 6, fontSize: 13, fontWeight: 500, color: "var(--color-brand-600)" }}>{task.competency_name}</p>
                <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: "var(--color-neutral-600)" }}>{task.description}</p>
                <div style={{ marginTop: "auto", paddingTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--color-neutral-500)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {t("common:time.minutes", { count: task.duration_minutes })} · {difficultyLabel(task.difficulty)}
                    {st && <StatusBadge status={st[0]}>{t(st[1])}{task.feedback_score !== null ? ` · ${task.feedback_score}` : ""}</StatusBadge>}
                  </span>
                  <LinkButton to={`/practice/${task.id}`} size="sm" variant="secondary" aria-label={t("practice.actionAria", { action, title: task.title })}>{action}</LinkButton>
                </div>
              </Card>
            );
          })}
        </div>
      ) : <EmptyState icon="pencil-ruler" title={t("practice.emptyTitle")} description={t("practice.emptyText")} />}
      </div>
    </>
  );
}
