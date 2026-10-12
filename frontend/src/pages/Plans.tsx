import { Badge, Card, Icon, InlineAlert, PageHeader, ProgressBar } from "@isker/design-system";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useMe } from "../api/auth";
import { featureLabel, formatPrice, FEATURE_LABELS, useMySubscription, usePlans } from "../api/billing";
import { ErrorState, PageSkeleton } from "../components/States";
import type { BillingPlan } from "../types/api";
import { formatDate } from "../utils/format";

function featureText(t: TFunction, plan: BillingPlan, key: string): string | null {
  const e = plan.entitlements.find((x) => x.feature_key === key);
  if (!e || !e.enabled) return null;
  if (e.limit_value !== null && e.limit_value !== undefined) return t("features.limit", { label: featureLabel(key), count: e.limit_value });
  if (key === "assessment.full") return t("features.unlimitedAssessments");
  if (key === "practice.tasks") return t("features.unlimitedTasks");
  return featureLabel(key);
}

/** Plans and, for signed-in users, the current plan with usage. Works inside the app shell and standalone. */
export function PlansPage() {
  const { t } = useTranslation("subscriptions");
  const plans = usePlans();
  const { data: me } = useMe();
  const mine = useMySubscription(!!me);
  if (plans.isLoading) return <PageSkeleton cards={3} chart={false} />;
  if (plans.error || !plans.data) return <ErrorState error={plans.error} onRetry={() => plans.refetch()} />;
  const currentKey = mine.data?.plan.key;
  return (
    <>
      <PageHeader title={t("plans.title")} subtitle={t("plans.subtitle")} />
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
                  <p style={{ fontSize: 14 }}><b style={{ fontWeight: 500 }}>{e.label}:</b> {t("plans.unlimited")}</p>
                ) : (
                  <ProgressBar
                    value={e.used ?? 0}
                    max={e.limit}
                    label={e.window_days ? t("plans.usageLabel", { label: e.label, count: e.window_days }) : e.label}
                    ariaLabel={t("plans.usageAria", { label: e.label, used: e.used ?? 0, limit: e.limit })}
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
            {p.description && <p style={{ marginTop: 8, fontSize: 14, color: "var(--color-neutral-600)" }}>{p.description}</p>}
            <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.keys(FEATURE_LABELS).map((k) => {
                const text = featureText(t, p, k);
                return (
                  <li key={k} style={{ display: "flex", gap: 8, fontSize: 14, color: text ? "var(--color-neutral-800)" : "var(--color-neutral-500)" }}>
                    <Icon name={text ? "check" : "x"} size={16} color={text ? "var(--color-growth-700)" : "var(--color-neutral-500)"} />
                    <span>{text ?? <><span className="isk-sr-only">{t("plans.notIncluded")} </span>{featureLabel(k)}</>}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
      <div style={{ marginTop: 24 }}>
        <InlineAlert tone="info" title={t("upgrade.title")}>
          {t("upgrade.text")}{" "}
          {!me && <Trans t={t} i18nKey="upgrade.createAccount" components={{ registerLink: <Link to="/register" /> }} />}
        </InlineAlert>
      </div>
    </>
  );
}
