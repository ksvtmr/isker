/**
 * Admin ↔ platform sync for users: the user card shows real API data in its five tabs, stale edits are refused with a
 * clear message (optimistic locking), API failures never look like success, a blocked account is signed out with an
 * explanation, and the live-sync poll refetches what changed.
 */
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { useLiveSync } from "../api/sync";
import { ToastProvider } from "../components/Toaster";
import { LocationProbe, mockApi } from "./utils";

afterEach(() => vi.unstubAllGlobals());

function renderApp(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[route]}><ToastProvider><App /><LocationProbe /></ToastProvider></MemoryRouter></QueryClientProvider>);
  return qc;
}

const ADMIN_PERMS = ["admin.access", "users.view", "users.view_details", "users.support", "users.manage", "roles.view", "roles.assign",
  "plans.view", "subscriptions.view", "subscriptions.manage", "audit.view"];
const admin = { id: 99, email: "admin@isker.local", full_name: "Ada Admin", status: "active", roles: ["admin", "user"], permissions: ADMIN_PERMS,
  email_verified: true, onboarding_completed: true, created_at: "2026-01-01", language: "en", has_password: true, google_linked: false };
const learner = { ...admin, id: 5, email: "dana@example.com", full_name: "Dana Learner", roles: ["user"], permissions: [] };

const detail = (o: object = {}) => ({
  id: 5, lock_version: 3, email: "dana@example.com", full_name: "Dana Learner", language: "kk", email_verified: false, auth_methods: ["email", "google"],
  status: "active", status_reason: null, status_changed_at: null, deletion_requested_at: null, roles: ["user"], permissions: [],
  email_verified_at: null, terms_accepted_at: "2026-09-01T10:00:00Z", terms_version: "2026-10", onboarding_completed: true, created_at: "2026-09-01T10:00:00Z",
  last_login_at: "2026-10-10T08:00:00Z", last_seen_at: "2026-10-11T09:30:00Z", profile: null, goals: [],
  attempts: [{ id: 1, scope: "full", status: "completed", started_at: "2026-09-02T10:00:00Z", completed_at: "2026-09-02T11:00:00Z", overall_score: 64, sequence: 1 }],
  competencies: [{ code: "SPOT", name: "Spotting opportunities", score: 71, level: "Advanced", measured_at: "2026-09-02T11:00:00Z" }],
  learning: { completed: 2, in_progress: 1 }, practice: { completed: 1, in_progress: 0 },
  plan_key: "pro", plan_name: "Pro", subscription: { id: 7, plan_id: 2, plan_key: "pro", plan_name: "Pro", status: "active", source: "admin", started_at: "2026-10-01T00:00:00Z", expires_at: null, cancel_at_period_end: false, canceled_at: null, ended_at: null, note: null },
  subscription_history: [], sessions: [{ id: "s1", created_at: "2026-10-10T08:00:00Z", last_seen_at: null, expires_at: "2026-10-20T08:00:00Z", user_agent: "Firefox on Linux" }],
  entitlements: [
    { key: "learning.advanced_resources", label: "Advanced", description: "", kind: "flag", enabled: true, limit: null, window_days: null },
    { key: "assessment.full", label: "Full", description: "", kind: "limit", enabled: true, limit: 2, window_days: 30 },
    { key: "progress.history", label: "History", description: "", kind: "flag", enabled: false, limit: null, window_days: null },
  ],
  audit_events: [],
  activity: [{ id: 11, actor_id: 5, actor_email: "dana@example.com", action: "auth.login", target_type: "user", target_id: 5, outcome: "success", reason: null, request_id: null, ip_address: null, details: null, created_at: "2026-10-10T08:00:00Z" }],
  change_history: [{ id: 12, actor_id: 99, actor_email: "admin@isker.local", action: "admin.user_updated", target_type: "user", target_id: 5, outcome: "success",
    reason: "Name change request", request_id: null, ip_address: null, created_at: "2026-10-09T08:00:00Z",
    details: { changes: { full_name: { from: "Dana Old", to: "Dana Learner" }, email_verified: { from: true, to: false } } } }],
  can_manage: true, can_assign_roles: true, can_delete: false, ...o,
});
const base = { "GET /api/auth/me": { json: admin }, "GET /api/admin/roles": { json: [] }, "GET /api/admin/plans": { json: [] }, "GET /api/sync/state": { json: { user_version: 1, access_version: "a", entitlements_version: "e", content_version: null, server_time: "" } } };

