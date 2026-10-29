/**
 * Thin fetch wrapper. All server calls go through here (never from components directly).
 * Auth uses the httpOnly session cookie set by the API; no token is stored in JS. Unsafe requests echo the readable
 * `isker_csrf` cookie in the X-CSRF-Token header (double-submit CSRF protection, enforced by the API).
 * Exception: a cross-site or standalone build (see TOKEN_AUTH) sends the session token as a Bearer header instead.
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

  /**
   * Field-level validation messages from a 422 response, keyed by field name, in the interface language.
   * The API's (English, Pydantic) texts are never shown: common error kinds are mapped to translated messages and
   * anything else becomes a translated "invalid value".
   */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as FieldErrorDetail[]) {
      if (d && d.field) out[d.field] = translateFieldError(d);
    }
    return out;
  }
}

export interface FieldErrorDetail { field?: string; message?: string; type?: string; ctx?: Record<string, unknown> }

type Rule = [RegExp, string, (m: RegExpMatchArray) => Record<string, unknown>];
const num = (v: string) => Number(v.replace(/[^\d.-]/g, ""));
/** Pydantic v2 message patterns → translation keys in common:validation.server. */
const FIELD_RULES: Rule[] = [
  [/^Field required/i, "required", () => ({})],
  [/^String should have at least (\d+) characters?/i, "minLength", (m) => ({ count: num(m[1]) })],
  [/^String should have at most (\d+) characters?/i, "maxLength", (m) => ({ count: num(m[1]) })],
  [/email/i, "email", () => ({})],
  [/^Input should be greater than or equal to (\S+)/i, "min", (m) => ({ value: num(m[1]) })],
  [/^Input should be greater than (\S+)/i, "greaterThan", (m) => ({ value: num(m[1]) })],
  [/^Input should be less than or equal to (\S+)/i, "max", (m) => ({ value: num(m[1]) })],
  [/^Input should be less than (\S+)/i, "lessThan", (m) => ({ value: num(m[1]) })],
  [/^Input should be a valid (integer|number)/i, "number", () => ({})],
  [/^String should match pattern/i, "pattern", () => ({})],
  [/^List should have at least (\d+) items?/i, "minItems", (m) => ({ count: num(m[1]) })],
  [/^List should have at most (\d+) items?/i, "maxItems", (m) => ({ count: num(m[1]) })],
  [/^Input should be /i, "choice", () => ({})],
];
/** Pydantic error `type`s (when the API includes them) → the same keys. */
const FIELD_TYPES: Record<string, [string, (ctx: Record<string, unknown>) => Record<string, unknown>]> = {
  missing: ["required", () => ({})],
  string_too_short: ["minLength", (c) => ({ count: Number(c.min_length) })],
  string_too_long: ["maxLength", (c) => ({ count: Number(c.max_length) })],
  greater_than_equal: ["min", (c) => ({ value: Number(c.ge) })],
  greater_than: ["greaterThan", (c) => ({ value: Number(c.gt) })],
  less_than_equal: ["max", (c) => ({ value: Number(c.le) })],
  less_than: ["lessThan", (c) => ({ value: Number(c.lt) })],
  int_parsing: ["number", () => ({})],
  float_parsing: ["number", () => ({})],
  string_pattern_mismatch: ["pattern", () => ({})],
  too_short: ["minItems", (c) => ({ count: Number(c.min_length) })],
  too_long: ["maxItems", (c) => ({ count: Number(c.max_length) })],
  enum: ["choice", () => ({})],
  literal_error: ["choice", () => ({})],
};

/** Translated text for one field error from the API. */
export function translateFieldError(d: FieldErrorDetail): string {
  const byType = d.type ? FIELD_TYPES[d.type] : undefined;
  if (byType) return i18n.t(`common:validation.server.${byType[0]}`, byType[1](d.ctx ?? {}));
  const msg = (d.message ?? "").trim();
  for (const [re, key, vars] of FIELD_RULES) {
    const m = msg.match(re);
    if (m) return i18n.t(`common:validation.server.${key}`, vars(m));
  }
  return i18n.t("common:validation.server.invalid");
}

import i18n, { currentLanguage } from "../i18n";

const BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").replace(/\/$/, "");

/**
 * True when the interface is served from another site than the API (GitHub Pages + Render). Browsers may refuse the
 * API's cookies there (Safari, private windows), so the token returned by sign-in is kept for this tab
 * (sessionStorage, or localStorage with "Remember me") and sent as `Authorization: Bearer`; Bearer requests need no
 * CSRF token. The token is revoked by sign-out like a cookie session.
 */
export const CROSS_SITE = BASE !== "";
/**
 * Standalone build (GitHub Pages without a server): the API runs inside the browser (src/standalone/), and requests
 * go to it instead of the network. It has no cookies either, so it uses the same Bearer token as CROSS_SITE.
 */
