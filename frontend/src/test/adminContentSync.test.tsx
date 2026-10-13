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

const CM_PERMS = ["admin.access", "content.manage", "ai.view"];
const me = { id: 9, email: "cm@isker.local", full_name: "Casey Content", status: "active", roles: ["user", "content_manager"], permissions: CM_PERMS, email_verified: true, onboarding_completed: true, created_at: "2026-01-01" };
const area = { code: "ideas", name: "Ideas & Opportunities", color_token: "ideas" };
const competency = { id: 1, code: "spotting", name: "Spotting Opportunities", short_name: "Spotting", description: "Spot opportunities to create value.", hint: null, importance: 0.8, default_target: 70,
  area, area_id: 1, reflection_prompt: null, learning_priority: 0.5, sort_order: 1, status: "published", lock_version: 2, translations: null };
const resource = (o: object = {}) => ({ id: 7, slug: "lean-canvas", competency_id: 1, title: "Lean canvas basics", description: "A one-page business model.", type: "article", difficulty: "beginner",
  duration_minutes: 10, content: "## Lean canvas\nFill in the nine boxes.", url: null, is_published: true, status: "published", lock_version: 2, translations: null, ...o });
const conflict = { status: 409, json: { error: { code: "VERSION_CONFLICT", message: "Someone else changed this record.", details: { current_version: 3 } } } };

function learningApi(overrides: Record<string, unknown> = {}) {
  let current = resource();
  const routes = {
    "GET /api/auth/me": { json: me },
    "GET /api/admin/competencies": { json: [competency] },
    "GET /api/admin/resources": () => ({ json: [current] }),
    "GET /api/admin/tasks": { json: [] },
    ...overrides,
  };
  const calls = mockApi(routes);
  return { calls, setCurrent: (r: ReturnType<typeof resource>) => { current = r; } };
}

async function openEditor() {
  renderApp("/admin/learning-resources");
  const row = (await screen.findByText("Lean canvas basics")).closest("tr")!;
  await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
  return screen.findByRole("dialog");
}

describe("content editor sync", () => {
  it("shows the publication status and sends the loaded version with a status change", async () => {
    const { calls } = learningApi({ "POST /api/admin/resources/7/status": { json: { ...resource({ status: "archived", is_published: false, lock_version: 3 }) } } });
    renderApp("/admin/learning-resources");
    const row = (await screen.findByText("Lean canvas basics")).closest("tr")!;
    expect(within(row).getByText("Published")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Learners' history and past results are kept/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(await screen.findByText("Archived", { selector: ":not(option)" })).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ status: "archived", expected_version: 2 });
  });

  it("reports a version conflict, keeps the dialog open and reloads the latest version on request", async () => {
    let attempts = 0;
    const api = learningApi({
      "PUT /api/admin/resources/7": (body: unknown) => {
        attempts += 1;
        const b = body as { expected_version: number; title: string };
        return b.expected_version === 3 ? { json: resource({ title: b.title, lock_version: 4 }) } : conflict;
      },
    });
    const dialog = await openEditor();
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled(); // nothing to save yet
    const title = within(dialog).getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "My edit");
    expect(within(dialog).getByText("Unsaved changes")).toBeInTheDocument();
    await userEvent.click(save);

    expect(await within(dialog).findByText("Someone else changed this record")).toBeInTheDocument();
    expect(screen.queryByText("Resource saved")).not.toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "PUT")?.body).toMatchObject({ title: "My edit", expected_version: 2 });

    api.setCurrent(resource({ title: "Edited by someone else", lock_version: 3 }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Load latest version" }));
    await waitFor(() => expect(within(dialog).getByLabelText("Title")).toHaveValue("Edited by someone else"));
    expect(within(dialog).queryByText("Someone else changed this record")).not.toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText("Title"), " and me");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Resource saved")).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(api.calls.filter((c) => c.method === "PUT")[1].body).toMatchObject({ title: "Edited by someone else and me", expected_version: 3 });
  });

  it("resets unsaved edits back to the loaded version", async () => {
    learningApi();
    const dialog = await openEditor();
    const title = within(dialog).getByLabelText("Title");
    await userEvent.type(title, " (draft)");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reset changes" }));
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Lean canvas basics");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves Russian and Kazakh translations next to the English base text", async () => {
    const { calls } = learningApi({ "PUT /api/admin/resources/7": (body: unknown) => ({ json: resource({ ...(body as object), lock_version: 3 }) }) });
    const dialog = await openEditor();
    await userEvent.click(within(dialog).getByText(/Translations \(0 of 6 filled\)/));
    await userEvent.type(within(dialog).getByLabelText("Title · RU"), "Основы Lean Canvas");
    await userEvent.type(within(dialog).getByLabelText("Title · KK"), "Lean Canvas негіздері");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Resource saved")).toBeInTheDocument();
    const put = calls.find((c) => c.method === "PUT")?.body as { title: string; translations: unknown };
    expect(put.title).toBe("Lean canvas basics");
    expect(put.translations).toEqual({ ru: { title: "Основы Lean Canvas" }, kk: { title: "Lean Canvas негіздері" } });
  });

  it("creates competencies as drafts and shows server validation errors", async () => {
    const calls = mockApi({
      "GET /api/auth/me": { json: me },
      "GET /api/admin/competencies": { json: [competency] },
      "POST /api/admin/competencies": { status: 409, json: { error: { code: "COMPETENCY_CODE_TAKEN", message: "A competency with this code exists." } } },
    });
    renderApp("/admin/competencies");
    await userEvent.click(await screen.findByRole("button", { name: "New competency" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/^Code/), "spotting");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Spotting again");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("A competency with this code already exists.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ code: "spotting", status: "draft", area_id: 1 });
  });
});
