import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { homeFor } from "../layouts/guards";
import { ToastProvider } from "../components/Toaster";
import { LocationProbe, mockApi } from "./utils";

function renderApp(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[route]}><ToastProvider><App /><LocationProbe /></ToastProvider></MemoryRouter></QueryClientProvider>,
  );
}
const unauth = { status: 401, json: { error: { code: "NOT_AUTHENTICATED", message: "Please sign in to continue." } } };
const me = (o: object = {}) => ({ id: 1, email: "a@b.co", full_name: "Dana Learner", status: "active", roles: ["user"], permissions: [], email_verified: true, onboarding_completed: true, initial_assessment_completed: true, in_progress_attempt_id: null, created_at: "2026-01-01", ...o });
const overview = { assessment: { id: 1, title: "EntreComp competency assessment", description: "", estimated_minutes: 25, question_count: 30, sections: [] }, in_progress: null, completed: [] };

describe("routing and guards", () => {
  it("redirects anonymous users from protected pages to login with next", async () => {
    mockApi({ "GET /api/auth/me": unauth });
    renderApp("/dashboard");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/login?next=%2Fdashboard"));
    expect(await screen.findByRole("heading", { name: "Welcome back!" })).toBeInTheDocument();
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

  it("sends a learner without results to the initial assessment instead of an empty dashboard", async () => {
    mockApi({
      "GET /api/auth/me": { json: me({ initial_assessment_completed: false }) },
      "GET /api/assessments": { json: overview },
      "GET /api/scores/profile": { json: { has_profile: false, competencies: [] } },
    });
    renderApp("/dashboard");
    expect(await screen.findByRole("heading", { name: "Start with your initial assessment" })).toBeInTheDocument();
    expect(screen.getByText(/Isker first needs a picture of your entrepreneurial competencies/)).toBeInTheDocument();
    expect(screen.queryByText("Complete your first assessment")).not.toBeInTheDocument();
  });

  it("routes by onboarding state: onboarding, open attempt, initial assessment, dashboard, admin", () => {
    const base = { permissions: [] as string[], onboarding_completed: true, initial_assessment_completed: true, in_progress_attempt_id: null };
    expect(homeFor({ ...base, onboarding_completed: false })).toBe("/onboarding");
    expect(homeFor({ ...base, initial_assessment_completed: false })).toBe("/assessment");
    expect(homeFor({ ...base, initial_assessment_completed: false, in_progress_attempt_id: 7 })).toBe("/assessment/7");
    expect(homeFor(base)).toBe("/dashboard");
    expect(homeFor({ ...base, permissions: ["admin.access"], initial_assessment_completed: false })).toBe("/admin");
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
