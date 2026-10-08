import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Activity, Plan, Recommendation } from "../types/api";
import { api } from "./client";
import { derivedKeys, keys } from "./keys";

export const recommendationsApi = {
  list: () => api.get<Recommendation[]>("/api/recommendations"),
  regenerate: () => api.post<Recommendation[]>("/api/recommendations/regenerate"),
  plan: () => api.get<Plan>("/api/plan"),
  reflect: (activityId: number, text: string) => api.post<Activity>(`/api/plan/activities/${activityId}/reflection`, { text }),
};

export const usePlan = () => useQuery({ queryKey: keys.plan, queryFn: recommendationsApi.plan });
export const useRecommendations = () => useQuery({ queryKey: keys.recommendations, queryFn: recommendationsApi.list });

export function useReflect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { activityId: number; text: string }) => recommendationsApi.reflect(v.activityId, v.text),
    onSuccess: () => derivedKeys.forEach((k) => qc.invalidateQueries({ queryKey: k })),
  });
}

export function useRegenerate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recommendationsApi.regenerate,
    onSuccess: () => derivedKeys.forEach((k) => qc.invalidateQueries({ queryKey: k })),
  });
}
