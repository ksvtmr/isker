import { Button, EmptyState, InlineAlert, SkeletonCard } from "@isker/design-system";
import { useTranslation } from "react-i18next";
import { errorMessage, isUpgradeRequired } from "../api/client";
import { LinkButton } from "./RouterLink";

/** Page-level loading skeleton (shimmer, never a blank screen). */
export function PageSkeleton({ cards = 3, chart = true }: { cards?: number; chart?: boolean }) {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="isk-sr-only">{t("state.loading")}</span>
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
export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const { t } = useTranslation();
  if (isUpgradeRequired(error)) {
    return <EmptyState icon="lock" title={t("state.notIncluded")} description={errorMessage(error)} action={<LinkButton to="/plans">{t("actions.seePlans")}</LinkButton>} />;
  }
  return (
    <EmptyState
      tone="error"
      icon="cloud-off"
      title={title ?? t("state.errorTitle")}
      description={errorMessage(error, t("state.errorLoad"))}
      action={onRetry && <Button variant="secondary" iconLeft="rotate-cw" onClick={onRetry}>{t("actions.tryAgain")}</Button>}
    />
  );
}

/** Inline error for a failed action. Plan limits show a "See plans" link. */
export function ApiErrorAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  if (isUpgradeRequired(error)) {
    return (
      <InlineAlert tone="warning" title={t("state.notIncluded")}>
        {errorMessage(error)}
        <span style={{ display: "block", marginTop: 8 }}><LinkButton to="/plans" size="sm" variant="secondary">{t("actions.seePlans")}</LinkButton></span>
      </InlineAlert>
    );
  }
  return <InlineAlert>{errorMessage(error)}</InlineAlert>;
}
