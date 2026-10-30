import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AnalysisState, Answer, AssessmentOverview, AttemptResults, AttemptScope, AttemptState, AttemptSummary, User } from "../types/api";
import { api } from "./client";
import { derivedKeys, keys } from "./keys";

export interface AnswerInput { option_id?: number; text_response?: string; position?: number }

export const assessmentsApi = {
  overview: () => api.get<AssessmentOverview>("/api/assessments"),
  start: (scope: AttemptScope = "full", competency_id?: number) =>
    api.post<{ attempt: AttemptSummary; resumed: boolean }>("/api/assessments/attempts", { scope, competency_id }),
  state: (id: number) => api.get<AttemptState>(`/api/assessments/attempts/${id}`),
  saveAnswer: (id: number, questionId: number, body: AnswerInput) =>
    api.put<Answer>(`/api/assessments/attempts/${id}/answers/${questionId}`, body),
  savePosition: (id: number, position: number) => api.put<AttemptSummary>(`/api/assessments/attempts/${id}/position`, { position }),
  submit: (id: number) => api.post<AttemptResults>(`/api/assessments/attempts/${id}/submit`),
  abandon: (id: number) => api.post<AttemptSummary>(`/api/assessments/attempts/${id}/abandon`),
  results: (id: number) => api.get<AttemptResults>(`/api/assessments/attempts/${id}/results`),
  analysis: (id: number) => api.get<AnalysisState>(`/api/assessments/attempts/${id}/analysis`),
  runAnalysis: (id: number, regenerate = false) => api.post<AnalysisState>(`/api/assessments/attempts/${id}/analysis`, { regenerate }),
};

/** Keeps the signed-in user's onboarding state in step right away (routing depends on it), then refetches it. */
function patchMe(qc: ReturnType<typeof useQueryClient>, patch: (u: User) => Partial<User>) {
  qc.setQueryData<User | null>(keys.me, (u) => (u ? { ...u, ...patch(u) } : u));
  void qc.invalidateQueries({ queryKey: keys.me });
}

export const useAssessmentOverview = () => useQuery({ queryKey: keys.assessments, queryFn: assessmentsApi.overview });

export const useAttempt = (id: number) =>
  useQuery({ queryKey: keys.attempt(id), queryFn: () => assessmentsApi.state(id), enabled: Number.isFinite(id), staleTime: Infinity });

export const useResults = (id: number | null) =>
  useQuery({ queryKey: keys.results(id ?? 0), queryFn: () => assessmentsApi.results(id!), enabled: !!id });

export function useStartAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { scope?: AttemptScope; competency_id?: number }) => assessmentsApi.start(v.scope, v.competency_id),
    // A started attempt changes the dashboard ("continue"), the plan banner and the attempt usage counters.
    onSuccess: (res) => {
      patchMe(qc, () => ({ in_progress_attempt_id: res.attempt.id }));
      for (const k of [keys.assessments, keys.dashboard, keys.plan, keys.subscription, keys.entitlements]) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

export function useSubmitAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assessmentsApi.submit,
    onSuccess: (res) => {
      qc.setQueryData(keys.results(res.attempt.id), res);
      patchMe(qc, (u) => ({ in_progress_attempt_id: null, initial_assessment_completed: u.initial_assessment_completed || res.attempt.scope === "full" }));
      derivedKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
  });
}

export function useAbandonAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assessmentsApi.abandon,
    onSuccess: () => {
      patchMe(qc, () => ({ in_progress_attempt_id: null }));
      for (const k of [keys.assessments, keys.dashboard, keys.plan, keys.subscription, keys.entitlements]) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

/** The AI development analysis of a completed attempt; while it is being written, asks again every few seconds. */
export const useAnalysis = (attemptId: number | null) =>
  useQuery({
    queryKey: ["analysis", attemptId],
    queryFn: () => assessmentsApi.analysis(attemptId!),
    enabled: !!attemptId,
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 4000 : false),
  });

/** Generate / retry / regenerate (in the current language). Idempotent on the server: one analysis per attempt. */
export function useRunAnalysis(attemptId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (regenerate: boolean = false) => assessmentsApi.runAnalysis(attemptId!, regenerate),
    onSuccess: (res) => qc.setQueryData(["analysis", attemptId], res),
  });
}