export const STANDALONE = import.meta.env.VITE_STANDALONE === "true";
/** Session token in JS (Bearer) instead of the httpOnly cookie. */
export const TOKEN_AUTH = CROSS_SITE || STANDALONE;
const TOKEN_KEY = "isker_session";

function storages(): Storage[] {
  try {
    return [window.sessionStorage, window.localStorage];
  } catch {
    return [];
  }
}

export function sessionToken(): string | null {
  for (const st of storages()) {
    try {
      const v = st.getItem(TOKEN_KEY);
      if (v) return v;
    } catch { /* storage blocked: signed out */ }
  }
  return null;
}

/** Stores (or with null, forgets) the cross-site session token. No-op for same-site builds, which use cookies. */
export function setSessionToken(token: string | null, remember = false) {
  if (!TOKEN_AUTH) return;
  const [session, local] = storages();
  for (const st of [session, local]) {
    try { st?.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }
  if (!token) return;
  try { (remember ? local : session)?.setItem(TOKEN_KEY, token); } catch { /* storage blocked: stays signed out */ }
}

/** Codes that mean the stored cross-site token is no longer usable. */
const DEAD_TOKEN_CODES: ReadonlySet<string> = new Set(["INVALID_TOKEN"]);

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const CSRF_COOKIE = "isker_csrf";

export function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** 401 codes that end a signed-in session: the person is sent to sign-in with this code as the explanation. */
export const SIGN_OUT_CODES: ReadonlySet<string> = new Set(["ACCOUNT_SUSPENDED", "ACCOUNT_DEACTIVATED", "SESSION_REVOKED", "SESSION_EXPIRED"]);

let onUnauthorized: ((err: ApiError, path: string) => void) | null = null;
/** Registered by the auth layer so an expired, revoked or blocked session sends the user to /login. */
export function setUnauthorizedHandler(fn: ((err: ApiError, path: string) => void) | null) {
  onUnauthorized = fn;
}

let signOutReason: string | null = null;
/** Why the last signed-in session ended (ACCOUNT_SUSPENDED, …), for the sign-in page; cleared by a new sign-in. */
export const lastSignOutReason = () => signOutReason;
export const clearSignOutReason = () => { signOutReason = null; };

export async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Content (questions, competencies, emails) is localized by the API for the interface language.
  headers["Accept-Language"] = currentLanguage();
  const bearer = TOKEN_AUTH ? sessionToken() : null;
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
  else if (method !== "GET") {
    const token = csrfToken();
    if (token) headers["X-CSRF-Token"] = token;
  }
  try {
    const send = STANDALONE ? (await import("../standalone/bridge")).standaloneFetch : fetch;
    res = await send(BASE + path, {
      method,
      credentials: TOKEN_AUTH ? "omit" : "include",
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
      code: res.status >= 500 ? "INTERNAL_ERROR" : "HTTP_ERROR",
      message: res.status >= 500 ? "Something went wrong on our side. Please try again." : "The request could not be completed.",
    };
    const apiErr = new ApiError(res.status, err);
    if (res.status === 401) {
      if (SIGN_OUT_CODES.has(apiErr.code)) signOutReason = apiErr.code;
      if (bearer && (SIGN_OUT_CODES.has(apiErr.code) || DEAD_TOKEN_CODES.has(apiErr.code))) setSessionToken(null);
      // Sign-in endpoints report their own errors; /me ends the session only for a session-ending code.
      if (!path.startsWith("/api/auth/") || (path === "/api/auth/me" && SIGN_OUT_CODES.has(apiErr.code))) onUnauthorized?.(apiErr, path);
    }
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

/**
 * Human-readable message for any thrown value, in the interface language. Stable error codes from the API are
 * translated by the "errors" namespace; the server message is only a fallback for codes we don't know yet.
 * Never exposes stack traces.
 */
export function errorMessage(e: unknown, fallback?: string): string {
  if (e instanceof ApiError) {
    const details = e.details && typeof e.details === "object" && !Array.isArray(e.details) ? (e.details as Record<string, unknown>) : {};
    const retry = Number(details.retry_after_seconds);
    // Codes the interface doesn't know yet get a translated generic text with the code, never the English message.
    if (!i18n.exists(`errors:${e.code}`)) return i18n.t("common:state.requestFailedCode", { code: e.code });
    return i18n.t(`errors:${e.code}`, {
      ...details,
      minutes: Number.isFinite(retry) ? Math.max(1, Math.ceil(retry / 60)) : 1,
    });
  }
  return fallback ?? i18n.t("errors:INTERNAL_ERROR");
}

/** True when the server refused because the user's plan doesn't include a feature (403 UPGRADE_REQUIRED). */
export function isUpgradeRequired(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === "UPGRADE_REQUIRED";
}
