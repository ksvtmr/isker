/** AI development analysis panel: requested automatically, pending, failed with retry, and real links only. */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AnalysisPanel } from "../components/AnalysisPanel";
import { mockApi, renderWithProviders } from "./utils";

const comp = (code: string, name: string, score: number) => ({ code, name, score, evidence_level: "sufficient" });
const ready = {
  status: "succeeded", attempt_id: 5, language: "en", error_code: null, provider: "gemini", model: "gemini-test", rule_based: false, runs: 1,
  completed_at: "2026-10-29T10:00:00Z",
  analysis: {
    summary: "Your overall score is 64 out of 100.",
    strengths: [{ ...comp("creativity", "Creativity", 82), explanation: "Strong idea generation." }],
    development_areas: [{ ...comp("planning", "Planning and management", 41), explanation: "Largest gap.", priority: 1 }],
    competency_insights: [],
    recommended_actions: [
      { competency: comp("planning", "Planning and management", 41), kind: "learn", reason: "Matches your level.", resource: { id: 12, title: "Project planning basics", type: "article", minutes: 20, available: true }, task: null },
      { competency: comp("planning", "Planning and management", 41), kind: "practice", reason: "Apply it.", resource: null, task: { id: 3, title: "Plan a launch", minutes: 45, available: false } },
    ],
    milestones: [{ ...comp("planning", "Planning and management", 41), objective: "Raise Planning from 41 to 60", measure: "Reassess", target_weeks: 6 }],
    confidence_notes: ["Scores are estimates."],
    reassessment_weeks: 6,
  },
};

describe("AnalysisPanel", () => {
  it("requests the analysis once when none exists and shows the result", async () => {
    let posts = 0;
    mockApi({
      "GET /api/assessments/attempts/5/analysis": { json: { status: "none", attempt_id: 5 } },
      "POST /api/assessments/attempts/5/analysis": () => { posts++; return { json: ready }; },
    });
    renderWithProviders(<AnalysisPanel attemptId={5} />);
    expect(await screen.findByText("Your overall score is 64 out of 100.")).toBeInTheDocument();
    expect(posts).toBe(1);
    expect(screen.getByText("AI model: gemini-test")).toBeInTheDocument();
    // A real, available resource is a link; an unavailable task is not.
    expect(screen.getByRole("link", { name: "Project planning basics" })).toHaveAttribute("href", "/learning/12");
    expect(screen.queryByRole("link", { name: "Plan a launch" })).not.toBeInTheDocument();
    expect(screen.getByText("Raise Planning from 41 to 60")).toBeInTheDocument();
    expect(screen.getByText("A reassessment is useful in about 6 weeks.")).toBeInTheDocument();
  });

  it("shows a pending state while the analysis is being written", async () => {
    mockApi({ "GET /api/assessments/attempts/5/analysis": { json: { status: "pending", attempt_id: 5 } } });
    renderWithProviders(<AnalysisPanel attemptId={5} />);
    expect(await screen.findByText(/Analysing your results/)).toBeInTheDocument();
  });

  it("keeps results and offers a retry when the analysis failed", async () => {
    mockApi({
      "GET /api/assessments/attempts/5/analysis": { json: { status: "failed", attempt_id: 5, error_code: "rate_limited" } },
      "POST /api/assessments/attempts/5/analysis": { json: ready },
    });
    renderWithProviders(<AnalysisPanel attemptId={5} />);
    expect(await screen.findByText(/The AI service is busy/)).toBeInTheDocument();
    expect(screen.getByText(/Your assessment results are saved and not affected/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Your overall score is 64 out of 100.")).toBeInTheDocument());
  });

  it("offers to rewrite an analysis written in another language", async () => {
    mockApi({ "GET /api/assessments/attempts/5/analysis": { json: { ...ready, language: "kk" } } });
    renderWithProviders(<AnalysisPanel attemptId={5} />);
    expect(await screen.findByText("This analysis was written in Қазақша.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write it in the current language" })).toBeInTheDocument();
  });
});