describe("admin user card", () => {
  it("shows real data in the Profile, Subscription, Progress, Activity and Change history tabs", async () => {
    mockApi({ ...base, "GET /api/admin/users/5": { json: detail() } });
    renderApp("/admin/users/5");
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Profile", "Subscription", "Progress", "Activity", "Change history"]);
    // Profile: ID, language, sign-in methods, verification, edit form prefilled.
    expect(screen.getByText("#5")).toBeInTheDocument();
    expect(screen.getAllByText("Қазақша").length).toBeGreaterThan(0);
    expect(screen.getByText("Email and password, Google")).toBeInTheDocument();
    expect(screen.getByText("Not confirmed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend confirmation email" })).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("Dana Learner");

    await userEvent.click(screen.getByRole("tab", { name: "Subscription" }));
    expect(screen.getByText("Plan: Pro")).toBeInTheDocument();
    expect(screen.getByText("Included")).toBeInTheDocument();
    expect(screen.getByText("2 per 30 days")).toBeInTheDocument();
    expect(screen.getByText("Not included")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Progress" }));
    expect(screen.getByText("Spotting opportunities")).toBeInTheDocument();
    expect(screen.getByText("64")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByText("Firefox on Linux")).toBeInTheDocument();
    expect(screen.getByText("Actions by the user")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Change history" }));
    const changes = screen.getByRole("list", { name: "Changed fields" });
    expect(within(changes).getByText("Name")).toBeInTheDocument();
    expect(changes).toHaveTextContent("Dana Old → Dana Learner");
    expect(changes).toHaveTextContent("Email confirmed: Yes → No");
    expect(screen.getByText(/admin@isker\.local · reason: Name change request/)).toBeInTheDocument();
  });

  it("sends expected_version and shows a clear conflict message instead of overwriting (409 VERSION_CONFLICT)", async () => {
    let gets = 0;
    const calls = mockApi({
      ...base,
      "GET /api/admin/users/5": () => { gets += 1; return { json: detail(gets > 1 ? { lock_version: 4, full_name: "Changed Elsewhere" } : {}) }; },
      "PATCH /api/admin/users/5": { status: 409, json: { error: { code: "VERSION_CONFLICT", message: "Someone else changed this record.", details: { current_version: 4 } } } },
    });
    renderApp("/admin/users/5");
    const name = await screen.findByLabelText("Full name");
    await userEvent.clear(name);
    await userEvent.type(name, "Dana Renamed");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Reason for the change"), "Typo in name");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("This account was changed by someone else")).toBeInTheDocument();
    expect(screen.queryByText("Account updated")).not.toBeInTheDocument();
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ reason: "Typo in name", expected_version: 3, full_name: "Dana Renamed" });
    expect(screen.getByLabelText("Full name")).toHaveValue("Dana Renamed"); // the admin's input is not lost
    await userEvent.click(screen.getByRole("button", { name: "Load latest data" }));
    await waitFor(() => expect(screen.getByLabelText("Full name")).toHaveValue("Changed Elsewhere"));
    expect(screen.queryByText("This account was changed by someone else")).not.toBeInTheDocument();
  });

  it("validates the form, can discard unsaved changes and reports success only after the API confirms", async () => {
    const calls = mockApi({
      ...base,
      "GET /api/admin/users/5": { json: detail() },
      "PATCH /api/admin/users/5": (body: unknown) => ({ json: detail({ ...(body as object), lock_version: 4, language: (body as { language?: string }).language ?? "kk" }) }),
    });
    renderApp("/admin/users/5");
    const email = await screen.findByLabelText("Email");
    await userEvent.clear(email);
    await userEvent.type(email, "not-an-email");
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Email")).toHaveValue("dana@example.com");
    await userEvent.selectOptions(within(screen.getByRole("form", { name: "Edit profile" })).getByRole("combobox", { name: "Interface language" }), "ru");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Give a reason of at least 3 characters.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    await userEvent.type(screen.getByLabelText("Reason for the change"), "User asked by phone");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Account updated")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ reason: "User asked by phone", expected_version: 3, language: "ru" });
  });
});

