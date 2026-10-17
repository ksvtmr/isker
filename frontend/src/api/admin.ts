import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Competency, Difficulty, QuestionType, ResourceType } from "../types/api";
import type { Page } from "../types/api";
import type { PlanAdmin, PlanEntitlementInput } from "./adminManage";
import { ApiError, api, qs } from "./client";
import { derivedKeys, keys } from "./keys";

/** Draft → Published → Archived. Only published content is visible to learners; archived keeps history. */
export type ContentStatus = "draft" | "published" | "archived";
export const CONTENT_STATUSES: ContentStatus[] = ["draft", "published", "archived"];
/** Translated texts of the ru/kk interface; English is the base text in the normal fields. */
export type TranslationLang = "ru" | "kk";
export type Translations = Partial<Record<TranslationLang, Record<string, unknown>>>;

/** Optimistic locking: every editable record carries `lock_version`; edits send it back as `expected_version`. */
export interface VersionedRecord { lock_version: number; translations: Translations | null }

export interface AdminCompetency extends Competency, VersionedRecord {
  area_id: number;
  reflection_prompt: string | null;
  learning_priority: number;
  sort_order: number;
  status: ContentStatus;
}

export interface CompetencyInput {
  code: string; area_id: number; name: string; short_name: string; description: string; hint?: string | null;
  reflection_prompt?: string | null; importance?: number; learning_priority?: number; default_target?: number;
  status?: ContentStatus; translations?: Translations | null;
}

export type CompetencyUpdate = Partial<Omit<CompetencyInput, "code">> & { expected_version?: number };

export type PlanWithVersion = PlanAdmin & Partial<VersionedRecord>;

/** True when the server refused a save because someone else changed the record first (409 VERSION_CONFLICT). */
export function isVersionConflict(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === "VERSION_CONFLICT";
}

export interface AdminStats {
  users: number;
  onboarded_users: number;
  completed_attempts: number;
  in_progress_attempts: number;
  average_overall: number | null;
  ai_evaluations: number;
  ai_fallbacks: number;
  resources_completed: number;
  tasks_completed: number;
  competency_averages: { code: string; name: string; average: number | null; measurements: number }[];
}

export interface RubricItem { criterion: string; description: string; competency?: string | null; keywords?: string[] }

export interface AdminQuestion {
  id: number;
  assessment_id: number;
  sort_order: number;
  type: QuestionType;
  section: string;
  text: string;
  help_text: string | null;
  reverse_scored: boolean;
  min_length: number;
  is_active: boolean;
  status: ContentStatus;
  lock_version: number;
  version: number;
  previous_id: number | null;
  translations: Translations | null;
  options: { id: number; label: string; score: number; value: number | null; translations?: Translations | null }[];
  competencies: { competency_id: number; weight: number }[];
  rubric: RubricItem[];
  answer_count: number;
  /** Set when the save created a new version: the id of the replaced (now archived) version. */
  replaced_id?: number | null;
}

export interface QuestionInput {
  assessment_id: number;
  type: QuestionType;
  section: string;
  text: string;
  help_text?: string | null;
  reverse_scored?: boolean;
  min_length?: number;
  is_active?: boolean;
  status?: ContentStatus;
  translations?: Translations | null;
  expected_version?: number;
  options: { label: string; score: number; value?: number | null; translations?: Translations | null }[];
  competencies: { competency_id: number; weight: number }[];
  rubric: RubricItem[];
}

export interface AdminAssessment {
  id: number;
  code: string;
  title: string;
  description: string;
  estimated_minutes: number;
  version: number;
  is_active: boolean;
  lock_version: number;
  translations: Translations | null;
  question_count: number;
  attempt_count: number;
}

export interface AssessmentUpdate { title?: string; description?: string; estimated_minutes?: number; is_active?: boolean; translations?: Translations | null; expected_version?: number }

export interface ResourceInput {
  slug: string;
  competency_id: number;
  title: string;
  description: string;
  type: ResourceType;
  difficulty: Difficulty;
  duration_minutes: number;
  content: string;
  url?: string | null;
  is_published?: boolean;
  status?: ContentStatus;
  translations?: Translations | null;
  expected_version?: number;
}
export interface AdminResource extends Omit<ResourceInput, "translations" | "expected_version">, VersionedRecord { id: number; is_published: boolean; status: ContentStatus }

export interface TaskInput {
  slug: string;
  competency_id: number;
  title: string;
  description: string;
  instructions: string;
  difficulty: Difficulty;
  duration_minutes: number;
  rubric: RubricItem[];
  min_length: number;
  is_published?: boolean;
  status?: ContentStatus;
  translations?: Translations | null;
  expected_version?: number;
}
export interface AdminTask extends Omit<TaskInput, "translations" | "expected_version">, VersionedRecord { id: number; is_published: boolean; status: ContentStatus }

/** Entities whose publication status the content editor can change. */
export type StatusEntity = "competencies" | "questions" | "resources" | "tasks";
export interface StatusChange { entity: StatusEntity; id: number; status: ContentStatus; expected_version?: number }

