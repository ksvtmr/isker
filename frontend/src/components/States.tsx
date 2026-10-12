import { Button, EmptyState, InlineAlert, SkeletonCard } from "@isker/design-system";
import { errorMessage, isUpgradeRequired } from "../api/client";
import { LinkButton } from "./RouterLink";

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

/** Friendly error with retry. Plan limits (UPGRADE_REQUIRED) get a link to the plans page instead of a retry. */
export function ErrorState({ error, onRetry, title = "Something went wrong" }: { error: unknown; onRetry?: () => void; title?: string }) {
  if (isUpgradeRequired(error)) {
    return <EmptyState icon="lock" title="Not included in your plan" description={errorMessage(error)} action={<LinkButton to="/plans">See plans</LinkButton>} />;
  }
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

/** Inline error for a failed action. Plan limits show a "See plans" link. */
export function ApiErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  if (isUpgradeRequired(error)) {
    return (
      <InlineAlert tone="warning" title="Not included in your plan">
        {errorMessage(error)}
        <span style={{ display: "block", marginTop: 8 }}><LinkButton to="/plans" size="sm" variant="secondary">See plans</LinkButton></span>
      </InlineAlert>
    );
  }
  return <InlineAlert>{errorMessage(error)}</InlineAlert>;
}
