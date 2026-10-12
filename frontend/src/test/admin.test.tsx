import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { ToastProvider } from "../components/Toaster";
import { LocationProbe, mockApi } from "./utils";

function renderApp(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[route]}><ToastProvider><App /><LocationProbe /></ToastProvider></MemoryRouter></QueryClientProvider>,
  );
}

const ADMIN_PERMS = ["admin.access", "analytics.view", "users.view", "users.view_details", "users.support", "users.manage", "roles.view", "roles.assign",
  "plans.view", "plans.manage", "subscriptions.view", "subscriptions.manage", "content.manage", "ai.view", "ai.manage", "audit.view", "settings.view"];
const SUPPORT_PERMS = ["admin.access", "users.view", "users.view_details", "users.support", "subscriptions.view", "plans.view"];
const staff = (permissions: string[], roles: string[]) => ({ id: 99, email: "staff@isker.local", full_name: "Sam Staff", status: "active", roles: ["user", ...roles], permissions, email_verified: true, onboarding_completed: true, created_at: "2026-01-01" });

const row = (o: object = {}) => ({ id: 5, email: "dana@example.com", full_name: "Dana Learner", status: "active", roles: ["user"], plan_key: "free", plan_name: "Free", subscription_status: null,
  email_verified: true, onboarding_completed: true, created_at: "2026-09-01T10:00:00Z", last_login_at: null, last_seen_at: "2026-10-01T10:00:00Z", completed_attempts: 1, latest_overall: 61, ...o });
const plans = [{ id: 1, key: "free", name: "Free", description: null, price_cents: 0, currency: "USD", billing_interval: "none", trial_days: 0, is_active: true, is_default: true, sort_order: 0, entitlements: [], subscriber_count: 3 },
  { id: 2, key: "pro", name: "Pro", description: null, price_cents: 900, currency: "USD", billing_interval: "month", trial_days: 0, is_active: true, is_default: false, sort_order: 1, entitlements: [], subscriber_count: 0 }];
const detail = (o: object = {}) => ({
  id: 5, email: "dana@example.com", full_name: "Dana Learner", status: "active", status_reason: null, status_changed_at: null, deletion_requested_at: null, roles: ["user"], permissions: [],
  email_verified_at: "2026-09-01T10:00:00Z", terms_accepted_at: "2026-09-01T10:00:00Z", terms_version: "2026-10", onboarding_completed: true, created_at: "2026-09-01T10:00:00Z",
  last_login_at: null, last_seen_at: null, profile: null, goals: [], attempts: [], competencies: [], learning: { completed: 0, in_progress: 0 }, practice: { completed: 0, in_progress: 0 },
  plan_key: "free", plan_name: "Free", subscription: null, subscription_history: [], sessions: [], audit_events: [], can_manage: true, can_assign_roles: true, can_delete: false, ...o,
});

