import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AssessmentRunner, isAnswered } from "../pages/AssessmentRunner";
import type { Question } from "../types/api";
import { mockApi, renderWithProviders } from "./utils";

const questions: Question[] = [
  { id: 11, index: 0, type: "likert", section: "Self-assessment", text: "I notice unmet needs.", help_text: null, min_length: 0,
    options: [{ id: 1, label: "Disagree" }, { id: 2, label: "Agree" }] },
  { id: 12, index: 1, type: "open", section: "Open answers", text: "Describe how you would validate an idea.", help_text: null, min_length: 20, options: [] },
];
const attempt = { id: 5, scope: "full", competency: null, status: "in_progress", current_index: 0, answered: 0, total: 2, sequence: 1, overall_score: null, started_at: "2026-01-01", completed_at: null };

describe("isAnswered", () => {
  it("requires an option for choice and min length for open questions", () => {
    expect(isAnswered(questions[0], undefined)).toBe(false);
    expect(isAnswered(questions[0], { option_id: 2 })).toBe(true);
    expect(isAnswered(questions[1], { text: "too short" })).toBe(false);
    expect(isAnswered(questions[1], { text: "x".repeat(20) })).toBe(true);
  });
});

describe("assessment runner", () => {
  it("autosaves answers, validates, and submits to results", async () => {
    const calls = mockApi({
      "GET /api/assessments/attempts/:id": { json: { attempt, questions, answers: [] } },
      "PUT /api/assessments/attempts/:id/answers/:q": (b: unknown) => ({ json: { question_id: 0, option_id: null, text_response: null, updated_at: "now", ...(b as object) } }),
      "PUT /api/assessments/attempts/:id/position": { json: attempt },
      "POST /api/assessments/attempts/:id/submit": { json: { attempt: { ...attempt, status: "completed" }, profile: {}, measured: [] } },
    });
    renderWithProviders(<AssessmentRunner />, { route: "/assessment/5", path: "/assessment/:id" });

    expect(await screen.findByText("Question 1 of 2")).toBeInTheDocument();
    // The competency being measured is never shown on the question screen.
    expect(screen.queryByText(/Spotting/)).toBeNull();
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Agree/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/answers/11"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/answers/11"))!.body).toMatchObject({ option_id: 2, position: 0 });
    expect(cont).toBeEnabled();
    await userEvent.click(cont);

    expect(await screen.findByText("Question 2 of 2")).toBeInTheDocument();
    const finish = screen.getByRole("button", { name: "Finish" });
    await userEvent.type(screen.getByLabelText("Your answer"), "short");
    expect(finish).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Your answer"), " but now it is long enough");
    expect(finish).toBeEnabled();
    await userEvent.click(finish);
    await userEvent.click(await screen.findByRole("button", { name: "See my results" }));
    await waitFor(() => expect(screen.getAllByTestId("location")[0]).toHaveTextContent("/results?attempt=5"));
    expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/answers/12") && (c.body as { text_response: string }).text_response.includes("long enough"))).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/submit"))).toBe(true);
  });

  it("resumes at the saved question with saved answers", async () => {
    mockApi({
      "GET /api/assessments/attempts/:id": { json: { attempt: { ...attempt, current_index: 1 }, questions,
        answers: [{ question_id: 11, option_id: 2, text_response: null, updated_at: "x" }, { question_id: 12, option_id: null, text_response: "I would interview ten customers", updated_at: "x" }] } },
    });
    renderWithProviders(<AssessmentRunner />, { route: "/assessment/5", path: "/assessment/:id" });
    expect(await screen.findByText("Question 2 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Your answer")).toHaveValue("I would interview ten customers");
  });
});
