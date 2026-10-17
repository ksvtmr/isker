import { useQuery } from "@tanstack/react-query";
import type { Entitlement, MySubscription, BillingPlan } from "../types/api";
import i18n from "../i18n";
import { formatCurrency } from "../utils/format";
import { api } from "./client";
import { keys } from "./keys";

export const billingApi = {
  plans: () => api.get<BillingPlan[]>("/api/plans"),
  entitlements: () => api.get<Entitlement[]>("/api/entitlements/me"),
  mySubscription: () => api.get<MySubscription>("/api/subscription/me"),
};

export const usePlans = () => useQuery({ queryKey: keys.plans, queryFn: billingApi.plans, staleTime: 5 * 60_000 });
/** Plan, limits and usage. Refreshed on focus and every minute: an administrator may change the plan at any time. */
export const useMySubscription = (enabled = true) =>
  useQuery({ queryKey: keys.subscription, queryFn: billingApi.mySubscription, enabled, refetchOnWindowFocus: "always", refetchInterval: enabled ? 60_000 : false });
export const useEntitlements = (enabled = true) =>
  useQuery({ queryKey: keys.entitlements, queryFn: billingApi.entitlements, enabled, refetchOnWindowFocus: "always", refetchInterval: enabled ? 60_000 : false });

/** Downloads the user's data export (a JSON file). The API checks the export.data entitlement. */
export async function downloadExport(): Promise<void> {
  const data = await api.get<unknown>("/api/export/me");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `isker-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Localized price: "Free", "4 990 ₸ / мес", "$9.00 / month"… (Intl currency in the interface language). */
export function formatPrice(plan: Pick<BillingPlan, "price_cents" | "currency" | "billing_interval">): string {
  if (plan.price_cents === 0) return i18n.t("subscriptions:price.free");
  const amount = formatCurrency(plan.price_cents, plan.currency);
  if (plan.billing_interval === "month") return i18n.t("subscriptions:price.perMonth", { amount });
  if (plan.billing_interval === "year") return i18n.t("subscriptions:price.perYear", { amount });
  return amount;
}

/** Feature key (API value, never translated) -> translation key of its display label. */
const FEATURE_LABEL_KEYS: Record<string, string> = {
  "assessment.full": "subscriptions:features.assessmentFull",
  "assessment.reassessment": "subscriptions:features.assessmentReassessment",
  "plan.personalized": "subscriptions:features.planPersonalized",
  "learning.advanced_resources": "subscriptions:features.learningAdvancedResources",
  "practice.tasks": "subscriptions:features.practiceTasks",
  "practice.ai_feedback": "subscriptions:features.practiceAiFeedback",
  "progress.history": "subscriptions:features.progressHistory",
  "export.data": "subscriptions:features.exportData",
};

/** Display label of a feature in the current interface language (unknown keys are shown as they are). */
export function featureLabel(key: string): string {
  const k = FEATURE_LABEL_KEYS[key];
  return k ? i18n.t(k) : key;
}

/** Feature labels keyed by feature key. Values are getters, so they are read in the current language. */
export const FEATURE_LABELS: Record<string, string> = Object.defineProperties(
  {},
  Object.fromEntries(Object.keys(FEATURE_LABEL_KEYS).map((k) => [k, { enumerable: true, get: () => featureLabel(k) }])),
);
