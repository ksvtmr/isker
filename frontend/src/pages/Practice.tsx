import { Card, EmptyState, Icon, PageHeader, StatusBadge, Tabs } from "@isker/design-system";
import { useState } from "react";
import { useTasks } from "../api/learning";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { DIFFICULTY_LABEL } from "../utils/format";

const STATUS = { started: ["progress", "In progress"], submitted: ["progress", "Feedback ready"], completed: ["done", "Completed"] } as const;

export function PracticePage() {
  const { data, isLoading, error, refetch } = useTasks();
  const [filter, setFilter] = useState("all");
  if (isLoading) return <PageSkeleton chart={false} />;
  if (error || !data) return <><PageHeader title="Practice" /><ErrorState error={error} onRetry={() => refetch()} /></>;
  const items = data.filter((t) => filter === "all" || (filter === "recommended" ? t.recommended : filter === "done" ? t.status === "completed" : t.status && t.status !== "completed"));
  return (
    <>
      <PageHeader title="Practice" subtitle="Practical entrepreneurship tasks. Submit a response to get rubric-based feedback linked to a competency." />
      <div style={{ marginBottom: 20, overflowX: "auto" }}>
        <Tabs ariaLabel="Filter tasks" value={filter} onChange={setFilter} tabs={[{ value: "all", label: "All tasks" }, { value: "recommended", label: "Recommended" }, { value: "active", label: "In progress" }, { value: "done", label: "Completed" }]} />
      </div>
      {items.length ? (
        <div className="ik-grid-cards">
          {items.map((t) => {
            const st = t.status ? STATUS[t.status] : null;
            return (
              <Card key={t.id} padding={20} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 500, color: "var(--color-neutral-600)" }}>
                    <span style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--color-neutral-100)" }}><Icon name="pencil-ruler" size={15} /></span>Practical task
                  </span>
                  {t.recommended && <StatusBadge status="recommended">Recommended</StatusBadge>}
                </div>
                <h2 style={{ marginTop: 14, fontSize: 16, fontWeight: 600 }}>{t.title}</h2>
                <p style={{ marginTop: 6, fontSize: 13, fontWeight: 500, color: "var(--color-brand-600)" }}>{t.competency_name}</p>
                <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: "var(--color-neutral-600)" }}>{t.description}</p>
                <div style={{ marginTop: "auto", paddingTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--color-neutral-500)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {t.duration_minutes} min · {DIFFICULTY_LABEL[t.difficulty]}
                    {st && <StatusBadge status={st[0]}>{st[1]}{t.feedback_score !== null ? ` · ${t.feedback_score}` : ""}</StatusBadge>}
                  </span>
                  <LinkButton to={`/practice/${t.id}`} size="sm" variant="secondary" aria-label={`Open task: ${t.title}`}>{t.status ? "Open" : "Start"}</LinkButton>
                </div>
              </Card>
            );
          })}
        </div>
      ) : <EmptyState icon="pencil-ruler" title="No tasks here yet" description="Tasks appear here as you start them or when your plan recommends them." />}
    </>
  );
}
