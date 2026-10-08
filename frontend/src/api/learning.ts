import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Difficulty, Page, ProgressStatus, Resource, ResourceDetail, ResourceType, Task, TaskDetail } from "../types/api";
import { api, qs } from "./client";
import { derivedKeys, keys } from "./keys";

export interface ResourceFilters {
  competency?: string;
  type?: ResourceType | "";
  difficulty?: Difficulty | "";
  max_minutes?: number | "";
  q?: string;
  status?: ProgressStatus | "";
  page?: number;
}

export const learningApi = {
  resources: (f: ResourceFilters) => api.get<Page<Resource>>(`/api/learning/resources${qs({ ...f })}`),
  resource: (id: number) => api.get<ResourceDetail>(`/api/learning/resources/${id}`),
  start: (id: number) => api.post<ResourceDetail>(`/api/learning/resources/${id}/start`),
  progress: (id: number, progress_pct: number) => api.put<ResourceDetail>(`/api/learning/resources/${id}/progress`, { progress_pct }),
  complete: (id: number) => api.post<ResourceDetail>(`/api/learning/resources/${id}/complete`),
};

export const practiceApi = {
  tasks: (competency?: string) => api.get<Task[]>(`/api/practice/tasks${qs({ competency })}`),
  task: (id: number) => api.get<TaskDetail>(`/api/practice/tasks/${id}`),
  start: (id: number) => api.post<TaskDetail>(`/api/practice/tasks/${id}/start`),
  submit: (id: number, response_text: string) => api.post<TaskDetail>(`/api/practice/tasks/${id}/submit`, { response_text }),
  complete: (id: number) => api.post<TaskDetail>(`/api/practice/tasks/${id}/complete`),
};

export const useResources = (f: ResourceFilters) =>
  useQuery({ queryKey: keys.resources(f), queryFn: () => learningApi.resources(f), placeholderData: keepPreviousData });
export const useResource = (id: number) => useQuery({ queryKey: keys.resource(id), queryFn: () => learningApi.resource(id), enabled: Number.isFinite(id) });
export const useTasks = () => useQuery({ queryKey: keys.tasks, queryFn: () => practiceApi.tasks() });
export const useTask = (id: number) => useQuery({ queryKey: keys.task(id), queryFn: () => practiceApi.task(id), enabled: Number.isFinite(id) });

function useResourceMutation(fn: (id: number) => Promise<ResourceDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.setQueryData(keys.resource(r.id), r);
      derivedKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
  });
}

export const useStartResource = () => useResourceMutation(learningApi.start);
export const useCompleteResource = () => useResourceMutation(learningApi.complete);
export function useResourceProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; pct: number }) => learningApi.progress(v.id, v.pct),
    onSuccess: (r) => qc.setQueryData(keys.resource(r.id), r),
  });
}

function useTaskMutation<V>(fn: (v: V) => Promise<TaskDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (t) => {
      qc.setQueryData(keys.task(t.id), t);
      derivedKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
  });
}

export const useStartTask = () => useTaskMutation((id: number) => practiceApi.start(id));
export const useSubmitTask = () => useTaskMutation((v: { id: number; text: string }) => practiceApi.submit(v.id, v.text));
export const useCompleteTask = () => useTaskMutation((id: number) => practiceApi.complete(id));
