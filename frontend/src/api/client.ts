/**
 * Thin fetch wrapper. All server calls go through here (never from components directly).
 * Auth uses the httpOnly session cookie set by the API; no token is stored in JS. Unsafe requests echo the readable
 * `isker_csrf` cookie in the X-CSRF-Token header (double-submit CSRF protection, enforced by the API).
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }

  /** Field-level validation messages from a 422 response, keyed by field name. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as { field?: string; message?: string }[]) {
      if (d.field && d.message) out[d.field] = d.message.replace(/^Value error, /, "");
    }
    return out;
  }
}

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const CSRF_COOKIE = "isker_csrf";

export function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

let onUnauthorized: (() => void) | null = null;
/** Registered by the auth layer so an expired session sends the user to /login. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    const token = csrfToken();
    if (token) headers["X-CSRF-Token"] = token;
  }
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: "include",
      headers: Object.keys(headers).length ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, { code: "NETWORK_ERROR", message: "We couldn't reach Isker. Check your connection and try again." });
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as { error?: ApiErrorBody } | null)?.error ?? {
      code: "HTTP_ERROR",
      message: res.status >= 500 ? "Something went wrong on our side. Please try again." : "The request could not be completed.",
    };
    const apiErr = new ApiError(res.status, err);
    if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized?.();
    throw apiErr;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Human-readable message for any thrown value. Never exposes stack traces. */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof ApiError) return e.message;
  return fallback;
}

/** True when the server refused because the user's plan doesn't include a feature (403 UPGRADE_REQUIRED). */
export function isUpgradeRequired(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === "UPGRADE_REQUIRED";
}
