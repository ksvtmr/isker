/** Admin APIs for users, roles, plans, subscriptions, analytics, audit log and settings. */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AccountStatus, Page, BillingPlan, RoleKey, Subscription, SubscriptionEvent, SubscriptionStatus } from "../types/api";
import { api, qs } from "./client";
import { keys } from "./keys";

export interface AdminUserRow {
  id: number;
  email: string;
  full_name: string;
  status: AccountStatus;
  roles: RoleKey[];
  plan_key: string;
  plan_name: string;
  subscription_status: SubscriptionStatus | null;
  email_verified: boolean;
  onboarding_completed: boolean;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  completed_attempts: number;
  latest_overall: number | null;
}

export interface AuditEntry {
  id: number;
  actor_id: number | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: number | null;
  outcome: "success" | "failure" | "denied";
  reason: string | null;
  request_id: string | null;
  ip_address: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminUserDetail {
  id: number;
  email: string;
  full_name: string;
  status: AccountStatus;
  status_reason: string | null;
  status_changed_at: string | null;
  deletion_requested_at: string | null;
  roles: RoleKey[];
  permissions: string[];
  email_verified_at: string | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
  onboarding_completed: boolean;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  profile: Record<string, string | number | null> | null;
  goals: string[];
  attempts: { id: number; scope: string; status: string; started_at: string; completed_at: string | null; overall_score: number | null; sequence: number }[];
  competencies: { code: string; name: string; score: number; level: string | null; measured_at: string }[];
  learning: { completed: number; in_progress: number };
  practice: { completed: number; in_progress: number };
  plan_key: string;
  plan_name: string;
  subscription: Subscription | null;
  subscription_history: SubscriptionEvent[];
  sessions: { id: string; created_at: string; last_seen_at: string | null; expires_at: string; user_agent: string | null }[];
  audit_events: AuditEntry[] | null;
  can_manage: boolean;
  can_assign_roles: boolean;
  can_delete: boolean;
}

export interface ActionResult { message: string; delivered?: boolean | null; backend?: string | null; revoked_sessions?: number | null }

export interface RoleInfo {
  id: number;
  key: RoleKey;
  name: string;
  description: string | null;
  rank: number;
  is_system: boolean;
  permissions: string[];
  user_count: number;
  editable: boolean;
}

export interface PlanAdmin extends BillingPlan { subscriber_count: number }
export interface SubscriptionAdmin extends Subscription { user_email: string | null; user_name: string | null }

export interface AnalyticsOverview {
  generated_at: string;
  window_days: number;
  users: { total: number; active: number; suspended: number; deactivated: number; verified: number; onboarded: number; new_in_window: number; new_last_7_days: number; active_last_7_days: number; active_in_window: number };
  registrations: { date: string; count: number }[];
  assessments: { started: number; completed: number; in_progress: number; abandoned: number; completed_in_window: number; completion_rate: number | null; reassessments_completed: number; average_overall: number | null };
  subscriptions: { free_users: number; paid_users: number; granted_free_of_charge: number; by_status: Record<SubscriptionStatus, number>; by_plan: { plan: string; name: string; count: number }[]; expiring_in_7_days: number };
  learning: { resources_completed: number; resources_in_progress: number; resources_completed_in_window: number; tasks_completed: number; plan_activities_completed: number; learners_active_in_window: number };
  ai: { evaluations: number; fallbacks: number };
  recent_admin_actions: AuditEntry[] | null;
  security_events: AuditEntry[] | null;
  security_summary: { failed_logins_7_days: number; access_denied_7_days: number } | null;
}

export interface SettingsStatus {
  environment: string;
  app_base_url: string;
  cors_origins: string[];
  security: { secure_cookies: boolean; csrf_protection: boolean; rate_limiting: boolean; max_request_bytes: number; session_hours: number };
  email: { backend: string; delivers_email: boolean; verification_required: boolean };
  ai: { provider: string; model: string | null; configured: boolean };
  payments: { provider: string | null; configured: boolean; checkout_available: boolean; note: string };
  terms_version: string;
}

export interface UserFilters {
  q?: string;
  role?: string;
  status?: string;
  plan?: string;
  registered_from?: string;
  registered_to?: string;
  active_within_days?: number | "";
  inactive_for_days?: number | "";
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export interface AuditFilters {
  action?: string;
  actor_id?: number | "";
  target_type?: string;
  target_id?: number | "";
  outcome?: string;
  security_only?: boolean;
  date_from?: string;
  date_to?: string;
  page?: number;
}

export interface PlanEntitlementInput { feature_key: string; enabled: boolean; limit_value?: number | null }

type F = Record<string, string | number | boolean | null | undefined>;

export const manageApi = {
  users: (f: UserFilters) => api.get<Page<AdminUserRow>>(`/api/admin/users${qs(f as F)}`),
  user: (id: number) => api.get<AdminUserDetail>(`/api/admin/users/${id}`),
  updateUser: (id: number, body: { full_name?: string; email?: string; reason: string }) => api.patch<AdminUserDetail>(`/api/admin/users/${id}`, body),
  suspend: (id: number, reason: string) => api.post<ActionResult>(`/api/admin/users/${id}/suspend`, { reason }),
  deactivate: (id: number, reason: string) => api.post<ActionResult>(`/api/admin/users/${id}/deactivate`, { reason }),
  reactivate: (id: number, reason: string) => api.post<ActionResult>(`/api/admin/users/${id}/reactivate`, { reason }),
  revokeSessions: (id: number, reason: string) => api.post<ActionResult>(`/api/admin/users/${id}/revoke-sessions`, { reason }),
  sendPasswordReset: (id: number, reason: string) => api.post<ActionResult>(`/api/admin/users/${id}/password-reset`, { reason }),
  grantRole: (id: number, role_key: string, reason: string) => api.post<AdminUserDetail>(`/api/admin/users/${id}/roles`, { role_key, reason }),
  revokeRole: (id: number, role_key: string, reason: string) => api.del<AdminUserDetail>(`/api/admin/users/${id}/roles/${role_key}${qs({ reason })}`),
  deleteUser: (id: number, confirm_email: string, reason: string) => api.del<ActionResult>(`/api/admin/users/${id}`, { confirm_email, reason }),
  roles: () => api.get<RoleInfo[]>("/api/admin/roles"),
  permissions: () => api.get<{ key: string; description: string }[]>("/api/admin/permissions"),
  setRolePermissions: (id: number, permissions: string[], reason: string) => api.put<RoleInfo>(`/api/admin/roles/${id}/permissions`, { permissions, reason }),
  plans: () => api.get<PlanAdmin[]>("/api/admin/plans"),
  createPlan: (body: Omit<BillingPlan, "id" | "is_default" | "entitlements"> & { entitlements: PlanEntitlementInput[] }) => api.post<PlanAdmin>("/api/admin/plans", body),
  updatePlan: (id: number, body: Partial<Omit<BillingPlan, "entitlements">> & { entitlements?: PlanEntitlementInput[]; reason: string }) => api.patch<PlanAdmin>(`/api/admin/plans/${id}`, body),
  subscriptions: (f: { status?: string; plan?: string; source?: string; q?: string; expiring_within_days?: number | ""; page?: number }) =>
    api.get<Page<SubscriptionAdmin>>(`/api/admin/subscriptions${qs(f as F)}`),
  subscriptionEvents: (f: { user_id?: number; subscription_id?: number; page?: number }) => api.get<Page<SubscriptionEvent>>(`/api/admin/subscription-events${qs(f as F)}`),
  assignSubscription: (userId: number, body: { plan_key: string; reason: string; days?: number | null; expires_at?: string | null; status?: SubscriptionStatus }) =>
    api.post<SubscriptionAdmin>(`/api/admin/users/${userId}/subscriptions`, body),
  extendSubscription: (id: number, body: { days?: number | null; until?: string | null; reason: string }) => api.post<SubscriptionAdmin>(`/api/admin/subscriptions/${id}/extend`, body),
  cancelSubscription: (id: number, body: { at_period_end: boolean; reason: string }) => api.post<SubscriptionAdmin>(`/api/admin/subscriptions/${id}/cancel`, body),
  setSubscriptionStatus: (id: number, body: { status: SubscriptionStatus; reason: string }) => api.post<SubscriptionAdmin>(`/api/admin/subscriptions/${id}/status`, body),
  overview: (days = 30) => api.get<AnalyticsOverview>(`/api/admin/analytics/overview${qs({ days })}`),
  auditLogs: (f: AuditFilters) => api.get<Page<AuditEntry>>(`/api/admin/audit-logs${qs(f as F)}`),
  settings: () => api.get<SettingsStatus>("/api/admin/settings"),
};

export const useAdminUserList = (f: UserFilters) =>
  useQuery({ queryKey: keys.admin("users", f), queryFn: () => manageApi.users(f), placeholderData: keepPreviousData });
export const useAdminUser = (id: number) => useQuery({ queryKey: keys.admin("user", id), queryFn: () => manageApi.user(id), enabled: Number.isFinite(id) });
export const useRoles = () => useQuery({ queryKey: keys.admin("roles"), queryFn: manageApi.roles });
export const usePermissionCatalog = () => useQuery({ queryKey: keys.admin("permissions"), queryFn: manageApi.permissions, staleTime: Infinity });
export const useAdminPlans = () => useQuery({ queryKey: keys.admin("plans"), queryFn: manageApi.plans });
export const useAdminSubscriptions = (f: Parameters<typeof manageApi.subscriptions>[0]) =>
  useQuery({ queryKey: keys.admin("subscriptions", f), queryFn: () => manageApi.subscriptions(f), placeholderData: keepPreviousData });
export const useAnalyticsOverview = (days = 30) => useQuery({ queryKey: keys.admin("overview", days), queryFn: () => manageApi.overview(days) });
export const useAuditLogs = (f: AuditFilters, enabled = true) =>
  useQuery({ queryKey: keys.admin("audit", f), queryFn: () => manageApi.auditLogs(f), placeholderData: keepPreviousData, enabled });
export const useSettingsStatus = () => useQuery({ queryKey: keys.admin("settings"), queryFn: manageApi.settings });

/** Role keys in display order. Labels come from `common:roles.<key>`; the keys themselves are never translated. */
export const ROLE_KEYS: RoleKey[] = ["user", "content_manager", "support", "admin", "super_admin"];

export const ACCOUNT_STATUSES = ["active", "suspended", "deactivated"] as const;
export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled", "expired", "incomplete"] as const;
export const OUTCOMES = ["success", "failure", "denied"] as const;

export const STATUS_TONE: Record<string, "success" | "warning" | "error" | "neutral" | "info" | "brand"> = {
  active: "success", suspended: "warning", deactivated: "neutral", trialing: "info", past_due: "warning", canceled: "neutral",
  expired: "neutral", incomplete: "warning", success: "success", failure: "error", denied: "error",
  in_progress: "info", completed: "success", abandoned: "neutral",
};

/** Fallback label for a code with no translation ("auth.login_failed" → "Auth login failed"). */
export const humanize = (s: string) => s.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
