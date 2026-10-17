/**
 * Regression tests for the audit findings fixed in the frontend (FE-H1…H4, FE-M, FE-L, raw backend text,
 * hardcoded strings, a11y, translations page).
 */
import { Tabs, tabPanelProps } from "@isker/design-system";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useStartAttempt } from "../api/assessments";
import { ApiError, errorMessage } from "../api/client";
import { keys } from "../api/keys";
import { App } from "../App";
import { ToastProvider, useToast } from "../components/Toaster";
import { educationLabel } from "../features/options";
import i18n from "../i18n";
import { navIdForPath } from "../layouts/nav";
import { EditorModal } from "../pages/admin/contentSync";
import { auditActionLabel, auditTargetLabel } from "../pages/admin/common";
import { resultDescription } from "../pages/admin/AdminUserDetail";
import { LocationProbe, mockApi, renderWithProviders } from "./utils";

function renderApp(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[route]}><ToastProvider><App /><LocationProbe /></ToastProvider></MemoryRouter></QueryClientProvider>,
  );
}

const unauth = { status: 401, json: { error: { code: "NOT_AUTHENTICATED", message: "Please sign in to continue." } } };
const learner = { id: 1, email: "a@b.co", full_name: "Dana Learner", language: "en", status: "active", roles: ["user"], permissions: [], email_verified: true, onboarding_completed: true, created_at: "2026-01-01" };
const staff = (permissions: string[]) => ({ id: 9, email: "s@isker.local", full_name: "Sam Staff", language: "en", status: "active", roles: ["user", "content_manager"], permissions, email_verified: true, onboarding_completed: true, created_at: "2026-01-01" });
const plan = (o: object = {}) => ({ id: 1, key: "free", name: "Starter", description: null, price_cents: 0, currency: "USD", billing_interval: "none", trial_days: 0, is_active: true, is_default: true, sort_order: 0,
  entitlements: [{ feature_key: "assessment.full", enabled: true, limit_value: 2 }], ...o });

