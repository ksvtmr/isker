import { Button, EmptyState, SkeletonCard } from "@isker/design-system";
import { errorMessage } from "../api/client";

/** Page-level loading skeleton (shimmer, never a blank screen). */
export function PageSkeleton({ cards = 3, chart = true }: { cards?: number; chart?: boolean }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="isk-sr-only">Loading…</span>
      <div style={{ height: 28, width: 260, marginBottom: 28 }} className="isk-skel" />
      <div className="ik-grid3" style={{ marginBottom: 24 }}>
        <div className="ik-span2"><SkeletonCard chart={chart} /></div>
        <SkeletonCard lines={4} />
      </div>
      <div className="ik-grid3">{Array.from({ length: cards }, (_, i) => <SkeletonCard key={i} lines={4} />)}</div>
    </div>
  );
}

/** Friendly error with retry. */
export function ErrorState({ error, onRetry, title = "Something went wrong" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <EmptyState
      tone="error"
      icon="cloud-off"
      title={title}
      description={errorMessage(error, "We couldn't load this page. Please try again.")}
      action={onRetry && <Button variant="secondary" iconLeft="rotate-cw" onClick={onRetry}>Try again</Button>}
    />
  );
}
