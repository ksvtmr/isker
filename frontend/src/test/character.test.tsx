import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { characterApi } from "../api/character";
import { CharacterAvatar } from "../character/CharacterAvatar";
import { CharacterPanel, StageChangeNotice, StageHistory } from "../character/CharacterViews";
import {
  CHARACTER_ASSETS, CHARACTER_STATES, CONTEXT_STATE, MORPH_MS, REACTION_MS, STAGES, assetFor,
} from "../character/config";
import { useCharacterReaction } from "../character/hooks";
import type { Character, StageEvent } from "../types/api";
import { mockApi, renderWithProviders } from "./utils";

const ASSET_DIR = join(__dirname, "../assets/characters");

function event(over: Partial<StageEvent> = {}): StageEvent {
  return {
    id: 1, sequence: 1, stage: 2, previous_stage: null, direction: "initial", score: 40, assessment_score: 40,
    practice_score: null, practice_tasks: 0, trigger: "assessment", attempt_id: 7, rules_version: "stage-v1",
    confirmed_at: "2026-10-01T10:00:00Z", seen: true, ...over,
  };
}

function character(over: Partial<Character> = {}): Character {
  return {
    status: "ready", stage: 2, stage_key: "starter", score: 40, assessment_score: 40, practice_score: null,
    practice_tasks: 0, practice_counted: false, progress_pct: 60, next_stage: 3, points_to_next: 10,
    rules_version: "stage-v1",
    bands: [
      { stage: 1, key: "novice", min: 0, max: 24 }, { stage: 2, key: "starter", min: 25, max: 49 },
      { stage: 3, key: "entrepreneur", min: 50, max: 74 }, { stage: 4, key: "leader", min: 75, max: 100 },
    ],
    basis: { competencies_assessed: 15, competencies_total: 15, competencies_with_evidence: 15, practice_weight: 0.2, practice_min_tasks: 2, attempt_id: 7 },
    pending_event: null, history: [event()], ...over,
  };
}

function mockMatchMedia(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

afterEach(() => vi.useRealTimers());

describe("character assets", () => {
  it("has an illustration for every stage and state, and every file is a valid SVG", () => {
    for (const stage of STAGES) {
      for (const state of CHARACTER_STATES) {
        expect(CHARACTER_ASSETS[`${stage}-${state}`], `stage ${stage} ${state}`).toBeTruthy();
        const file = join(ASSET_DIR, `stage-${stage}-${state}.svg`);
        expect(existsSync(file), file).toBe(true);
        const svg = readFileSync(file, "utf8");
        expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 200 280"/);
        expect(svg.trim().endsWith("</svg>")).toBe(true);
      }
    }
  });
  it("falls back to the stage's idle illustration for an unknown state", () => {
    expect(assetFor(3, "nonexistent" as never)).toBe(CHARACTER_ASSETS["3-idle"]);
  });
});

describe("CharacterAvatar", () => {
  it("describes stage and state for screen readers", () => {
    render(<CharacterAvatar stage={3} state="thinking" />);
    expect(screen.getByRole("img", { name: "Character: Entrepreneur, stage 3 of 4, thinking" })).toBeInTheDocument();
  });
  it("shows a neutral silhouette, not a level, before the first assessment", () => {
    const { container } = render(<CharacterAvatar stage={null} showLabel />);
    expect(screen.getByRole("img", { name: /appears after your first assessment/ })).toBeInTheDocument();
    expect(screen.getByText("No stage yet")).toBeInTheDocument();
    expect(container.querySelector(".ik-char__figure--empty")).not.toBeNull();
  });
  it("keeps its size and shows a fallback when the image fails to load", () => {
    const { container } = render(<CharacterAvatar stage={2} size={160} />);
    fireEvent.error(container.querySelector("img")!);
    const fig = screen.getByRole("img", { name: /Starter/ });
    expect(fig.style.height).toBe("160px");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".ik-char__fallback")).not.toBeNull();
  });
  it("crops small sizes to head and shoulders, shows the full figure when large", () => {
    const { container, rerender } = render(<CharacterAvatar stage={1} size="xs" />);
    expect(container.querySelector(".ik-char__figure--bust")).not.toBeNull();
    rerender(<CharacterAvatar stage={1} size="lg" />);
    expect(container.querySelector(".ik-char__figure--bust")).toBeNull();
    expect(screen.getByRole("img").style.height).toBe("220px");
  });
  it("plays one state animation, and none with reduced motion", () => {
    mockMatchMedia(false);
    const { container, rerender } = render(<CharacterAvatar stage={2} state="happy" />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")!.dataset.anim).toBe("happy");
    rerender(<CharacterAvatar stage={2} state="happy" reducedMotion />);
    expect(container.querySelector("img")!.dataset.anim).toBe("none");
  });
  it("respects prefers-reduced-motion from the system", () => {
    mockMatchMedia(true);
    const { container } = render(<CharacterAvatar stage={2} state="celebrating" />);
    expect(container.querySelector("img")!.dataset.anim).toBe("none");
  });
  it("morphs into a new stage once, then removes the old image", () => {
    mockMatchMedia(false);
    vi.useFakeTimers();
    const { container, rerender } = render(<CharacterAvatar stage={2} />);
    rerender(<CharacterAvatar stage={3} />);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector("img:not(.ik-char__img--out)")!.getAttribute("data-anim")).toBe("morph");
    act(() => { vi.advanceTimersByTime(MORPH_MS + 10); });
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });
  it("changes stage without movement when motion is reduced", () => {
    mockMatchMedia(true);
    const { container, rerender } = render(<CharacterAvatar stage={2} />);
    rerender(<CharacterAvatar stage={3} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: /Entrepreneur/ })).toBeInTheDocument();
  });
});