describe("FE-H1: /plans is public", () => {
  it("shows the plans to anonymous visitors with a create-account call to action", async () => {
    mockApi({ "GET /api/auth/me": unauth, "GET /api/plans": { json: [plan(), plan({ id: 2, key: "pro", name: "Plus", price_cents: 900, billing_interval: "month", is_default: false, trial_days: 14 })] } });
    renderApp("/plans");
    expect(await screen.findByRole("heading", { name: "Plans" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/plans"); // not redirected to sign-in
    expect(screen.getAllByRole("link", { name: "Create account" }).length).toBeGreaterThan(0);
    // The default plan's real name is interpolated; the limit period is translated.
    expect(screen.getByText(/The free Starter plan covers the full journey/)).toBeInTheDocument();
    expect(screen.getAllByText("Full assessments: 2 per 30 days").length).toBe(2);
    expect(screen.getByText("14-day free trial")).toBeInTheDocument();
    expect(document.title).toBe("Plans · Isker");
  });

  it("shows the current plan to signed-in users inside the app, with Plans highlighted in the navigation", async () => {
    mockApi({
      "GET /api/auth/me": { json: learner },
      "GET /api/sync/state": { json: { user_version: 1, access_version: "a", entitlements_version: "e", content_version: null, server_time: "2026-10-01T00:00:00Z" } },
      "GET /api/plans": { json: [plan()] },
      "GET /api/subscription/me": { json: { plan: plan(), subscription: null, entitlements: [], history: [], payments: {} } },
    });
    renderApp("/plans");
    expect(await screen.findByText("Your plan: Starter")).toBeInTheDocument();
    const nav = screen.getAllByRole("link", { name: "Plans" }).find((a) => a.getAttribute("aria-current") === "page");
    expect(nav).toBeTruthy();
    expect(screen.queryAllByRole("link", { name: "Dashboard" }).some((a) => a.getAttribute("aria-current") === "page")).toBe(false);
  });

  it("highlights nothing for pages without their own nav entry", () => {
    expect(navIdForPath("/plans")).toBe("plans");
    expect(navIdForPath("/results")).toBe("assessment");
    expect(navIdForPath("/somewhere")).toBe("");
  });
});

describe("FE-H2: AI prompts need ai.manage", () => {
  const prompt = { id: 3, key: "answer_evaluation", version: 2, system_prompt: "S", user_template: "U", notes: null, is_active: false, created_at: "2026-09-01T00:00:00Z" };

  it("is read-only for ai.view", async () => {
    mockApi({ "GET /api/auth/me": { json: staff(["admin.access", "ai.view"]) }, "GET /api/admin/ai/evaluations": { json: { items: [], total: 0, page: 1, page_size: 25 } }, "GET /api/admin/ai/prompts": { json: [prompt] } });
    renderApp("/admin/ai");
    await userEvent.click(await screen.findByRole("tab", { name: "Prompt versions" }));
    expect(await screen.findByText(/view-only access/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New version/ })).not.toBeInTheDocument();
  });

  it("asks for confirmation before activating and shows the API error", async () => {
    const calls = mockApi({
      "GET /api/auth/me": { json: staff(["admin.access", "ai.view", "ai.manage"]) },
      "GET /api/admin/ai/evaluations": { json: { items: [], total: 0, page: 1, page_size: 25 } },
      "GET /api/admin/ai/prompts": { json: [prompt] },
      "POST /api/admin/ai/prompts/3/activate": { status: 403, json: { error: { code: "PERMISSION_DENIED", message: "nope" } } },
    });
    renderApp("/admin/ai");
    await userEvent.click(await screen.findByRole("tab", { name: "Prompt versions" }));
    await userEvent.click(await screen.findByRole("button", { name: "Activate" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Activate “answer_evaluation” version 2\?/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(await within(dialog).findByText(errorMessage(new ApiError(403, { code: "PERMISSION_DENIED", message: "nope" })))).toBeInTheDocument();
  });
});

describe("FE-H3: questions always belong to a chosen assessment", () => {
  const competency = { id: 1, code: "spotting", name: "Spotting", short_name: "Spot", description: "d", hint: null, importance: 0.5, default_target: 70,
    area: { code: "ideas", name: "Ideas", color_token: "ideas" }, area_id: 1, reflection_prompt: null, learning_priority: 0.5, sort_order: 1, status: "published", lock_version: 1, translations: null };
  const assessment = (id: number, title: string) => ({ id, code: `a${id}`, title, description: "desc", estimated_minutes: 20, version: 1, is_active: true, lock_version: 1, translations: null, question_count: 0, attempt_count: 0 });

  it("shows an empty state instead of guessing an assessment id", async () => {
    const calls = mockApi({ "GET /api/auth/me": { json: staff(["admin.access", "content.manage"]) }, "GET /api/admin/questions": { json: [] }, "GET /api/admin/competencies": { json: [competency] }, "GET /api/admin/assessments": { json: [] } });
    renderApp("/admin/assessments?tab=questions");
    expect(await screen.findByText("Create an assessment first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New question" })).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("creates the question in the selected assessment with a known section and validated weights", async () => {
    const calls = mockApi({
      "GET /api/auth/me": { json: staff(["admin.access", "content.manage"]) }, "GET /api/admin/questions": { json: [] }, "GET /api/admin/competencies": { json: [competency] },
      "GET /api/admin/assessments": { json: [assessment(4, "Main"), assessment(8, "Pilot")] },
      "POST /api/admin/questions": (body: unknown) => ({ json: { ...(body as object), id: 50, version: 1, replaced_id: null } }),
    });
    renderApp("/admin/assessments?tab=questions");
    await userEvent.selectOptions(await screen.findByLabelText("Assessment"), "8");
    await userEvent.click(screen.getByRole("button", { name: "New question" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Section")).toHaveValue("Situational judgement");
    expect(within(dialog).getByRole("option", { name: "Situational judgement" })).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Question text"), "What would you do first here?");
    await userEvent.type(within(dialog).getByLabelText(/^Options/), "Ask | 1{enter}Wait | 0");
    await userEvent.type(within(dialog).getByLabelText(/^Measured competencies/), "spotting | lots");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/the weight must be a number above 0 and at most 1/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    const links = within(dialog).getByLabelText(/^Measured competencies/);
    await userEvent.clear(links);
    await userEvent.type(links, "spotting | 0.5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ assessment_id: 8, section: "Situational judgement", competencies: [{ competency_id: 1, weight: 0.5 }] });
  });
});

describe("FE-H4: audit labels", () => {
  it("translates every backend action, including generated status actions", async () => {
    expect(auditActionLabel("admin.question_published")).toBe("Question published");
    expect(auditActionLabel("admin.learning_resource_archived")).toBe("Learning resource archived");
    expect(auditActionLabel("admin.practical_task_draft")).toBe("Practical task moved to drafts");
    expect(auditActionLabel("admin.competency_created")).toBe("Competency created");
    expect(auditActionLabel("admin.question_versioned")).toBe("New question version created");
    expect(auditActionLabel("auth.oauth_linked")).toBe("Google account linked");
    expect(auditActionLabel("auth.token_reuse_detected")).toBe("Token reuse detected");
    await i18n.changeLanguage("ru");
    expect(auditActionLabel("admin.competency_published")).toBe("Компетенция опубликована");
    expect(auditActionLabel("auth.password_set")).toBe("Пароль установлен");
    await i18n.changeLanguage("en");
  });

  it("falls back to a translated generic label with the raw code (never an English guess)", async () => {
    expect(auditActionLabel("billing.something_new")).toBe("Other event (billing.something_new)");
    expect(auditActionLabel("subscription")).toBe("Other event (subscription)"); // a group, not a label
    expect(auditTargetLabel("widget")).toBe("Other object (widget)");
    await i18n.changeLanguage("kk");
    expect(auditActionLabel("x.y")).toBe("Басқа оқиға (x.y)");
    await i18n.changeLanguage("en");
  });

  it("shows the translated label and the raw code in the audit log", async () => {
    mockApi({
      "GET /api/auth/me": { json: staff(["admin.access", "audit.view"]) },
      "GET /api/admin/audit-logs": { json: { items: [{ id: 1, actor_id: 9, actor_email: "s@isker.local", action: "admin.question_archived", target_type: "question", target_id: 12, outcome: "success",
        reason: null, request_id: null, ip_address: null, details: null, created_at: "2026-10-01T10:00:00Z" }], total: 1, page: 1, page_size: 25 } },
    });
    renderApp("/admin/audit-logs");
    expect(await screen.findByText("Question archived")).toBeInTheDocument();
    expect(screen.getByText("admin.question_archived")).toBeInTheDocument();
    expect(screen.getByText("Question #12")).toBeInTheDocument();
  });
});

describe("raw backend text is never shown", () => {
  it("translates Pydantic field errors", async () => {
    const err = new ApiError(422, { code: "VALIDATION_ERROR", message: "Some fields are invalid.", details: [
      { field: "full_name", message: "String should have at least 2 characters" },
      { field: "email", message: "value is not a valid email address: An email address must have an @-sign." },
      { field: "days", message: "Input should be less than or equal to 3660" },
      { field: "reason", message: "Value error, something custom in English" },
      { field: "title", type: "string_too_long", ctx: { max_length: 160 }, message: "whatever" },
    ] });
    expect(err.fieldErrors()).toEqual({ full_name: "Use at least 2 characters", email: "Enter a valid email address", days: "Must be at most 3660", reason: "Invalid value", title: "Use at most 160 characters" });
    await i18n.changeLanguage("ru");
    expect(err.fieldErrors().full_name).toBe("Минимум 2 символа");
    await i18n.changeLanguage("en");
  });

  it("shows a translated generic message for unknown error codes", () => {
    expect(errorMessage(new ApiError(400, { code: "BRAND_NEW_CODE", message: "English server text" }))).toBe("The request couldn't be completed (code: BRAND_NEW_CODE). Please try again.");
  });

  it("does not put the API's English message into admin toasts", () => {
    expect(resultDescription({ message: "Password reset link sent." })).toBeUndefined();
    expect(resultDescription({ message: "x", delivered: false })).toMatch(/Email is not configured/);
    expect(resultDescription({ message: "x", revoked_sessions: 2 })).toBe("2 sessions ended");
  });

  it("shows onboarding education values with their translated label and free text as entered", async () => {
    await i18n.changeLanguage("ru");
    expect(educationLabel("Master")).not.toBe("Master");
    expect(educationLabel("Self-taught founder")).toBe("Self-taught founder");
    await i18n.changeLanguage("en");
  });
});

describe("invalidation", () => {
  it("starting an attempt refreshes the dashboard, plan and usage counters", async () => {
    mockApi({ "POST /api/assessments/attempts": { json: { attempt: { id: 3 }, resumed: false } } });
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useStartAttempt(), { wrapper });
    await act(() => result.current.mutateAsync({ scope: "full" }));
    const invalidated = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const k of [keys.assessments, keys.dashboard, keys.plan, keys.subscription, keys.entitlements]) expect(invalidated).toContain(JSON.stringify(k));
  });
});

describe("guards and language", () => {
  it("keeps admins on a retry screen when the session check fails for network reasons", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    renderApp("/admin");
    expect(await screen.findByRole("button", { name: "Try again" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/admin");
  });

  it("applies the account's saved language in the admin area too", async () => {
    mockApi({ "GET /api/auth/me": { json: { ...staff(["admin.access"]), language: "kk" } }, "GET /api/admin/analytics/overview": { status: 500, json: { error: { code: "INTERNAL_ERROR", message: "x" } } } });
    renderApp("/admin");
    await waitFor(() => expect(i18n.language).toBe("kk"));
    expect(document.documentElement.lang).toBe("kk");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content") ?? i18n.t("common:app.metaDescription")).toMatch(/EntreComp/);
    await act(() => i18n.changeLanguage("en"));
  });
});

describe("translations admin page", () => {
  const perms = ["admin.access", "content.manage"];
  it("says when the server doesn't offer the report yet", async () => {
    mockApi({ "GET /api/auth/me": { json: staff(perms) }, "GET /api/admin/translations/status": { status: 404, json: { error: { code: "NOT_FOUND", message: "Not Found" } } } });
    renderApp("/admin/translations");
    expect(await screen.findByText("The translation report is not available yet")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Administration" });
    expect(within(nav).getByRole("link", { name: "Translations" })).toHaveAttribute("href", "/admin/translations");
  });

  it("shows the summary, filters and links to editors", async () => {
    const calls = mockApi({
      "GET /api/auth/me": { json: staff(perms) },
      "GET /api/admin/translations/status": { json: {
        summary: { competency: { ru: { complete: 10, partial: 1, missing: 0, stale: 0 }, kk: { complete: 8, partial: 0, missing: 3, stale: 0 } } },
        items: [
          { entity: "competency", id: 4, label: "Creativity", status: { ru: "partial", kk: "missing" }, missing: { ru: ["hint"], kk: ["name", "description"] }, stale: { ru: [], kk: [] } },
          { entity: "goal", id: 2, label: "Launch a startup", status: { ru: "complete", kk: "stale" }, missing: { ru: [], kk: [] }, stale: { ru: [], kk: ["title"] } },
        ], total: 2, page: 1, page_size: 25 } },
    });
    renderApp("/admin/translations");
    expect(await screen.findByText("Creativity")).toBeInTheDocument();
    expect(screen.getByText("Missing: 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open editor/ })).toHaveAttribute("href", "/admin/competencies");
    expect(screen.getByText("No editor yet")).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes("translations/status"))?.url).toContain("status=missing%2Cpartial%2Cstale");
    await userEvent.selectOptions(screen.getByLabelText("Language"), "kk");
    await waitFor(() => expect(calls.some((c) => c.url.includes("language=kk"))).toBe(true));
  });
});

describe("a11y", () => {
  it("tabs: roving tabindex, arrow keys and tab/panel references", async () => {
    function Demo() {
      const [v, setV] = useState("a");
      return <><Tabs id="demo" ariaLabel="Demo" value={v} onChange={setV} tabs={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} /><div {...tabPanelProps("demo", v)}>Panel {v}</div></>;
    }
    render(<Demo />);
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    expect(alpha).toHaveAttribute("tabindex", "0");
    expect(beta).toHaveAttribute("tabindex", "-1");
    expect(alpha).toHaveAttribute("aria-controls", "demo-panel-a");
    alpha.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(beta).toHaveFocus();
    expect(beta).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Beta" })).toHaveTextContent("Panel b");
  });

  it("toaster: the live region is always in the accessibility tree", async () => {
    function Push() { const toast = useToast(); return <button type="button" onClick={() => toast({ title: "Saved!" })}>push</button>; }
    render(<ToastProvider><Push /></ToastProvider>);
    const region = document.querySelector(".ik-toast") as HTMLElement;
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region.style.display).not.toBe("none");
    await userEvent.click(screen.getByRole("button", { name: "push" }));
    expect(within(region).getByText("Saved!")).toBeInTheDocument();
  });

  it("editor modal asks before discarding unsaved edits", async () => {
    const onDiscard = vi.fn();
    renderWithProviders(<EditorModal open dirty title="Edit" onDiscard={onDiscard} footer={(close) => <button type="button" onClick={close}>Cancel edit</button>}><p>Body</p></EditorModal>);
    await userEvent.keyboard("{Escape}");
    expect(onDiscard).not.toHaveBeenCalled();
    expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("assessment runner has a main landmark and marks answered questions without relying on colour", async () => {
    mockApi({
      "GET /api/auth/me": { json: learner },
      "GET /api/sync/state": { json: { user_version: 1, access_version: "a", entitlements_version: "e", content_version: null, server_time: "2026-10-01T00:00:00Z" } },
      "GET /api/assessments/attempts/5": { json: {
        attempt: { id: 5, status: "in_progress", scope: "full", current_index: 1, total: 2, competency: null },
        questions: [{ id: 1, index: 0, type: "likert", section: "Self", text: "Q1?", help_text: null, min_length: 0, options: [{ id: 11, label: "Yes" }] },
          { id: 2, index: 1, type: "likert", section: "Self", text: "Q2?", help_text: null, min_length: 0, options: [{ id: 21, label: "Yes" }] }],
        answers: [{ question_id: 1, option_id: 11, text_response: null }] } },
    });
    renderApp("/assessment/5");
    expect(await screen.findByRole("main")).toBeInTheDocument();
    const answered = await screen.findByRole("button", { name: "Question 1, answered" });
    expect(answered.querySelector("svg")).not.toBeNull();
    expect(document.title).toBe("Assessment · Isker");
  });
});
