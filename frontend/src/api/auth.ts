import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthResponse, SessionInfo, User } from "../types/api";
import { ApiError, api } from "./client";
import { keys } from "./keys";

export interface Credentials { email: string; password: string }
export interface RegisterInput extends Credentials { full_name: string; accept_terms: boolean }
type Msg = { message: string };

export const authApi = {
  me: () => api.get<User>("/api/auth/me"),
  login: (body: Credentials) => api.post<AuthResponse>("/api/auth/login", body),
  register: (body: RegisterInput) => api.post<AuthResponse>("/api/auth/register", body),
  logout: () => api.post<Msg>("/api/auth/logout"),
  changePassword: (body: { current_password: string; new_password: string }) => api.post<Msg>("/api/auth/password", body),
  forgotPassword: (email: string) => api.post<Msg>("/api/auth/forgot-password", { email }),
  resetPassword: (body: { token: string; new_password: string }) => api.post<Msg>("/api/auth/reset-password", body),
  verifyEmail: (token: string) => api.post<Msg>("/api/auth/verify-email", { token }),
  resendVerification: () => api.post<Msg>("/api/auth/resend-verification"),
  sessions: () => api.get<SessionInfo[]>("/api/auth/sessions"),
  revokeSession: (id: string) => api.del<Msg>(`/api/auth/sessions/${encodeURIComponent(id)}`),
  revokeOtherSessions: () => api.post<Msg>("/api/auth/sessions/revoke-others"),
  deactivate: (password: string) => api.post<Msg>("/api/auth/deactivate", { password }),
};

/** Permission check for UI decisions only — the API enforces every permission itself. */
export function can(user: User | null | undefined, permission: string): boolean {
  return !!user?.permissions?.includes(permission);
}

export const hasAdminAccess = (user: User | null | undefined) => can(user, "admin.access");

/** Human label for the highest role (sidebar, badges). */
export function roleLabel(user: User | null | undefined): string {
  const r = user?.roles ?? [];
  if (r.includes("super_admin")) return "Super administrator";
  if (r.includes("admin")) return "Administrator";
  if (r.includes("support")) return "Support";
  if (r.includes("content_manager")) return "Content manager";
  return "Learner";
}

/** Current user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await authApi.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      qc.clear();
      qc.setQueryData(keys.me, data.user);
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: (data) => {
      qc.clear();
      qc.setQueryData(keys.me, data.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      qc.clear();
      qc.setQueryData(keys.me, null);
    },
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: authApi.changePassword });
}

export function useSessions() {
  return useQuery({ queryKey: ["sessions"], queryFn: authApi.sessions });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: authApi.revokeSession, onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: authApi.revokeOtherSessions, onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) });
}

export function useResendVerification() {
  return useMutation({ mutationFn: authApi.resendVerification });
}

export function useDeactivateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.deactivate,
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(keys.me, null);
    },
  });
}