describe("API error handling (scenario 15)", () => {
  it("shows server and network errors and never reports a failed save as saved", async () => {
    let fail: "server" | "network" = "server";
    mockApi({
      ...base,
      "GET /api/admin/users/5": { json: detail() },
      "PATCH /api/admin/users/5": { status: 500, json: { error: { code: "INTERNAL_ERROR", message: "boom" } } },
    });
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => (fail === "network" && init?.method === "PATCH" ? Promise.reject(new TypeError("Failed to fetch")) : realFetch(url, init)));
    renderApp("/admin/users/5");
    const name = await screen.findByLabelText("Full name");
    await userEvent.type(name, "x");
    await userEvent.type(screen.getByLabelText("Reason for the change"), "Testing errors");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Changes were not saved")).toBeInTheDocument();
    expect(screen.getAllByText("Something went wrong on our side. Please try again.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Account updated")).not.toBeInTheDocument();
    fail = "network";
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect((await screen.findAllByText("We couldn't reach Isker. Check your connection and try again.")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Full name")).toHaveValue("Dana Learnerx");
  });

  it("explains a missing record instead of showing a blank page", async () => {
    mockApi({ ...base, "GET /api/admin/users/404": { status: 404, json: { error: { code: "USER_NOT_FOUND", message: "User not found" } } } });
    renderApp("/admin/users/404");
    expect(await screen.findByText("User not found.")).toBeInTheDocument();
  });
});

describe("blocked accounts", () => {
  it("signs a suspended learner out with a localized explanation when the live poll is refused", async () => {
    mockApi({
      "GET /api/auth/me": { json: learner },
      "GET /api/sync/state": { status: 401, json: { error: { code: "ACCOUNT_SUSPENDED", message: "This account is suspended." } } },
    });
    renderApp("/dashboard");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/login?next=%2Fdashboard&reason=ACCOUNT_SUSPENDED"));
    expect(await screen.findByText("This account is suspended. Contact support if you think this is a mistake.")).toBeInTheDocument();
  });

  it("does the same when any API call reports a deactivated account", async () => {
    mockApi({
      "GET /api/auth/me": { json: learner },
      "GET /api/sync/state": { status: 401, json: { error: { code: "ACCOUNT_DEACTIVATED", message: "closed" } } },
    });
    renderApp("/settings");
    expect(await screen.findByText("This account has been closed. Contact support to restore it.")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("reason=ACCOUNT_DEACTIVATED");
  });

  it("ignores unknown reason codes in the sign-in URL", async () => {
    mockApi({ "GET /api/auth/me": { status: 401, json: { error: { code: "NOT_AUTHENTICATED", message: "x" } } }, "GET /api/auth/providers": { json: { password: true, google: false } } });
    renderApp("/login?reason=<b>hi</b>");
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("<b>hi</b>")).not.toBeInTheDocument();
  });
});

describe("live sync (scenario 16)", () => {
  it("refetches subscription data when the entitlements version changes, and only then", async () => {
    let version = "e1";
    let subFetches = 0;
    mockApi({ "GET /api/sync/state": () => ({ json: { user_version: 1, access_version: "a", entitlements_version: version, content_version: null, server_time: "" } }) });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Probe() {
      useLiveSync(true);
      const sub = useQuery({ queryKey: ["subscription"], queryFn: async () => { subFetches += 1; return subFetches; } });
      return <div data-testid="sub">{sub.data}</div>;
    }
    render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId("sub")).toHaveTextContent("1"));
    await waitFor(() => expect(qc.getQueryData(["sync-state"])).toBeTruthy());
    await act(() => qc.refetchQueries({ queryKey: ["sync-state"] }));
    expect(subFetches).toBe(1); // nothing changed: no refetch
    version = "e2";
    await act(() => qc.refetchQueries({ queryKey: ["sync-state"] }));
    await waitFor(() => expect(screen.getByTestId("sub")).toHaveTextContent("2"));
  });
});
