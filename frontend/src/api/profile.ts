import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExperienceLevel, Goal, LearningFormat, Profile, User } from "../types/api";
import { api } from "./client";
import { derivedKeys, keys } from "./keys";

export interface OnboardingInput {
  full_name: string;
  education: string;
  background?: string;
  entrepreneurial_experience: ExperienceLevel;
  business_experience?: string;
  goal_codes: string[];
  preferred_learning_format: LearningFormat;
  weekly_learning_minutes: number;
}

export type ProfileUpdate = Partial<OnboardingInput> & {
  language?: string;
  notify_reassessment?: boolean;
  notify_weekly_summary?: boolean;
};

export const profileApi = {
  goals: () => api.get<Goal[]>("/api/goals"),
  get: () => api.get<Profile>("/api/profile"),
  onboarding: (body: OnboardingInput) => api.post<Profile>("/api/profile/onboarding", body),
  update: (body: ProfileUpdate) => api.put<Profile>("/api/profile", body),
  deleteAccount: () => api.del<{ message: string }>("/api/users/me"),
};

export const useGoals = () => useQuery({ queryKey: keys.goals, queryFn: profileApi.goals, staleTime: Infinity });
export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: profileApi.get });

export function useOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: profileApi.onboarding,
    onSuccess: (p) => {
      qc.setQueryData(keys.profile, p);
      qc.setQueryData<User | null | undefined>(keys.me, (u) => (u ? { ...u, onboarding_completed: true, full_name: p.full_name } : u));
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: profileApi.update,
    onSuccess: (p) => {
      qc.setQueryData(keys.profile, p);
      qc.setQueryData<User | null | undefined>(keys.me, (u) => (u ? { ...u, full_name: p.full_name } : u));
      derivedKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: profileApi.deleteAccount,
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(keys.me, null);
    },
  });
}
