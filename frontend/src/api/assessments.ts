import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Answer, AssessmentOverview, AttemptResults, AttemptScope, AttemptState, AttemptSummary } from "../types/api";
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
};

export const useAssessmentOverview = () => useQuery({ queryKey: keys.assessments, queryFn: assessmentsApi.overview });

export const useAttempt = (id: number) =>
  useQuery({ queryKey: keys.attempt(id), queryFn: () => assessmentsApi.state(id), enabled: Number.isFinite(id), staleTime: Infinity });

export const useResults = (id: number | null) =>
  useQuery({ queryKey: keys.results(id ?? 0), queryFn: () => assessmentsApi.results(id!), enabled: !!id });

export function useStartAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { scope?: AttemptScope; competency_id?: number }) => assessmentsApi.start(v.scope, v.competency_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.assessments }),
  });
}

export function useSubmitAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assessmentsApi.submit,
    onSuccess: (res) => {
      qc.setQueryData(keys.results(res.attempt.id), res);
      derivedKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
  });
}

export function useAbandonAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assessmentsApi.abandon,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.assessments }),
  });
}
