import i18n from "../i18n";
import type { Difficulty, GapBand, Level, ResourceType } from "../types/api";

export { formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent } from "../i18n/format";
import { formatDate } from "../i18n/format";

/** Display labels for API enum values (the values themselves are never translated). */
export const resourceTypeLabel = (t: ResourceType) => i18n.t(`common:resourceTypes.${t}`);
export const difficultyLabel = (d: Difficulty) => i18n.t(`common:difficulty.${d}`);
export const levelLabel = (l: Level | string) => i18n.t(`common:levels.${l}`, { defaultValue: l });

export const RESOURCE_TYPE_ICON: Record<ResourceType, string> = {
  article: "file-text", video: "circle-play", course: "graduation-cap", exercise: "dumbbell", case_study: "file-stack", template: "layout-template",
};

export const AREA_COLOR: Record<string, string> = {
  ideas: "var(--domain-ideas)", resources: "var(--domain-resources)", action: "var(--domain-action)",
};

/** Canonical gap key used by the design system (it translates the label itself). */
export const gapLabel = (b: GapBand | null | undefined): "High" | "Medium" | "Low" =>
  b === "high" ? "High" : b === "medium" ? "Medium" : "Low";

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
  return i18n.t(h < 12 ? "common:greeting.morning" : h < 18 ? "common:greeting.afternoon" : "common:greeting.evening");
}

export function confidenceLabel(c: number | null | undefined): string | undefined {
  if (c === null || c === undefined) return undefined;
  return i18n.t(c >= 0.75 ? "common:confidence.high" : c >= 0.55 ? "common:confidence.medium" : "common:confidence.low");
}

export const LEVEL_ORDER: Level[] = ["Foundation", "Developing", "Intermediate", "Advanced", "Proficient"];
