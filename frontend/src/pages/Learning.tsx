import { Button, Card, EmptyState, Icon, Input, PageHeader, ProgressBar, Select, StatusBadge } from "@isker/design-system";
import { useState } from "react";
import { useCatalog } from "../api/competencies";
import { useResources, type ResourceFilters } from "../api/learning";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import type { Resource } from "../types/api";
import { DIFFICULTY_LABEL, RESOURCE_TYPE_ICON, RESOURCE_TYPE_LABEL } from "../utils/format";

const EMPTY: ResourceFilters = { competency: "", type: "", difficulty: "", max_minutes: "", q: "", status: "", page: 1 };

function ResourceCard({ r }: { r: Resource }) {
  const action = r.status === "completed" ? "Review" : r.status === "in_progress" ? "Continue" : "Open";
  return (
    <Card padding={20} style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 500, color: "var(--color-neutral-600)" }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--color-neutral-100)" }}><Icon name={RESOURCE_TYPE_ICON[r.type]} size={15} /></span>
          {RESOURCE_TYPE_LABEL[r.type]}
        </span>
        {r.recommended && <StatusBadge status="recommended">Recommended</StatusBadge>}
      </div>
      <h2 style={{ marginTop: 14, fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}>{r.title}</h2>
      <p style={{ marginTop: 6, fontSize: 13, fontWeight: 500, color: "var(--color-brand-600)" }}>{r.competency_name}</p>
      <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: "var(--color-neutral-600)" }}>{r.description}</p>
      {r.status === "in_progress" && <div style={{ marginTop: 12 }}><ProgressBar value={r.progress_pct} showValue={false} height={4} ariaLabel={`${r.progress_pct}% read`} /></div>}
      <div style={{ marginTop: "auto", paddingTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--color-neutral-500)", display: "flex", gap: 8, alignItems: "center" }}>
          {r.duration_minutes} min · {DIFFICULTY_LABEL[r.difficulty]}
          {r.status === "completed" && <StatusBadge status="done">Completed</StatusBadge>}
        </span>
        <LinkButton to={`/learning/${r.id}`} size="sm" variant={r.status === "completed" ? "ghost" : "secondary"} aria-label={`${action}: ${r.title}`}>{action}</LinkButton>
      </div>
    </Card>
  );
}

export function LearningPage() {
  const [f, setF] = useState<ResourceFilters>(EMPTY);
  const catalog = useCatalog();
  const { data, isLoading, error, refetch, isFetching } = useResources(f);
  const set = (k: keyof ResourceFilters) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value, page: 1 });
  const active = Object.entries(f).some(([k, v]) => k !== "page" && v);

  return (
    <>
      <PageHeader title="Learning" subtitle="Short lessons, videos, courses and templates mapped to EntreComp competencies. Recommended items come from your plan." />
      <div className="ik-filters" role="search">
        <Input aria-label="Search resources" placeholder="Search resources" value={f.q} onChange={set("q")} />
        <Select aria-label="Competency" placeholder="All competencies" value={f.competency} onChange={set("competency")} options={(catalog.data?.competencies ?? []).map((c) => ({ value: c.code, label: c.name }))} />
        <Select aria-label="Type" placeholder="Any type" value={f.type} onChange={set("type")} options={Object.entries(RESOURCE_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select aria-label="Difficulty" placeholder="Any difficulty" value={f.difficulty} onChange={set("difficulty")} options={Object.entries(DIFFICULTY_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select aria-label="Duration" placeholder="Any duration" value={String(f.max_minutes)} onChange={set("max_minutes")} options={[{ value: "15", label: "Up to 15 min" }, { value: "30", label: "Up to 30 min" }, { value: "60", label: "Up to 60 min" }]} />
        <Select aria-label="Status" placeholder="Any status" value={f.status} onChange={set("status")} options={[{ value: "not_started", label: "Not started" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "Completed" }]} />
      </div>
      {isLoading ? <div style={{ marginTop: 16 }}><PageSkeleton cards={3} chart={false} /></div>
        : error || !data ? <div style={{ marginTop: 16 }}><ErrorState error={error} onRetry={() => refetch()} /></div>
        : (
          <>
            <p style={{ margin: "16px 0", fontSize: 13, color: "var(--color-neutral-500)" }} aria-live="polite">{isFetching ? "Updating…" : `${data.total} resources`}</p>
            {data.items.length ? (
              <div className="ik-grid-cards">{data.items.map((r) => <ResourceCard key={r.id} r={r} />)}</div>
            ) : (
              <EmptyState icon="search-x" title="No resources match these filters" description="Try removing a filter or searching for a different topic."
                action={active && <Button variant="secondary" onClick={() => setF(EMPTY)}>Clear filters</Button>} />
            )}
            {data.total > data.page_size && (
              <div style={{ marginTop: 24, display: "flex", justifyContent: "center", gap: 8 }}>
                <Button variant="secondary" size="sm" disabled={data.page <= 1} onClick={() => setF({ ...f, page: data.page - 1 })}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={data.page * data.page_size >= data.total} onClick={() => setF({ ...f, page: data.page + 1 })}>Next</Button>
              </div>
            )}
          </>
        )}
    </>
  );
}
