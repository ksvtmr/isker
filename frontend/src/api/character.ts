import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Character } from "../types/api";
import { api } from "./client";
import { keys } from "./keys";

export const characterApi = {
  get: () => api.get<Character>("/api/character"),
  markSeen: (eventId: number) => api.post<{ message: string }>(`/api/character/events/${eventId}/seen`),
};

/** The learner's character stage. Read-only: the stage changes only when the API confirms a new result. */
export const useCharacter = () => useQuery({ queryKey: keys.character, queryFn: characterApi.get });

/** Records that a stage change was shown, so it is not congratulated again after a reload. */
export function useMarkStageSeen() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: characterApi.markSeen, onSuccess: () => qc.invalidateQueries({ queryKey: keys.character }) });
}
