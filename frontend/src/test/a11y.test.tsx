/**
 * Automated accessibility checks with axe-core (WCAG 2.x A/AA rules).
 * jsdom has no layout engine, so `color-contrast` can't be computed here; contrast is covered by the token
 * review in docs/admin-security-ux-report.md and the browser-based axe run (scripts/e2e/journey.mjs).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Badge, Breadcrumbs, ConfirmActionDialog, DataTable, Pagination, Stepper } from "@isker/design-system";
import { App } from "../App";
import { ToastProvider } from "../components/Toaster";
import { mockApi } from "./utils";

const OPTIONS: axe.RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  rules: { "color-contrast": { enabled: false } },
};

async function expectNoViolations(el: Element) {
  const res = await axe.run(el, OPTIONS);
  const summary = res.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
  expect(summary).toEqual([]);
}

function renderApp(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[route]}><ToastProvider><App /></ToastProvider></MemoryRouter></QueryClientProvider>);
}

const unauth = { status: 401, json: { error: { code: "NOT_AUTHENTICATED", message: "Please sign in." } } };
const ADMIN = { id: 9, email: "admin@isker.local", full_name: "Ada Admin", status: "active", roles: ["user", "super_admin"], email_verified: true, onboarding_completed: true, created_at: "2026-01-01",
  permissions: ["admin.access", "analytics.view", "users.view", "users.view_details", "users.support", "users.manage", "users.delete", "roles.view", "roles.assign", "roles.manage", "plans.view", "plans.manage", "subscriptions.view", "subscriptions.manage", "content.manage", "ai.view", "ai.manage", "audit.view", "settings.view"] };
const plans = [{ id: 1, key: "free", name: "Free", description: "Core journey", price_cents: 0, currency: "USD", billing_interval: "none", trial_days: 0, is_active: true, is_default: true, sort_order: 0, entitlements: [{ feature_key: "assessment.full", enabled: true, limit_value: 2 }], subscriber_count: 2 },
  { id: 2, key: "pro", name: "Pro", description: "Everything", price_cents: 900, currency: "USD", billing_interval: "month", trial_days: 0, is_active: true, is_default: false, sort_order: 1, entitlements: [{ feature_key: "assessment.full", enabled: true, limit_value: null }], subscriber_count: 1 }];
const overview = {
  generated_at: "2026-10-12T10:00:00Z", window_days: 30,
  users: { total: 3, active: 3, suspended: 0, deactivated: 0, verified: 2, onboarded: 2, new_in_window: 2, new_last_7_days: 1, active_last_7_days: 2, active_in_window: 3 },
  registrations: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, count: i % 7 === 0 ? 1 : 0 })),
  assessments: { started: 3, completed: 2, in_progress: 1, abandoned: 0, completed_in_window: 2, completion_rate: 66.7, reassessments_completed: 1, average_overall: 58 },
  subscriptions: { free_users: 2, paid_users: 0, granted_free_of_charge: 1, by_status: { trialing: 0, active: 1, past_due: 0, canceled: 0, expired: 0, incomplete: 0 }, by_plan: [], expiring_in_7_days: 0 },
  learning: { resources_completed: 4, resources_in_progress: 1, resources_completed_in_window: 2, tasks_completed: 1, plan_activities_completed: 5, learners_active_in_window: 2 },
  ai: { evaluations: 3, fallbacks: 0 },
  recent_admin_actions: [{ id: 1, actor_id: 9, actor_email: "admin@isker.local", action: "admin.user_suspended", target_type: "user", target_id: 5, outcome: "success", reason: "Spam", request_id: "r1", ip_address: null, details: null, created_at: "2026-10-11T10:00:00Z" }],
  security_events: [], security_summary: { failed_logins_7_days: 0, access_denied_7_days: 0 },
};

describe("accessibility (axe-core)", () => {
  it("sign-in page", async () => {
    mockApi({ "GET /api/auth/me": unauth });
    const { container } = renderApp("/login");
    await screen.findByRole("heading", { name: "Sign in" });
    await expectNoViolations(container);
  });

  it("registration page with the terms checkbox", async () => {
    mockApi({ "GET /api/auth/me": unauth });
    const { container } = renderApp("/register");
    await screen.findByLabelText(/I agree to the/);
    await expectNoViolations(container);
  });

  it("forgot-password page", async () => {
    mockApi({ "GET /api/auth/me": unauth });
    const { container } = renderApp("/forgot-password");
    await screen.findByRole("heading", { name: "Reset your password" });
    await expectNoViolations(container);
  });

  it("admin dashboard with charts", async () => {
    mockApi({ "GET /api/auth/me": { json: ADMIN }, "GET /api/admin/analytics/overview": { json: overview } });
    const { container } = renderApp("/admin");
    await screen.findByRole("img", { name: /Registrations per day/ });
    await expectNoViolations(container);
  });

  it("admin user list", async () => {
    mockApi({
      "GET /api/auth/me": { json: ADMIN }, "GET /api/admin/plans": { json: plans },
      "GET /api/admin/users": { json: { items: [{ id: 5, email: "dana@example.com", full_name: "Dana Learner", status: "suspended", roles: ["user", "support"], plan_key: "free", plan_name: "Free", subscription_status: null, email_verified: true, onboarding_completed: true, created_at: "2026-09-01T10:00:00Z", last_login_at: null, last_seen_at: null, completed_attempts: 0, latest_overall: null }], total: 1, page: 1, page_size: 25 } },
    });
    const { container } = renderApp("/admin/users");
    await screen.findByRole("link", { name: /Dana Learner/ });
    await expectNoViolations(container);
  });

  it("admin plans page", async () => {
    mockApi({ "GET /api/auth/me": { json: ADMIN }, "GET /api/admin/plans": { json: plans } });
    const { container } = renderApp("/admin/plans");
    await screen.findByRole("heading", { name: "Pro" });
    await expectNoViolations(container);
  });

  it("design-system data components", async () => {
    const { container } = render(
      <main>
        <h1>Components</h1>
        <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Users" }]} />
        <Badge tone="success">Active</Badge>
        <DataTable caption="People" columns={[{ key: "n", header: "Name", sortable: true, render: (r: { n: string }) => r.n }]} rows={[{ n: "Ada" }]} rowKey={(r) => r.n}
          sort={{ key: "n", order: "asc" }} onSortChange={() => {}} rowHref={() => "/x"} />
        <Pagination page={1} pageSize={10} total={25} onChange={() => {}} />
        <Stepper steps={[{ label: "Assess", status: "done" }, { label: "Learn", status: "current" }, { label: "Reassess", status: "todo" }]} />
      </main>,
    );
    await expectNoViolations(container);
  });

  it("confirmation dialog", async () => {
    render(<ConfirmActionDialog open title="Suspend Dana?" confirmLabel="Suspend" requireReason confirmText="dana@example.com" onConfirm={() => {}} onCancel={() => {}} />);
    await expectNoViolations(document.body);
  });
});
