# Isker full system audit

Audit date: 12–17 October 2026. Branch `claude/sleepy-darwin-ycx2me` ([PR #1](https://github.com/ksvtmr/isker/pull/1)).
Companion documents: [localization-audit.md](localization-audit.md), [admin-platform-consistency.md](admin-platform-consistency.md),
[test-results.md](test-results.md), [remediation-plan.md](remediation-plan.md), [glossary.md](glossary.md).

Everything below is based on reading the code and on tests that were actually run (see test-results.md). Nothing
is described as working unless a test or an end-to-end run exercised it.

## 1. Scope and inspected modules

| Area | Inspected |
|---|---|
| Backend | FastAPI app `backend/app`: 121 API operations on 106 paths (auth 20, admin 58, learner and other 43), middleware, error handling, rate limiting, sessions, OAuth, RBAC, entitlements, payments webhooks, AI service and providers, seed, maintenance |
| Database | 42 tables, Alembic migrations 0001–0006, constraints, foreign keys, cascades, timezone handling |
| Frontend | React + TypeScript SPA `frontend/src`: 42 route entries, learner pages, admin pages, guards, react-query caching, i18n (11 namespaces) |
| Design system | `design-system/components.tsx`, `styles.css` (strings, accessibility of shared components) |
| Localization | ru/kk/en interface keys, server-generated texts, database content translations, emails, AI language |
| Deployment | `docker-entrypoint.sh`, `docker-compose.yml`, `render.yaml`, `frontend/nginx.conf`, `.env.example` |
| Tests | 18 backend test files, 12 frontend test files, 2 browser end-to-end scripts |

Method: four read-only audits ran in parallel (security and authentication; database and API consistency;
frontend routes, workflows and static localization; dynamic content and AI localization). Each finding names a
file, a line and a concrete failure path. Findings were then fixed in three tracks (backend integrity and
security, backend localization and AI, frontend), each with regression tests, and the whole system was verified
end to end in a browser in all three languages.

## 2. Architecture findings

* **One source of truth.** PostgreSQL holds all users, content, results and subscriptions. The admin panel and
  the learner platform use the same API and the same tables; no mock data or parallel user store exists in
  production paths (confirmed by the audit: no hardcoded fake data or placeholder arrays).
* **Authentication** is server-side sessions referenced by a signed token in an httpOnly cookie; permissions are
  loaded from the database on every request (not cached in the token), so role changes and blocks apply on the
  next request.
* **Localization** has three layers: interface strings (i18next, 11 namespaces, 2 197 keys per language);
  server-composed texts (`app/core/i18n.py`, rendered at read time from stored numbers and ids); database content
  (`translations` JSON per row, English base, swapped in on load for learner requests).
* **Concurrency** is handled with optimistic locking (`lock_version`) for admin edits, partial unique indexes for
  "one open attempt / one current subscription / one default plan", and conditional updates for single-use
  operations.
* **Weak points found** (all addressed below or listed in the remediation plan): race conditions returning 500,
  history-destroying cascades, client IP derived from a spoofable header, column-level queries that bypassed
  content translation, AI output stored without language checks, and a few UI routes and permissions that did
  not match the backend.

## 3. Defects discovered and fixed

Severity: **High** — wrong data, money or access, or a core journey blocked. **Medium** — incorrect behaviour or
security weakness with a realistic path. **Low** — hardening, consistency or polish. No critical defect (data loss,
authentication bypass, privilege escalation) was found.

### 3.1 Data integrity and API

| ID | Sev. | Defect | Root cause | Fix |
|---|---|---|---|---|
| D1 | High | A payment renewal arriving just after the period end left a paying user expired | lazy expiry ran before the renewal branch; EXPIRED was terminal | renewal by payment reactivates (only if no other current subscription); failed webhooks stored as `failed` and retryable; bad `user_id` → 422 |
| D2 | High | Double submit of an assessment returned 500 | status check without lock; unique violation on scores | attempt claimed with a conditional UPDATE; loser gets 409 `ATTEMPT_NOT_IN_PROGRESS` |
| D3 | Medium | Two "start" clicks created two open attempts (and spent quota) | check-then-insert, no DB rule | partial unique index (one in-progress attempt per user) + resume on conflict; migration 0005 abandons older duplicates |
| D4 | Medium | Concurrent requests on register, profile, goals, learning progress, practice submissions returned 500 | check-then-insert without conflict handling | savepoints + re-read; register → 409 `EMAIL_TAKEN` |
| D5 | Medium | Archiving a resource/task that was a step of a learner's active plan made the plan impossible to finish (reassessment stayed locked) | archived items refused for start/complete | archived items that are still a step of *that learner's* active plan stay usable; hidden for everyone else |
| D6 | Medium | `plan.personalized` entitlement could be switched off but did nothing | never checked | enforced on plan and recommendation endpoints |
| D7 | Medium | Per-criterion AI ratings could be assigned to the wrong criterion | ratings matched by position | matched by normalized name in any language, position only as fallback |
| D8 | Medium | Analytics counted admin-granted plans as paid | source ignored | only `source = payment` counts as paid |
| D9 | Medium | Two current subscriptions or two default plans possible | no DB constraint | partial unique indexes + row lock in `assign()`; migration cleans duplicates by expiring them (with an event), never deleting |
| D10 | Low | Deleting content would delete score history | `ON DELETE CASCADE` from content to history tables | 7 foreign keys switched to `RESTRICT` (user-side cascades unchanged) |
| D11 | Low | Wrong status codes (500) on null plan fields, concurrent Google link; OAuth state consumed non-atomically | missing validation / handling | 422 validation, redirect with `OAUTH_ALREADY_LINKED`, atomic conditional UPDATE |
| D12 | Low | Frontend types disagreed with API (`Profile.language`, `Feedback.level`, `SessionInfo`) | drift | types aligned; empty level no longer rendered |
| — | Medium | Admin stats, analytics and user goals showed English names to ru/kk admins | queries selected columns (`Competency.name`), which bypasses translation | queries load entities (found by the three-language end-to-end check) |
| — | Medium | Learning search matched only English titles | SQL `ILIKE` on base columns | search matches the localized text and the English base |
| — | Medium | Learning filters were lost on refresh and links with filters were ignored | filters kept in component state | filters live in the URL |

### 3.2 Security

| ID | Sev. | Defect | Fix |
|---|---|---|---|
| F1 | Medium | IP rate limits bypassable with a forged `X-Forwarded-For` (uvicorn `--forwarded-allow-ips="*"` takes the left-most entry); limiter memory unbounded | client IP taken `TRUSTED_PROXY_HOPS` from the right; limiter prunes idle keys |
| F2 | Medium | A superseded session token was still accepted as a Bearer token for up to 30 days | the same reuse check (with grace period) now applies to Bearer tokens |
| F3 | Medium | Unlimited AI evaluation calls per user (cost) | per-user rate limit `ai_user` (30/hour) |
| F4 | Low | `/google/start` unthrottled and filled `oauth_states`; no purge of expired rows | rate limit + `maintenance.purge_expired()` (states, old sessions, used/expired tokens), run every 30 min or via CLI |
| F5 | Low | Published admin/demo emails could be locked out (successful logins counted) | only failed logins count, per email+IP with a softer per-email cap |
| F6 | Low | Anyone could change the shared demo account (password, close, Google link) | `DEMO_READ_ONLY` (default on): 403 `DEMO_ACCOUNT_READ_ONLY` |
| F7 | Low | docker-compose exposed PostgreSQL on all interfaces | bound to 127.0.0.1 |
| F8 | Low | Staff email change kept the user's sessions and reset links; self email change allowed | sessions and pending links revoked, old address notified, self-change refused |
| F9 | Low | Staff could grant themselves a paid plan | refused (`SELF_ACTION_FORBIDDEN`) |
| F10 | Low | Two super admins could remove each other concurrently | super-admin rows locked before counting |
| F12 | Low | `COOKIE_SECURE=false` and localhost CORS origins accepted in production; API docs always public | production refuses insecure cookies, drops localhost origins; `API_DOCS_ENABLED` (off in production by default) |

Checked and found correct: bcrypt hashing with timing-safe unknown-email path; hashed single-use reset and
verification tokens; session expiry and revocation on suspend, password change and reset; CSRF on every unsafe
method; strict CSP; Google OIDC (state bound to a cookie, nonce, PKCE, ID-token verification, no auto-linking by
email, no roles from OAuth); object-level authorization (no IDOR found); no `dangerouslySetInnerHTML`, all SQL
parameterized; no secrets in API responses or logs; payment webhook signatures.

### 3.3 Localization

See [localization-audit.md](localization-audit.md). Fixed: AI and rule-based feedback, recommendation reasons,
insights and evidence in the request language; AI output language validated; stored texts kept in the English
base; Kazakh tokenizer and keyword matching; stale-translation tracking; translation completeness report and admin
page; consistent fallback chain; untranslated help text on 25 questions; Kazakh dates in browsers without Kazakh
locale data; raw English server messages and audit codes in the admin UI; terminology unified with a glossary.

### 3.4 UX and accessibility (frontend)

| Sev. | Defect | Fix |
|---|---|---|
| High | `/plans` linked from public pages but required sign-in | public page; signed-in users see their plan inside the app |
| High | AI prompt actions shown to users without `ai.manage` (silent 403) | gated by permission, confirmation, errors shown |
| High | Question editor attached new questions to assessment id 1 | assessment picker, no hardcoded id |
| Medium | Restart, start attempt and reading progress did not refresh dashboard, plan and usage counters | cache invalidation |
| Medium | Admin guard redirected to login on network errors | retry state |
| Medium | Saved language not applied in the admin area | language sync for all signed-in layouts |
| Medium | Placeholder support address and demo credentials shown as real | configurable (`VITE_SUPPORT_EMAIL`, `VITE_SHOW_DEMO`), hidden when unset |
| Medium | Learners saw "test AI" engine details | only "rule-based feedback" vs "AI feedback" |
| Medium | Admin dashboard value column squeezed by long Russian labels | proportional columns |
| Low | Missing empty states, editors discarding unsaved edits, unvalidated admin forms, colour-only status, tabs without keyboard support, toast live region hidden, new-tab links unannounced, no page titles | fixed (see test-results.md for coverage) |

## 4. Remaining limitations

Listed with priority and verification in [remediation-plan.md](remediation-plan.md). The most important:

* Google sign-in, SMTP email delivery and real AI providers were verified only with automated tests against
  simulated providers; they need real credentials and a live check before relying on them.
* No online payment provider is integrated; plans are granted by administrators (stated in the UI).
* Russian and Kazakh content translations have not been reviewed by native-speaking subject-matter experts.
* Rate limiting is in-memory per process (single instance only).
* Live updates use polling (30 s and on focus), not push.
