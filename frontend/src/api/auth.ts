import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthResponse, User } from "../types/api";
import { ApiError, api } from "./client";
import { keys } from "./keys";

export interface Credentials { email: string; password: string }
export interface RegisterInput extends Credentials { full_name: string }

export const authApi = {
  me: () => api.get<User>("/api/auth/me"),
  login: (body: Credentials) => api.post<AuthResponse>("/api/auth/login", body),
  register: (body: RegisterInput) => api.post<AuthResponse>("/api/auth/register", body),
  logout: () => api.post<{ message: string }>("/api/auth/logout"),
  changePassword: (body: { current_password: string; new_password: string }) => api.post<{ message: string }>("/api/auth/password", body),
};

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
