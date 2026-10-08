import { useQuery } from "@tanstack/react-query";
import type { CompetencyCatalog, CompetencyDetail, Gap, ProfileOverview } from "../types/api";
import { api } from "./client";
import { keys } from "./keys";

export const competenciesApi = {
  catalog: () => api.get<CompetencyCatalog>("/api/competencies"),
  detail: (key: string) => api.get<CompetencyDetail>(`/api/competencies/${encodeURIComponent(key)}`),
  profile: () => api.get<ProfileOverview>("/api/scores/profile"),
  gaps: () => api.get<Gap[]>("/api/gaps"),
};

export const useCatalog = () => useQuery({ queryKey: keys.catalog, queryFn: competenciesApi.catalog, staleTime: 30 * 60_000 });
export const useScoreProfile = () => useQuery({ queryKey: keys.scoreProfile, queryFn: competenciesApi.profile });
export const useGaps = () => useQuery({ queryKey: keys.gaps, queryFn: competenciesApi.gaps });
export const useCompetencyDetail = (key: string) =>
  useQuery({ queryKey: keys.competency(key), queryFn: () => competenciesApi.detail(key), enabled: !!key });