describe("states follow the screen, not chance", () => {
  it("maps each context to a fixed state", () => {
    expect(CONTEXT_STATE).toEqual({
      dashboard: "idle", assessment: "thinking", results: "confident", "results-low": "supportive",
      learning: "learning", practice: "working", progress: "idle",
    });
  });
  it("a reaction is short and returns to the context state", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCharacterReaction("working"));
    expect(result.current[0]).toBe("working");
    act(() => result.current[1]("happy"));
    expect(result.current[0]).toBe("happy");
    act(() => { vi.advanceTimersByTime((REACTION_MS.happy ?? 0) + 10); });
    expect(result.current[0]).toBe("working");
  });
});

describe("character panel", () => {
  it("asks for the first assessment instead of inventing a stage", () => {
    renderWithProviders(<CharacterPanel c={character({ status: "no_assessment", stage: null, stage_key: null, history: [] })} />);
    expect(screen.getByRole("heading", { name: "Take your first assessment" })).toBeInTheDocument();
    expect(screen.queryByText(/Starter/)).toBeNull();
  });
  it("explains a lack of data", () => {
    renderWithProviders(<CharacterPanel c={character({ status: "insufficient_data", stage: null, stage_key: null, history: [] })} />);
    expect(screen.getByRole("heading", { name: "Not enough data for a stage yet" })).toBeInTheDocument();
  });
  it("shows the stage, progress to the next one, its basis and a recommendation", () => {
    renderWithProviders(<CharacterPanel c={character()} focus={{ name: "Financial literacy" }} />);
    expect(screen.getByRole("heading", { name: /Starter/ })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "60% of the way to the Entrepreneur stage" })).toBeInTheDocument();
    expect(screen.getByText("10 points to the Entrepreneur stage")).toBeInTheDocument();
    expect(screen.getByText(/work on Financial literacy/)).toBeInTheDocument();
    // Stage is named in words and as "n of 4", not by colour alone.
    expect(screen.getAllByText(/Stage 2 of 4/).length).toBeGreaterThan(0);
    expect(screen.getByText(/preliminary product thresholds/)).toBeInTheDocument();
  });
});

describe("stage transitions", () => {
  it("congratulates a confirmed promotion once and records it as shown", async () => {
    const pending = event({ id: 5, sequence: 2, stage: 3, previous_stage: 2, direction: "up", score: 52, seen: false });
    let seen = false;
    const calls = mockApi({
      "GET /api/character": () => ({ json: character({ stage: 3, pending_event: seen ? null : pending }) }),
      "POST /api/character/events/:id/seen": () => { seen = true; return { json: { message: "ok" } }; },
    });
    const first = renderWithProviders(<StageChangeNotice />);
    expect(await screen.findByText("New stage: Entrepreneur")).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST")!.url).toBe("/api/character/events/5/seen");
    // Still visible in this session after the refetch…
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(1));
    expect(screen.getByText("New stage: Entrepreneur")).toBeInTheDocument();
    first.unmount();
    // …but a reload has nothing to congratulate.
    renderWithProviders(<StageChangeNotice />);
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(2));
    expect(screen.queryByText("New stage: Entrepreneur")).toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("describes a lower result neutrally, without celebration", async () => {
    const pending = event({ id: 6, sequence: 2, stage: 1, previous_stage: 2, direction: "down", score: 20, seen: false });
    mockApi({
      "GET /api/character": { json: character({ stage: 1, pending_event: pending }) },
      "POST /api/character/events/:id/seen": { json: { message: "ok" } },
    });
    const { container } = renderWithProviders(<StageChangeNotice />);
    expect(await screen.findByText("Your profile was updated: Novice")).toBeInTheDocument();
    expect(container.querySelector('[data-state="celebrating"]')).toBeNull();
    expect(container.querySelector('[data-state="supportive"]')).not.toBeNull();
  });

  it("does not show a transition on an ordinary dashboard load", async () => {
    const calls = mockApi({ "GET /api/character": { json: character() } });
    renderWithProviders(<StageChangeNotice />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByText(/New stage|profile was updated/)).toBeNull();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows nothing (never a guessed stage) when the character request fails", async () => {
    mockApi({ "GET /api/character": { status: 500, json: { error: { code: "INTERNAL", message: "x" } } } });
    renderWithProviders(<StageChangeNotice />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("stage history", () => {
  it("lists confirmed changes with dates, apart from the current stage", async () => {
    mockApi({
      "GET /api/character": {
        json: character({
          stage: 3, score: 55,
          history: [event(), event({ id: 2, sequence: 2, stage: 3, previous_stage: 2, direction: "up", score: 55, confirmed_at: "2026-10-20T10:00:00Z" })],
        }),
      },
    });
    renderWithProviders(<StageHistory />);
    expect(await screen.findByText("Now: Entrepreneur, stage score 55")).toBeInTheDocument();
    expect(screen.getByText("Starter → Entrepreneur")).toBeInTheDocument();
    expect(screen.getByText("First stage: Starter")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
  });
});

describe("no client-side control over the stage", () => {
  it("the API client can only read the stage and acknowledge a shown change", async () => {
    expect(Object.keys(characterApi).sort()).toEqual(["get", "markSeen"]);
    const calls = mockApi({ "POST /api/character/events/:id/seen": { json: { message: "ok" } } });
    await characterApi.markSeen(3);
    expect(calls[0].body ?? {}).toEqual({});  // nothing about the stage is sent
  });
});
