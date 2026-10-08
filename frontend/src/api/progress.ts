import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Dashboard, NotificationItem, ProgressOverview } from "../types/api";
import { api } from "./client";
import { keys } from "./keys";

export const progressApi = {
  dashboard: () => api.get<Dashboard>("/api/dashboard"),
  progress: () => api.get<ProgressOverview>("/api/progress"),
  notifications: () => api.get<NotificationItem[]>("/api/notifications"),
  markRead: (id: number) => api.post<{ message: string }>(`/api/notifications/${id}/read`),
};

export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: progressApi.dashboard });
export const useProgress = () => useQuery({ queryKey: keys.progress, queryFn: progressApi.progress });
export const useNotifications = () => useQuery({ queryKey: keys.notifications, queryFn: progressApi.notifications });
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: progressApi.markRead, onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }) });
}
