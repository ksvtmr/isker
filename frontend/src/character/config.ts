/**
 * Character progression: presentation config. The stage itself always comes from the API (GET /api/character); this
 * file only maps stages and interface contexts to illustrations, names and states. Nothing here computes a stage.
 */
import type { CharacterStage } from "../types/api";

export const STAGES: readonly CharacterStage[] = [1, 2, 3, 4];
export const STAGE_KEYS: Record<CharacterStage, "novice" | "starter" | "entrepreneur" | "leader"> = {
  1: "novice", 2: "starter", 3: "entrepreneur", 4: "leader",
};

export const CHARACTER_STATES = ["idle", "happy", "thinking", "confident", "learning", "celebrating", "working", "supportive"] as const;
export type CharacterState = (typeof CHARACTER_STATES)[number];

/** Where the character appears, and which state fits there (never chosen at random). */
export type CharacterContext = "dashboard" | "assessment" | "results" | "results-low" | "learning" | "practice" | "progress";
export const CONTEXT_STATE: Record<CharacterContext, CharacterState> = {
  dashboard: "idle",
  assessment: "thinking",
  results: "confident",
  "results-low": "supportive",
  learning: "learning",
  practice: "working",
  progress: "idle",
};
/** Results below this overall score get the calm, supportive character instead of the confident one. */
export const SUPPORTIVE_BELOW = 40;

/** Short reactions: how long they last before the character returns to the context state. */
export const REACTION_MS: Partial<Record<CharacterState, number>> = { happy: 1600, celebrating: 2400 };
/** Stage morph duration (ms), within the 400–900 ms the design asks for. */
export const MORPH_MS = 700;

export const SIZES = { xs: 56, sm: 88, md: 160, lg: 220 } as const;
export type CharacterSize = keyof typeof SIZES;

/**
 * Illustrations, bundled by Vite: a missing file fails the build instead of producing a broken path at runtime.
 * File name: stage-<1–4>-<state>.svg (viewBox 0 0 200 280). Replace a file to change the art; no code changes.
 */
const files = import.meta.glob<string>("../assets/characters/stage-*.svg", { eager: true, query: "?url", import: "default" });

export const CHARACTER_ASSETS: Partial<Record<`${CharacterStage}-${CharacterState}`, string>> = {};
for (const [path, url] of Object.entries(files)) {
  const m = /stage-(\d)-(\w+)\.svg$/.exec(path);
  if (m) CHARACTER_ASSETS[`${m[1]}-${m[2]}` as `${CharacterStage}-${CharacterState}`] = url;
}

export function assetFor(stage: CharacterStage, state: CharacterState): string | undefined {
  return CHARACTER_ASSETS[`${stage}-${state}`] ?? CHARACTER_ASSETS[`${stage}-idle`];
}
