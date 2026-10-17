import { Button, Card, EmptyState, Icon, Input, ProgressBar, Select, StatusBadge } from "@isker/design-system";
import { PageHeader } from "../components/PageTitle";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCatalog } from "../api/competencies";
import { useResources, type ResourceFilters } from "../api/learning";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import type { Difficulty, ProgressStatus, Resource, ResourceType } from "../types/api";
import { RESOURCE_TYPE_ICON, difficultyLabel, resourceTypeLabel } from "../utils/format";

const EMPTY: ResourceFilters = { competency: "", type: "", difficulty: "", max_minutes: "", q: "", status: "", page: 1 };
const TYPES: ResourceType[] = ["article", "video", "course", "exercise", "case_study", "template"];
const DIFFICULTIES: Difficulty[] = ["beginner", "intermediate", "advanced"];
const STATUSES: ProgressStatus[] = ["not_started", "in_progress", "completed"];
const DURATIONS = [15, 30, 60];

function ResourceCard({ r }: { r: Resource }) {
  const { t } = useTranslation("learning");
  const action = r.status === "completed" ? t("learning.review") : r.status === "in_progress" ? t("common:actions.continue") : t("common:actions.open");
  return (
    <Card padding={20} style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 500, color: "var(--color-neutral-600)" }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--color-neutral-100)" }}><Icon name={RESOURCE_TYPE_ICON[r.type]} size={15} /></span>
          {resourceTypeLabel(r.type)}
        </span>
        {r.locked ? <StatusBadge status="locked">{t("learning.pro")}</StatusBadge> : r.recommended && <StatusBadge status="recommended">{t("learning.recommended")}</StatusBadge>}
      </div>
      <h2 style={{ marginTop: 14, fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}>{r.title}</h2>
      <p style={{ marginTop: 6, fontSize: 13, fontWeight: 500, color: "var(--color-brand-600)" }}>{r.competency_name}</p>
      <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: "var(--color-neutral-600)" }}>{r.description}</p>
      {r.status === "in_progress" && <div style={{ marginTop: 12 }}><ProgressBar value={r.progress_pct} showValue={false} height={4} ariaLabel={t("learning.percentRead", { value: r.progress_pct })} /></div>}
      <div style={{ marginTop: "auto", paddingTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--color-neutral-500)", display: "flex", gap: 8, alignItems: "center" }}>
          {t("common:time.minutes", { count: r.duration_minutes })} · {difficultyLabel(r.difficulty)}
          {r.status === "completed" && <StatusBadge status="done">{t("common:progressStatus.completed")}</StatusBadge>}
        </span>
        {r.locked
          ? <LinkButton to="/plans" size="sm" variant="ghost" aria-label={t("learning.lockedAria", { title: r.title })}>{t("common:actions.seePlans")}</LinkButton>
          : <LinkButton to={`/learning/${r.id}`} size="sm" variant={r.status === "completed" ? "ghost" : "secondary"} aria-label={t("learning.actionAria", { action, title: r.title })}>{action}</LinkButton>}
      </div>
    </Card>
  );
}

export function LearningPage() {
  const { t } = useTranslation("learning");
  // Filters live in the URL: they survive refresh and navigation, and links can open a filtered list.
  const [params, setParams] = useSearchParams();
  const f: ResourceFilters = {
    ...EMPTY,
    ...Object.fromEntries([...params.entries()].filter(([k]) => k in EMPTY && k !== "page")),
    page: Math.max(1, Number(params.get("page")) || 1),
  };
  const setF = (next: ResourceFilters) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v !== "" && v != null && !(k === "page" && v === 1)) q.set(k, String(v));
    setParams(q, { replace: true });
  };
  const catalog = useCatalog();
  const { data, isLoading, error, refetch, isFetching } = useResources(f);
  const set = (k: keyof ResourceFilters) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value, page: 1 });
  const active = Object.entries(f).some(([k, v]) => k !== "page" && v);

  return (
    <>
      <PageHeader title={t("common:nav.learning")} subtitle={t("learning.subtitle")} />
      <div className="ik-filters" role="search">
        <Input aria-label={t("learning.searchPlaceholder")} placeholder={t("learning.searchPlaceholder")} value={f.q} onChange={set("q")} />
        <Select aria-label={t("learning.competency")} placeholder={t("learning.allCompetencies")} value={f.competency} onChange={set("competency")} options={(catalog.data?.competencies ?? []).map((c) => ({ value: c.code, label: c.name }))} />
        <Select aria-label={t("learning.type")} placeholder={t("learning.anyType")} value={f.type} onChange={set("type")} options={TYPES.map((value) => ({ value, label: resourceTypeLabel(value) }))} />
        <Select aria-label={t("learning.difficulty")} placeholder={t("learning.anyDifficulty")} value={f.difficulty} onChange={set("difficulty")} options={DIFFICULTIES.map((value) => ({ value, label: difficultyLabel(value) }))} />
        <Select aria-label={t("learning.duration")} placeholder={t("learning.anyDuration")} value={String(f.max_minutes)} onChange={set("max_minutes")} options={DURATIONS.map((n) => ({ value: String(n), label: t("learning.upTo", { count: n }) }))} />
        <Select aria-label={t("learning.status")} placeholder={t("learning.anyStatus")} value={f.status} onChange={set("status")} options={STATUSES.map((value) => ({ value, label: t(`common:progressStatus.${value}`) }))} />
      </div>
      {isLoading ? <div style={{ marginTop: 16 }}><PageSkeleton cards={3} chart={false} /></div>
        : error || !data ? <div style={{ marginTop: 16 }}><ErrorState error={error} onRetry={() => refetch()} /></div>
        : (
          <>
            <p style={{ margin: "16px 0", fontSize: 13, color: "var(--color-neutral-500)" }} aria-live="polite">{isFetching ? t("learning.updating") : t("learning.total", { count: data.total })}</p>
            {data.items.length ? (
              <div className="ik-grid-cards">{data.items.map((r) => <ResourceCard key={r.id} r={r} />)}</div>
            ) : (
              <EmptyState icon="search-x" title={t("learning.emptyTitle")} description={t("learning.emptyText")}
                action={active && <Button variant="secondary" onClick={() => setF(EMPTY)}>{t("common:actions.clearFilters")}</Button>} />
            )}
            {data.total > data.page_size && (
              <div style={{ marginTop: 24, display: "flex", justifyContent: "center", gap: 8 }}>
                <Button variant="secondary" size="sm" disabled={data.page <= 1} onClick={() => setF({ ...f, page: data.page - 1 })}>{t("common:ds.previous")}</Button>
                <Button variant="secondary" size="sm" disabled={data.page * data.page_size >= data.total} onClick={() => setF({ ...f, page: data.page + 1 })}>{t("common:actions.next")}</Button>
              </div>
            )}
          </>
        )}
    </>
  );
}