export interface AIEvaluationRow {
  id: number;
  user_id: number | null;
  input_type: string;
  provider: string;
  model: string;
  status: "success" | "retried" | "fallback";
  competency_id: number | null;
  prompt_version_id: number | null;
  score: number | null;
  level: string | null;
  confidence: number | null;
  attempts: number;
  latency_ms: number | null;
  error: string | null;
  input_excerpt: string | null;
  output: Record<string, unknown> | null;
  created_at: string;
}

export interface PromptVersion {
  id: number;
  key: string;
  version: number;
  system_prompt: string;
  user_template: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export const adminApi = {
  stats: () => api.get<AdminStats>("/api/admin/stats"),
  competencies: () => api.get<AdminCompetency[]>("/api/admin/competencies"),
  createCompetency: (body: CompetencyInput) => api.post<AdminCompetency>("/api/admin/competencies", body),
  updateCompetency: (id: number, body: CompetencyUpdate) => api.put<AdminCompetency>(`/api/admin/competencies/${id}`, body),
  setStatus: ({ entity, id, status, expected_version }: StatusChange) =>
    api.post<{ id: number; status: ContentStatus; lock_version: number }>(`/api/admin/${entity}/${id}/status`, { status, expected_version }),
  questions: () => api.get<AdminQuestion[]>("/api/admin/questions"),
  createQuestion: (body: QuestionInput) => api.post<AdminQuestion>("/api/admin/questions", body),
  updateQuestion: (id: number, body: QuestionInput) => api.put<AdminQuestion>(`/api/admin/questions/${id}`, body),
  deactivateQuestion: (id: number) => api.del<{ message: string }>(`/api/admin/questions/${id}`),
  assessments: () => api.get<AdminAssessment[]>("/api/admin/assessments"),
  createAssessment: (body: { code: string; title: string; description: string; estimated_minutes: number; is_active: boolean }) =>
    api.post<AdminAssessment>("/api/admin/assessments", body),
  updateAssessment: (id: number, body: AssessmentUpdate) => api.put<AdminAssessment>(`/api/admin/assessments/${id}`, body),
  /** Plan edit with optimistic locking and name/description translations. */
  updatePlan: (id: number, body: { name?: string; description?: string | null; price_cents?: number; currency?: string; billing_interval?: string; trial_days?: number;
    is_active?: boolean; sort_order?: number; entitlements?: PlanEntitlementInput[]; translations?: Translations | null; expected_version?: number; reason: string }) =>
    api.patch<PlanWithVersion>(`/api/admin/plans/${id}`, body),
  resources: () => api.get<AdminResource[]>("/api/admin/resources"),
  createResource: (body: ResourceInput) => api.post<AdminResource>("/api/admin/resources", body),
  updateResource: (id: number, body: ResourceInput) => api.put<AdminResource>(`/api/admin/resources/${id}`, body),
  unpublishResource: (id: number) => api.del<{ message: string }>(`/api/admin/resources/${id}`),
  tasks: () => api.get<AdminTask[]>("/api/admin/tasks"),
  createTask: (body: TaskInput) => api.post<AdminTask>("/api/admin/tasks", body),
  updateTask: (id: number, body: TaskInput) => api.put<AdminTask>(`/api/admin/tasks/${id}`, body),
  unpublishTask: (id: number) => api.del<{ message: string }>(`/api/admin/tasks/${id}`),
  evaluations: (status: string, page: number) => api.get<Page<AIEvaluationRow>>(`/api/admin/ai/evaluations${qs({ status, page })}`),
  prompts: () => api.get<PromptVersion[]>("/api/admin/ai/prompts"),
  createPrompt: (body: { key: string; system_prompt: string; user_template: string; notes?: string; activate: boolean }) =>
    api.post<PromptVersion>("/api/admin/ai/prompts", body),
  activatePrompt: (id: number) => api.post<PromptVersion>(`/api/admin/ai/prompts/${id}/activate`),
};

export const useAdminStats = () => useQuery({ queryKey: keys.admin("stats"), queryFn: adminApi.stats });
export const useAdminCompetencies = () => useQuery({ queryKey: keys.admin("competencies"), queryFn: adminApi.competencies });
export const useAdminQuestions = () => useQuery({ queryKey: keys.admin("questions"), queryFn: adminApi.questions });
export const useAdminAssessments = () => useQuery({ queryKey: keys.admin("assessments"), queryFn: adminApi.assessments });
export const useAdminResources = () => useQuery({ queryKey: keys.admin("resources"), queryFn: adminApi.resources });
export const useAdminTasks = () => useQuery({ queryKey: keys.admin("tasks"), queryFn: adminApi.tasks });
export const useAdminEvaluations = (status: string, page: number) =>
  useQuery({ queryKey: keys.admin("evaluations", status, page), queryFn: () => adminApi.evaluations(status, page) });
export const useAdminPrompts = () => useQuery({ queryKey: keys.admin("prompts"), queryFn: adminApi.prompts });

/** Learner-side queries that show admin-edited content (catalogue, learning, practice, assessments, plans). */
export const learnerContentKeys: readonly (readonly unknown[])[] = [keys.catalog, keys.plans, ...derivedKeys];

/**
 * Admin mutation. After the API confirms, every admin query and every learner query that shows content is
 * invalidated, so both the editor and the platform refetch the saved state (nothing is updated optimistically).
 */
export function useAdminMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["admin"] }), ...learnerContentKeys.map((queryKey) => qc.invalidateQueries({ queryKey }))]);
    },
  });
}
