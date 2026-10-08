import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Competency, Difficulty, Page, QuestionType, ResourceType, Role } from "../types/api";
import { api, qs } from "./client";
import { keys } from "./keys";

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

export interface AdminUser {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  onboarding_completed: boolean;
  created_at: string;
  last_login_at: string | null;
  completed_attempts: number;
  latest_overall: number | null;
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
  options: { id: number; label: string; score: number; value: number | null }[];
  competencies: { competency_id: number; weight: number }[];
  rubric: RubricItem[];
  answer_count: number;
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
  options: { label: string; score: number; value?: number | null }[];
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
  question_count: number;
  attempt_count: number;
}

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
  is_published: boolean;
}
export interface AdminResource extends ResourceInput { id: number }

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
  is_published: boolean;
}
export interface AdminTask extends TaskInput { id: number }

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
  users: (q: string, page: number) => api.get<Page<AdminUser>>(`/api/admin/users${qs({ q, page })}`),
  competencies: () => api.get<Competency[]>("/api/admin/competencies"),
  updateCompetency: (id: number, body: Partial<Competency> & { reflection_prompt?: string; learning_priority?: number }) =>
    api.put<Competency>(`/api/admin/competencies/${id}`, body),
  questions: () => api.get<AdminQuestion[]>("/api/admin/questions"),
  createQuestion: (body: QuestionInput) => api.post<AdminQuestion>("/api/admin/questions", body),
  updateQuestion: (id: number, body: QuestionInput) => api.put<AdminQuestion>(`/api/admin/questions/${id}`, body),
  deactivateQuestion: (id: number) => api.del<{ message: string }>(`/api/admin/questions/${id}`),
  assessments: () => api.get<AdminAssessment[]>("/api/admin/assessments"),
  createAssessment: (body: { code: string; title: string; description: string; estimated_minutes: number; is_active: boolean }) =>
    api.post<AdminAssessment>("/api/admin/assessments", body),
  updateAssessment: (id: number, body: Partial<AdminAssessment>) => api.put<AdminAssessment>(`/api/admin/assessments/${id}`, body),
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
export const useAdminUsers = (q: string, page: number) =>
  useQuery({ queryKey: keys.admin("users", q, page), queryFn: () => adminApi.users(q, page) });
export const useAdminCompetencies = () => useQuery({ queryKey: keys.admin("competencies"), queryFn: adminApi.competencies });
export const useAdminQuestions = () => useQuery({ queryKey: keys.admin("questions"), queryFn: adminApi.questions });
export const useAdminAssessments = () => useQuery({ queryKey: keys.admin("assessments"), queryFn: adminApi.assessments });
export const useAdminResources = () => useQuery({ queryKey: keys.admin("resources"), queryFn: adminApi.resources });
export const useAdminTasks = () => useQuery({ queryKey: keys.admin("tasks"), queryFn: adminApi.tasks });
export const useAdminEvaluations = (status: string, page: number) =>
  useQuery({ queryKey: keys.admin("evaluations", status, page), queryFn: () => adminApi.evaluations(status, page) });
export const useAdminPrompts = () => useQuery({ queryKey: keys.admin("prompts"), queryFn: adminApi.prompts });

/** Generic admin mutation that refreshes all admin queries. */
export function useAdminMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }) });
}
