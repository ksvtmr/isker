import { useQuery } from "@tanstack/react-query";
import type { Entitlement, MySubscription, BillingPlan } from "../types/api";
import { api } from "./client";

export const billingApi = {
  plans: () => api.get<BillingPlan[]>("/api/plans"),
  entitlements: () => api.get<Entitlement[]>("/api/entitlements/me"),
  mySubscription: () => api.get<MySubscription>("/api/subscription/me"),
};

export const usePlans = () => useQuery({ queryKey: ["plans"], queryFn: billingApi.plans, staleTime: 5 * 60_000 });
export const useMySubscription = (enabled = true) =>
  useQuery({ queryKey: ["subscription"], queryFn: billingApi.mySubscription, enabled });

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

export function formatPrice(plan: Pick<BillingPlan, "price_cents" | "currency" | "billing_interval">): string {
  if (plan.price_cents === 0) return "Free";
  const amount = new Intl.NumberFormat("en", { style: "currency", currency: plan.currency }).format(plan.price_cents / 100);
  return plan.billing_interval === "none" ? amount : `${amount} / ${plan.billing_interval}`;
}

export const FEATURE_LABELS: Record<string, string> = {
  "assessment.full": "Full assessments",
  "assessment.reassessment": "Competency reassessment",
  "plan.personalized": "Personalised development plan",
  "learning.advanced_resources": "Advanced learning resources",
  "practice.tasks": "Practical tasks",
  "practice.ai_feedback": "AI feedback on practice",
  "progress.history": "Full progress history",
  "export.data": "Data export",
};
