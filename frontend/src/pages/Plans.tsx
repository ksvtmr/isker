import { Badge, Card, Icon, InlineAlert, ProgressBar, SkeletonCard, Wordmark } from "@isker/design-system";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useMe } from "../api/auth";
import { useLiveSync } from "../api/sync";
import { featureLabel, formatPrice, FEATURE_LABELS, useMySubscription, usePlans } from "../api/billing";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { PageHeader } from "../components/PageTitle";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { AppShell } from "../layouts/AppShell";
import type { BillingPlan, Entitlement } from "../types/api";
import { formatDate } from "../utils/format";

/** The API counts limits over a rolling window; 30 days is its default when the window is not reported. */
const DEFAULT_WINDOW_DAYS = 30;

function featureText(t: TFunction, plan: BillingPlan, key: string, windowDays: number): string | null {
  const e = plan.entitlements.find((x) => x.feature_key === key);
  if (!e || !e.enabled) return null;
  if (e.limit_value !== null && e.limit_value !== undefined) {
    return t("features.limit", { label: featureLabel(key), count: e.limit_value, period: t("common:time.days", { count: windowDays }) });
  }
  if (key === "assessment.full") return t("features.unlimitedAssessments");
  if (key === "practice.tasks") return t("features.unlimitedTasks");
  return featureLabel(key);
}

/**
 * /plans is public: anonymous visitors see the plans with a "create account" call to action inside a public frame;
 * signed-in users see them inside the app shell together with their current plan and usage.
 */
export function PlansRoute() {
  const { data: user, isLoading } = useMe();
  useLiveSync(!!user);
  if (isLoading) return <div style={{ maxWidth: 960, margin: "10vh auto 0", padding: 16 }} aria-busy="true"><SkeletonCard lines={4} /></div>;
  if (user) return <AppShell><PlansPage /></AppShell>;
  return <PublicPlansFrame><PlansPage /></PublicPlansFrame>;
}

function PublicPlansFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation("subscriptions");
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-neutral-50)" }}>
      <header className="ik-landing-top">
        <Link to="/" aria-label={t("common:app.home")} style={{ textDecoration: "none" }}><Wordmark size={22} /></Link>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <LanguageSwitcher />
          <nav aria-label={t("public:landing.accountNav")} style={{ display: "flex", gap: 8 }}>
            <LinkButton to="/login" variant="ghost">{t("common:actions.signIn")}</LinkButton>
            <LinkButton to="/register">{t("public:landing.createAccount")}</LinkButton>
          </nav>
        </div>
      </header>
      <main id="main" style={{ maxWidth: 1200, margin: "0 auto", padding: "8px 16px 72px" }}>{children}</main>
    </div>
  );
}

/** Plans and, for signed-in users, the current plan with usage. */
export function PlansPage() {
  const { t } = useTranslation("subscriptions");
  const plans = usePlans();
  const { data: me } = useMe();
  const mine = useMySubscription(!!me);
  if (plans.isLoading) return <PageSkeleton cards={3} chart={false} />;
  if (plans.error || !plans.data) return <ErrorState error={plans.error} onRetry={() => plans.refetch()} />;
  const currentKey = mine.data?.plan.key;
  const windowFor = (key: string) =>
    mine.data?.entitlements.find((e: Entitlement) => e.key === key)?.window_days ?? DEFAULT_WINDOW_DAYS;
  const defaultPlan = plans.data.find((p) => p.is_default);
  return (
    <>
      <PageHeader title={t("plans.title")}
        subtitle={defaultPlan ? t("plans.subtitle", { name: defaultPlan.name }) : t("plans.subtitleGeneric")}
        action={!me ? <LinkButton to="/register" iconRight="arrow-right">{t("plans.createAccountCta")}</LinkButton> : undefined} />
      {mine.data && (
        <Card padding={24} style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{t("plans.yourPlan", { name: mine.data.plan.name })}</h2>
            {mine.data.subscription?.expires_at && (
              <span style={{ fontSize: 14, color: "var(--color-neutral-600)" }}>
                {mine.data.subscription.cancel_at_period_end
                  ? t("plans.ends", { date: formatDate(mine.data.subscription.expires_at) })
                  : t("plans.validUntil", { date: formatDate(mine.data.subscription.expires_at) })}
              </span>
            )}
          </div>
          <div className="ik-grid2" style={{ marginTop: 16 }}>
            {mine.data.entitlements.filter((e) => e.kind === "limit" && e.enabled).map((e) => (
              <div key={e.key}>
                {e.limit === null ? (
                  <p style={{ fontSize: 14 }}><b style={{ fontWeight: 500 }}>{featureLabel(e.key)}:</b> {t("plans.unlimited")}</p>
                ) : (
                  <ProgressBar
                    value={e.used ?? 0}
                    max={e.limit}
                    label={e.window_days ? t("plans.usageLabel", { label: featureLabel(e.key), count: e.window_days }) : featureLabel(e.key)}
                    ariaLabel={t("plans.usageAria", { label: featureLabel(e.key), used: e.used ?? 0, limit: e.limit })}
                  />
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="ik-grid3">
        {plans.data.map((p) => (
          <Card key={p.id} padding={24} style={p.key === currentKey ? { borderColor: "var(--color-brand-600)", boxShadow: "0 0 0 1px var(--color-brand-600)" } : undefined}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{p.name}</h2>
              {p.key === currentKey && <Badge tone="brand" icon="check">{t("plans.currentPlan")}</Badge>}
            </div>
            <p style={{ marginTop: 8, fontSize: 24, fontWeight: 600 }}>{formatPrice(p)}</p>
            {p.trial_days > 0 && <p style={{ marginTop: 4, fontSize: 13, color: "var(--color-neutral-600)" }}>{t("plans.trial", { count: p.trial_days })}</p>}
            {p.description && <p style={{ marginTop: 8, fontSize: 14, color: "var(--color-neutral-600)" }}>{p.description}</p>}
            <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.keys(FEATURE_LABELS).map((k) => {
                const text = featureText(t, p, k, windowFor(k));
                return (
                  <li key={k} style={{ display: "flex", gap: 8, fontSize: 14, color: text ? "var(--color-neutral-800)" : "var(--color-neutral-500)" }}>
                    <Icon name={text ? "check" : "x"} size={16} color={text ? "var(--color-growth-700)" : "var(--color-neutral-500)"} />
                    <span>{text ?? <><span className="isk-sr-only">{t("plans.notIncluded")} </span>{featureLabel(k)}</>}</span>
                  </li>
                );
              })}
            </ul>
            {!me && p.is_default && (
              <div style={{ marginTop: 20 }}><LinkButton to="/register" variant="secondary">{t("plans.startFree")}</LinkButton></div>
            )}
          </Card>
        ))}
      </div>
      <div style={{ marginTop: 24 }}>
        <InlineAlert tone="info" title={t("upgrade.title")}>
          {t("upgrade.text")}
          {!me && <span style={{ display: "block", marginTop: 8 }}><LinkButton to="/register" size="sm">{t("plans.createAccountCta")}</LinkButton></span>}
        </InlineAlert>
      </div>
    </>
  );
}
