import type { Difficulty, GapBand, Level, ResourceType } from "../types/api";

export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  article: "Article", video: "Video", course: "Course", exercise: "Exercise", case_study: "Case study", template: "Template",
};

export const RESOURCE_TYPE_ICON: Record<ResourceType, string> = {
  article: "file-text", video: "circle-play", course: "graduation-cap", exercise: "dumbbell", case_study: "file-stack", template: "layout-template",
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

export const AREA_COLOR: Record<string, string> = {
  ideas: "var(--domain-ideas)", resources: "var(--domain-resources)", action: "var(--domain-action)",
};

export const gapLabel = (b: GapBand | null | undefined): "High" | "Medium" | "Low" =>
  b === "high" ? "High" : b === "medium" ? "Medium" : "Low";

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", opts);
}

export const shortMonth = (iso: string) => formatDate(iso, { month: "short" });

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

export function signed(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return n > 0 ? `+${n}` : `${n}`;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function confidenceLabel(c: number | null | undefined): string | undefined {
  if (c === null || c === undefined) return undefined;
  return c >= 0.75 ? "High" : c >= 0.55 ? "Medium" : "Low";
}

export const LEVEL_ORDER: Level[] = ["Foundation", "Developing", "Intermediate", "Advanced", "Proficient"];
