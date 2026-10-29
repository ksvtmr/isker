import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthResponse, SessionInfo, User } from "../types/api";
import { ApiError, TOKEN_AUTH, api, clearSignOutReason, setSessionToken } from "./client";
import { keys } from "./keys";
import i18n from "../i18n";
import type { Language } from "../i18n/config";

export interface Credentials { email: string; password: string }
export interface LoginInput extends Credentials { remember_me: boolean }
export interface RegisterInput extends Credentials { full_name: string; accept_terms: boolean; language?: Language }
/** Success message from the API: `code` is translated in the auth namespace, `message` is the English fallback. */
export type Msg = { message: string; code?: string | null; count?: number | null };
export interface Providers { password: boolean; google: boolean }

export const authApi = {
  me: () => api.get<User>("/api/auth/me"),
  login: (body: LoginInput) => api.post<AuthResponse>("/api/auth/login", body),
  // Google sign-in ends on the API's own site (cookie session), so token builds offer password sign-in only.
  providers: () => api.get<Providers>("/api/auth/providers").then((p) => (TOKEN_AUTH ? { ...p, google: false } : p)),
  googleLink: () => api.post<{ url: string }>("/api/auth/google/link"),
  googleUnlink: () => api.del<User>("/api/auth/google"),
  setPassword: (new_password: string) => api.post<Msg>("/api/auth/set-password", { new_password }),
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

/** Localized label for the highest role (sidebar, badges). */
export function roleLabel(user: User | null | undefined): string {
  const r = user?.roles ?? [];
  const top = ["super_admin", "admin", "support", "content_manager"].find((k) => r.includes(k)) ?? "user";
  return i18n.t(`common:roles.${top}`);
}

/** Text for an API success message, in the interface language. */
export function messageText(msg: Msg | undefined | null): string {
  if (!msg) return "";
  if (!msg.code) return msg.message;
  return i18n.t(`auth:messages.${msg.code}`, { count: msg.count ?? undefined, defaultValue: msg.message });
}

/** Full-page navigation to the backend, which redirects to Google (the OAuth flow never runs in the browser). */
export function googleStartUrl(next: string | null, remember: boolean): string {
  const q = new URLSearchParams({ remember: String(remember) });
  if (next) q.set("next", next);
  return `/api/auth/google/start?${q.toString()}`;
}

export function useProviders() {
  return useQuery({ queryKey: ["auth-providers"], queryFn: authApi.providers, staleTime: 10 * 60_000, retry: false });
}

export function useSetPassword() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: authApi.setPassword, onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }) });
}

export function useGoogleUnlink() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: authApi.googleUnlink, onSuccess: (u) => qc.setQueryData(keys.me, u) });
}

/**
 * Current user, or null when signed out. Refetched when the tab regains focus and every minute while signed in, so
 * role, status and language changes made by an administrator reach open tabs (the API re-checks every request).
 */
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
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
    refetchInterval: (q) => (q.state.data ? 60_000 : false),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (data, input) => {
      setSessionToken(data.access_token, input.remember_me);
      clearSignOutReason();
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
      setSessionToken(data.access_token);
      clearSignOutReason();
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
      setSessionToken(null);
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
