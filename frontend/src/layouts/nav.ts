/** Navigation ids (from the design system's ISKER_NAV) mapped to routes. */
export const NAV_PATHS: Record<string, string> = {
  dashboard: "/dashboard",
  assessment: "/assessment",
  competencies: "/competencies",
  "development-plan": "/development-plan",
  learning: "/learning",
  practice: "/practice",
  progress: "/progress",
  profile: "/profile",
  settings: "/settings",
  admin: "/admin",
};

export function navIdForPath(pathname: string): string {
  const seg = pathname.split("/")[1] ?? "";
  if (seg === "results") return "assessment";
  return Object.keys(NAV_PATHS).find((id) => NAV_PATHS[id] === `/${seg}`) ?? "dashboard";
}
