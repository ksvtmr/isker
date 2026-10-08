import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { ToastProvider } from "../components/Toaster";
import { LocationProbe, mockApi } from "./utils";

function renderApp(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[route]}><ToastProvider><App /><LocationProbe /></ToastProvider></MemoryRouter></QueryClientProvider>,
  );
}
const unauth = { status: 401, json: { error: { code: "NOT_AUTHENTICATED", message: "Please sign in to continue." } } };
const me = (o: object = {}) => ({ id: 1, email: "a@b.co", full_name: "Dana Learner", role: "user", onboarding_completed: true, created_at: "2026-01-01", ...o });

describe("routing and guards", () => {
  it("redirects anonymous users from protected pages to login with next", async () => {
    mockApi({ "GET /api/auth/me": unauth });
    renderApp("/dashboard");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/login?next=%2Fdashboard"));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("sends users who haven't onboarded to onboarding", async () => {
    mockApi({ "GET /api/auth/me": { json: me({ onboarding_completed: false }) }, "GET /api/goals": { json: [] } });
    renderApp("/progress");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/onboarding"));
  });

  it("keeps learners out of the admin area", async () => {
    mockApi({ "GET /api/auth/me": { json: me() }, "GET /api/dashboard": { status: 500, json: { error: { code: "X", message: "x" } } } });
    renderApp("/admin");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/dashboard"));
  });

  it("shows an empty state with a real CTA before the first assessment", async () => {
    mockApi({
      "GET /api/auth/me": { json: me() },
      "GET /api/dashboard": { json: { user_name: "Dana", onboarding_completed: true, plan_progress_pct: 0, plan_done: 0, plan_total: 0, top_recommendation: null,
        in_progress_attempt_id: null, next_reassessment: null, insight: null, unread_notifications: 0,
        profile: { has_profile: false, overall: null, level: null, previous_overall: null, change: null, assessed_at: null, attempt_id: null, areas: [], competencies: [], strengths: [], priority_gaps: [], insight: null } } },
    });
    renderApp("/dashboard");
    expect(await screen.findByText("Complete your first assessment")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start Assessment" })).toHaveAttribute("href", "/assessment");
  });

  it("renders a friendly error with retry when the API fails", async () => {
    mockApi({ "GET /api/auth/me": { json: me() }, "GET /api/dashboard": { status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } } } });
    renderApp("/dashboard");
    expect(await screen.findByText("We couldn't load your dashboard")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows 404 for unknown routes", async () => {
    mockApi({ "GET /api/auth/me": unauth });
    renderApp("/nope");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });
});
