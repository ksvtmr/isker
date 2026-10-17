# Authentication

Isker has one authentication system: server-side sessions referenced by a signed token. Sign-in with a password and
"Continue with Google" both end in the same kind of session; there is no second login system.

## Sign-in methods

| Method | Endpoint | Notes |
|---|---|---|
| Email + password | `POST /api/auth/login` `{email, password, remember_me}` | bcrypt hashes; generic `INVALID_CREDENTIALS` for unknown email or wrong password; rate limited per IP and per account |
| Google (OpenID Connect) | `GET /api/auth/google/start?next&remember` → Google → `GET /api/auth/google/callback` | see below and [google-oauth-setup.md](google-oauth-setup.md) |
| Registration | `POST /api/auth/register` | creates the account with the `user` role only; stores the interface language |

`GET /api/auth/providers` tells the frontend which methods the server offers (`{"password": true, "google": false}`);
the Google button is disabled, with an explanation, when Google is not configured.

## Sessions

Every sign-in creates a `user_sessions` row (id = 256-bit random value). The browser receives:

| Cookie | Content | Flags |
|---|---|---|
| `isker_session` | JWT (HS256) with `sub` (user id), `jti` (session id), `ver` (rotation counter), `iat`, `exp` | `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/` |
| `isker_csrf` | random CSRF token (double-submit, echoed in `X-CSRF-Token`) | readable by the SPA, same lifetime |

The JWT carries no roles or permissions: every request loads the user, the session and the current permissions
from the database, so role changes, suspensions and revocations apply on the next request.

A request is accepted only if the session exists, is not revoked, has not expired and the account is active.

### Durations and "Remember me"

| | Without "Remember me" | With "Remember me" |
|---|---|---|
| Cookie | browser-session cookie (no `Expires`; removed when the browser closes) | persistent cookie, `Expires` = session expiry |
| Server-side session | `SESSION_HOURS` (default 12 h) | `REMEMBER_ME_DAYS` (default 30 days) |
| Expiry enforced | server (`user_sessions.expires_at`) | server |

The checkbox changes real authentication persistence: it is sent as `remember_me` and stored on the session
(`user_sessions.remember`). Nothing is kept in `localStorage`: no password, no token. The password is never stored
in a cookie.

### Rotation and reuse detection

- Cookie sessions are re-issued after `TOKEN_ROTATE_MINUTES` (default 60): the session's `token_version` is
  incremented and a new cookie is set on that response.
- The previous version is still accepted for 60 seconds (parallel requests in flight).
- Presenting an older version means a superseded token was replayed: the whole session is revoked
  (`revoked_reason = token_reuse`), the response is `401 SESSION_REVOKED`, and `auth.token_reuse_detected` is audited.
- Bearer tokens (API clients) are not rotated; a version newer than the session's is rejected.

### Revocation

Sessions are revoked on sign-out, "sign out other devices", password change (all other sessions), password reset
(all sessions), account suspension / deactivation and administrator "revoke sessions". Users see their sessions,
including whether a session is remembered and how it was opened (password / Google), under Settings → Signed-in
devices.

## Google sign-in (OpenID Connect)

Implementation: `app/services/google_oidc.py` (Authlib 1.3.2) and `app/api/routes/oauth.py`.

1. `GET /api/auth/google/start` creates a single-use request in `oauth_states`: SHA-256 of a random `state`, a random
   `nonce`, a PKCE (S256) code verifier, mode (`login`/`link`), `remember`, safe `next` path and the interface
   language; expires after 10 minutes. The raw `state` is also put in an `HttpOnly` cookie scoped to
   `/api/auth/google`. The browser is redirected to Google.
2. `GET /api/auth/google/callback` requires the `state` query parameter to equal the cookie **and** match an unused,
   unexpired stored request (CSRF and login-CSRF protection); it is marked used before anything else.
3. The authorization code is exchanged server-to-server with the PKCE verifier; the client secret never leaves the
   backend.
4. The ID token is verified against Google's published keys: signature, issuer, audience (our client id), expiry,
   issued-at (60 s leeway) and the `nonce`. Nothing sent by the browser about the user is trusted.
5. The account is identified by Google's stable `sub` (`oauth_identities` has unique `(provider, subject)` and
   `(user_id, provider)` constraints):
   - known `sub` → sign in to the linked account (if it is active);
   - unknown `sub`, verified email, no account with that email → create an account with the `user` role, no password,
     email marked verified, language from the request;
   - unknown `sub` and Google says the email is **not verified** → refused (`OAUTH_EMAIL_UNVERIFIED`);
   - unknown `sub` and an account with that email already exists → refused (`OAUTH_ACCOUNT_EXISTS`). Accounts are
     **never linked because the email strings match**; the owner signs in with their password and links Google in
     Settings (`POST /api/auth/google/link`, same flow in `link` mode, bound to the signed-in user).
6. Google never grants roles. Staff accounts can link Google but keep exactly their existing roles.
7. A session is created exactly like a password sign-in (with the chosen "Remember me") and the browser is
   redirected to the safe `next` path or the user's home.

Errors return to `/login?oauth_error=CODE` (or `/settings?oauth_error=CODE` when linking), translated by the frontend:
`GOOGLE_NOT_CONFIGURED`, `OAUTH_CANCELLED`, `OAUTH_STATE_INVALID`, `OAUTH_FAILED`, `OAUTH_EMAIL_UNVERIFIED`,
`OAUTH_ACCOUNT_EXISTS`, `OAUTH_ALREADY_LINKED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_DEACTIVATED`. Failures are audited as
`auth.oauth_failed` with the error code only: never tokens, codes or secrets.

Google-only accounts can set a password within 10 minutes of signing in (`POST /api/auth/set-password`) and can
unlink Google only once they have a password (`CANNOT_UNLINK_LAST_METHOD`).

## Password recovery and verification

- `POST /api/auth/forgot-password` always returns the same response whether or not the account exists. Reset links
  are single use, stored as hashes and expire; using one revokes all sessions.
- Email confirmation links are single use and stored as hashes.
- Emails are written in the account's language (falls back to the request language) — `app/services/email_templates.py`.
- When email delivery isn't configured the UI says so instead of claiming an email was sent.

## Testing

`backend/tests/test_sessions.py` (Remember me, durations, expiry, rotation, reuse detection, logout),
`backend/tests/test_google_oauth.py` (state/nonce/PKCE, ID-token verification with a local RSA key standing in for
Google, account creation, no auto-linking by email, linking, unlinking, suspended accounts, audit without secrets),
`backend/tests/test_auth.py`, `backend/tests/test_security.py`; frontend `src/test/forms.test.tsx` (password
visibility toggle, Remember me, Google button states, OAuth errors).

Google sign-in is verified with these automated tests against a simulated provider. It has **not** been tested
against a live Google project from this repository; configure it as described in
[google-oauth-setup.md](google-oauth-setup.md) and try it before relying on it.