describe("admin area", () => {
  it("shows only the sections a support agent is allowed to use", async () => {
    mockApi({ "GET /api/auth/me": { json: staff(SUPPORT_PERMS, ["support"]) } });
    renderApp("/admin");
    const nav = await screen.findByRole("navigation", { name: "Administration" });
    expect(within(nav).getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Subscriptions" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Roles & permissions" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Audit log" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("explains a missing permission instead of showing a blank page", async () => {
    mockApi({ "GET /api/auth/me": { json: staff(SUPPORT_PERMS, ["support"]) } });
    renderApp("/admin/roles");
    expect(await screen.findByText("You don't have access to this section")).toBeInTheDocument();
  });

  it("lists users with sortable headers and sends sort and filter parameters", async () => {
    const calls = mockApi({
      "GET /api/auth/me": { json: staff(ADMIN_PERMS, ["admin"]) },
      "GET /api/admin/plans": { json: plans },
      "GET /api/admin/users": { json: { items: [row()], total: 1, page: 1, page_size: 25 } },
    });
    renderApp("/admin/users");
    expect(await screen.findByRole("link", { name: /Dana Learner/ })).toHaveAttribute("href", "/admin/users/5");
    const registered = screen.getByRole("columnheader", { name: /Registered/ });
    expect(registered).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(within(registered).getByRole("button"));
    await waitFor(() => expect(calls.some((c) => c.url.includes("sort=created_at") && c.url.includes("order=asc"))).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText("Status"), "suspended");
    await waitFor(() => expect(calls.some((c) => c.url.includes("status=suspended"))).toBe(true));
    expect(screen.getByText("1–1 of 1")).toBeInTheDocument();
  });

  it("requires a reason to suspend and reports success only after the API confirms", async () => {
    const calls = mockApi({
      "GET /api/auth/me": { json: staff(ADMIN_PERMS, ["admin"]) },
      "GET /api/admin/users/5": { json: detail() },
      "GET /api/admin/roles": { json: [] },
      "GET /api/admin/plans": { json: plans },
      "POST /api/admin/users/5/suspend": (body: unknown) => (body as { reason: string }).reason === "Spam"
        ? { json: { message: "Account suspended. The user has been signed out.", revoked_sessions: 1 } }
        : { status: 422, json: { error: { code: "VALIDATION_ERROR", message: "Bad" } } },
    });
    renderApp("/admin/users/5");
    await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Suspend account" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "Spam");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(await screen.findByText("Account suspended")).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({ reason: "Spam" });
  });

  it("keeps the dialog open and shows the server error when an action is refused", async () => {
    mockApi({
      "GET /api/auth/me": { json: staff(ADMIN_PERMS, ["admin"]) },
      "GET /api/admin/users/5": { json: detail() },
      "GET /api/admin/roles": { json: [] },
      "GET /api/admin/plans": { json: plans },
      "POST /api/admin/users/5/suspend": { status: 403, json: { error: { code: "INSUFFICIENT_RANK", message: "You can't manage an account with an equal or higher role." } } },
    });
    renderApp("/admin/users/5");
    await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "Testing");
    await userEvent.click(within(dialog).getByRole("button", { name: "Suspend account" }));
    expect(await within(dialog).findByText("You can't manage an account with an equal or higher role.")).toBeInTheDocument();
    expect(screen.queryByText("Account suspended")).not.toBeInTheDocument();
  });

  it("asks for the email before permanent deletion", async () => {
    const calls = mockApi({
      "GET /api/auth/me": { json: staff([...ADMIN_PERMS, "users.delete"], ["super_admin"]) },
      "GET /api/admin/users/5": { json: detail({ status: "deactivated", can_delete: true }) },
      "GET /api/admin/roles": { json: [] },
      "GET /api/admin/plans": { json: plans },
      "DELETE /api/admin/users/5": { json: { message: "The account and its personal data were permanently deleted." } },
      "GET /api/admin/users": { json: { items: [], total: 0, page: 1, page_size: 25 } },
    });
    renderApp("/admin/users/5");
    await userEvent.click(await screen.findByRole("tab", { name: "Roles & security" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "GDPR request");
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Type dana@example.com to confirm"), "dana@example.com");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/users"));
    expect(calls.find((c) => c.method === "DELETE")?.body).toEqual({ confirm_email: "dana@example.com", reason: "GDPR request" });
  });
});

describe("api client", () => {
  it("sends the CSRF cookie as X-CSRF-Token on unsafe requests only", async () => {
    document.cookie = "isker_csrf=abc123";
    const seen: { method: string; headers: Record<string, string> }[] = [];
    const { api } = await import("../api/client");
    const fetchMock = async (_url: string, init?: RequestInit) => {
      seen.push({ method: init?.method ?? "GET", headers: (init?.headers as Record<string, string>) ?? {} });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    };
    globalThis.fetch = fetchMock as typeof fetch;
    await api.get("/api/x");
    await api.post("/api/x", { a: 1 });
    await api.del("/api/x");
    expect(seen[0].headers["X-CSRF-Token"]).toBeUndefined();
    expect(seen[1].headers["X-CSRF-Token"]).toBe("abc123");
    expect(seen[2].headers["X-CSRF-Token"]).toBe("abc123");
    document.cookie = "isker_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });
});
