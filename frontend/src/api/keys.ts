/** Central TanStack Query keys, so mutations can invalidate exactly what changed. */
export const keys = {
  me: ["me"] as const,
  profile: ["profile"] as const,
  goals: ["goals"] as const,
  dashboard: ["dashboard"] as const,
  catalog: ["catalog"] as const,
  scoreProfile: ["scores", "profile"] as const,
  gaps: ["gaps"] as const,
  competency: (key: string) => ["competency", key] as const,
  assessments: ["assessments"] as const,
  attempt: (id: number) => ["attempt", id] as const,
  results: (id: number) => ["results", id] as const,
  recommendations: ["recommendations"] as const,
  plan: ["plan"] as const,
  resources: (filters: object) => ["resources", filters] as const,
  resource: (id: number) => ["resource", id] as const,
  tasks: ["tasks"] as const,
  task: (id: number) => ["task", id] as const,
  progress: ["progress"] as const,
  notifications: ["notifications"] as const,
  admin: (...parts: unknown[]) => ["admin", ...parts] as const,
};

/** Everything derived from the competency profile / plan. Invalidated after assessments and learning. */
export const derivedKeys = [
  keys.dashboard, keys.scoreProfile, keys.gaps, keys.recommendations, keys.plan, keys.progress, keys.assessments,
  ["competency"], ["resources"], ["resource"], keys.tasks, ["task"], keys.notifications,
];
