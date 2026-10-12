# Admin panel, user management, UX/accessibility and security overhaul — report

Date: 12 October 2026 · Branch: `claude/sleepy-darwin-ycx2me`
Companion documents: [platform-audit.md](platform-audit.md) (the state before), [api.md](api.md),
[database.md](database.md), [testing.md](testing.md), [../DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md).

This report describes what was built and what was verified. It is not a security certification or a compliance
statement. No external penetration test or formal WCAG audit was performed.

---

## 1. What existed before

- Registration, login and logout with an httpOnly JWT cookie; a `role` column with two values (`user`, `admin`);
  `is_active` flag; a `revoked_tokens` deny-list for logout only.
- An admin area made of tabs inside the learner shell: statistics, competencies, questions, assessments, resources
  and tasks, a read-only user list and AI governance. Every admin could do everything.
- No password reset, email verification, terms acceptance, session management, plans or subscriptions.
- No rate limiting, CSRF protection, security headers or request size limit. The audit log could be updated or deleted,
  and its rows were rewritten when a user was deleted. Self-service deletion was immediate and irreversible.
- Accessibility: good basics (skip link, focus management, labelled inputs) but low-contrast text in the design
  system and no automated accessibility tests.

The full audit (findings S1–S12, UX and accessibility issues, technical debt) is in [platform-audit.md](platform-audit.md).

## 2. What was implemented

### 2.1 Accounts and authentication (one auth system, extended — not replaced)
- **Registration** requires accepting the Terms of Use and Privacy Policy (`accept_terms`, stored with the terms
  version and time). Duplicate emails → `409 EMAIL_TAKEN`. Server-side validation for every field.
- **Sessions**: every JWT carries a `jti` that is a row in `user_sessions` (device, IP, last activity, expiry).
  Sessions are revoked on logout, password change (other devices), password reset (all), suspension, deactivation
  and by staff ("sign out everywhere"). Users can see and revoke their devices in Settings.
- **Cookies**: `isker_session` (httpOnly, SameSite=Lax, Secure in production) + `isker_csrf` (readable) for
  double-submit **CSRF** protection on POST/PUT/PATCH/DELETE. Bearer-token API clients are exempt (not exposed to CSRF).
  Tokens are not stored in `localStorage`.
- **Login** runs bcrypt even for unknown emails (no timing enumeration), is rate limited per IP and per email,
  rejects suspended/deactivated accounts with a clear message, and audits failures without the password.
- **Forgot/reset password**: identical `202` response whether or not the email exists; single-use, hashed
  (SHA-256), expiring tokens; reset revokes all sessions.
- **Email verification**: hashed single-use tokens; resend from a banner or Settings; optional
  `REQUIRE_EMAIL_VERIFICATION`.
- **Honest email**: an email abstraction with `smtp`, `console` (development only — writes the message to the server
  log) and `disabled`. The API reports what actually happened (`sent`, `logged`, `unavailable`) and the UI shows it.
  Nothing claims an email was sent when it was not.
- **Account lifecycle**: `status` = active / suspended / deactivated (with reason and time). Users close their own
  account (password required → deactivated, data kept). Permanent deletion is a separate super-admin workflow that is
  only possible for deactivated accounts and requires typing the account email.

### 2.2 Roles and permissions (RBAC)
Central policy in `backend/app/services/permissions.py`; routes declare the permission they need
(`require_permission`). Deny by default; denials are audited (`access.denied`).

| Permission | user | content_manager | support | admin | super_admin |
|---|:-:|:-:|:-:|:-:|:-:|
| admin.access (open admin area) | | ✓ | ✓ | ✓ | ✓ |
| analytics.view | | | | ✓ | ✓ |
| users.view, users.view_details | | | ✓ | ✓ | ✓ |
| users.support (password reset link, sign out everywhere) | | | ✓ | ✓ | ✓ |
| users.manage (edit, suspend, reactivate, deactivate) | | | | ✓ | ✓ |
| users.delete (permanent deletion) | | | | | ✓ |
| roles.view, roles.assign | | | | ✓ | ✓ |
| roles.manage (edit role permissions) | | | | | ✓ |
| plans.view | | ✓ | ✓ | ✓ | ✓ |
| plans.manage | | | | ✓ | ✓ |
| subscriptions.view | | | ✓ | ✓ | ✓ |
| subscriptions.manage | | | | ✓ | ✓ |
| content.manage (competencies, questions, assessments, resources, tasks) | | ✓ | | ✓ | ✓ |
| ai.view / ai.manage | | ✓ / – | | ✓ / ✓ | ✓ / ✓ |
| audit.view, settings.view | | | | ✓ | ✓ |

Additional rules, enforced on the server:
- Ranks: user 0, content_manager/support 10, admin 20, super_admin 30. Staff can act only on accounts ranked below
  them and grant/revoke only roles ranked below their own (super_admin excepted).
- Nobody can change their own roles, suspend or delete themselves through staff tools.
- The last active super administrator can't be demoted, suspended, deactivated or deleted (`409 LAST_SUPER_ADMIN`).
- The `super_admin` role always has every permission; `users.delete` and `roles.manage` can't be granted to other roles.
- Role permissions (except super_admin) can be edited by super administrators in `/admin/roles`; custom roles
  can be created through the API (`POST /api/admin/roles`).

### 2.3 Plans, subscriptions and entitlements
- **Plans** (`subscription_plans` + `plan_entitlements`) are editable in `/admin/plans`: name, description, price,
  interval, availability and per-feature on/off and limits. Defaults:

  | Feature | Free (default) | Pro ($9/month) | Premium ($90/year) |
  |---|---|---|---|
  | Full assessments | 2 per 30 days | unlimited | unlimited |
  | Competency reassessment | ✓ | ✓ | ✓ |
  | Personalised development plan | ✓ | ✓ | ✓ |
  | Advanced learning resources | – | ✓ | ✓ |
  | Practical tasks started | 3 per 30 days | unlimited | unlimited |
  | AI feedback on practice | ✓ | ✓ | ✓ |
  | Full progress history | latest 2 measurements | ✓ | ✓ |
  | Data export | ✓ | ✓ | ✓ |

  Free keeps the whole Assess → Profile → Plan → Learn → Practice → Reassess journey usable.
- **Statuses**: trialing, active, past_due, canceled, expired, incomplete, with explicit allowed transitions
  (invalid ones → `409 INVALID_TRANSITION`). Expiry is applied lazily whenever a subscription is read (and swept before
  admin lists and analytics); expiring writes an event.
- **Admin operations**: grant/change plan (optionally time-limited or as a trial), extend, cancel now or at period end,
  change status. Each writes a `subscription_events` row (actor, reason, source, dates) and an audit entry.
- **Entitlement service** (`backend/app/services/entitlements.py`) is the only place that decides access.
  `GET /api/entitlements/me` lists features with usage. Enforced in: starting assessments, opening advanced resources,
  starting practice tasks, AI feedback, progress history, data export. Refusals → `403 UPGRADE_REQUIRED`; the UI shows
  "Not included in your plan" with a link to `/plans` (never a broken page).
- **Payments**: no provider is integrated. `/plans` says so ("Online payment isn't available yet") and there is no
  checkout button. A provider-neutral webhook endpoint verifies HMAC signatures with a 5-minute replay window, processes
  each event id once (`payment_webhook_events`), and is refused until configured. No card data is accepted or stored.

### 2.4 Audit log
- Columns: actor, action, target type and id, outcome (success/failure/denied), reason, request id, IP, details, time.
- Sensitive keys (password, token, secret, hash, authorization, cookie) are stripped from details automatically.
- Written in the same transaction as the business change; failures and denials are written in their own transaction
  so they persist even when the request fails.
- Append-only: PostgreSQL trigger rejects UPDATE/DELETE/TRUNCATE. Actor/target are plain ids, so deleting a user keeps
  the audit trail without keeping their email or name.
- Viewable only with `audit.view` at `/admin/audit-logs` (filters: action group, outcome, actor, target, dates,
  security events only).

### 2.5 HTTP hardening
- Security headers on every response: CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`;
  styles allow `'unsafe-inline'` because design-system components use inline style attributes), `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cache-Control: no-store` on the
  API, HSTS when cookies are secure.
- Request id on every response (`X-Request-ID`), stored in audit rows.
- 1 MB request body limit (`413 PAYLOAD_TOO_LARGE`).
- Rate limits (per IP and per account) on login, registration, forgot/reset password, verification, resend and
  password change → `429 RATE_LIMITED` + `Retry-After`.
- CORS: explicit origins only (`*` refused), credentials allowed, `X-CSRF-Token` header allowed.
- Errors keep one envelope; 500s never include stack traces.

### 2.6 Admin panel
A dedicated admin shell (design-system `AdminLayout`) with a sidebar that shows only the sections the person may use.
Every route is also guarded by its permission in the UI and, independently, on the server.

| Route | Purpose | Permission |
|---|---|---|
| `/admin` | Dashboard: users (total/active/suspended/closed), active in 7 days, completed assessments and completion rate, free/paid/granted/expired/canceled subscriptions, registrations chart, learning activity, recent admin actions, security events — all from the database, with empty states | admin.access (figures need analytics.view) |
| `/admin/users` | Search, filters (role, status, plan, registration dates, last activity), sortable columns, pagination; state kept in the URL | users.view |
| `/admin/users/:id` | Profile, assessments, competency profile, learning/practice, subscription and history, roles, sessions, audit trail; actions: edit, suspend/reactivate, deactivate, sign out everywhere, send reset link, grant/revoke roles, grant/extend/cancel/change plan, permanent deletion | users.view_details (+ action permissions) |
| `/admin/roles` | Permission matrix per role; super admins edit role permissions (reason required) | roles.view |
| `/admin/subscriptions` | All subscriptions with status/plan/source/expiry filters | subscriptions.view |
| `/admin/plans` | Plan catalogue, create and edit plans and limits | plans.view / plans.manage |
| `/admin/assessments` | Assessments and question bank (tabs) | content.manage |
| `/admin/competencies` | Competency model | content.manage |
| `/admin/learning-resources` | Resources and practical tasks | content.manage |
| `/admin/analytics` | 7/30/90-day window, registrations, journey funnel, subscriptions, average score per competency | analytics.view |
| `/admin/ai` | AI evaluations and prompt versions | ai.view (changes: ai.manage) |
| `/admin/audit-logs` | Audit log with filters and event details | audit.view |
| `/admin/settings` | Read-only configuration status (security, email, AI, payments); never returns secrets | settings.view |

Old paths `/admin/questions` and `/admin/resources` redirect to the new ones.

Every sensitive action uses `ConfirmActionDialog`: reason required (stored in the audit log), type-to-confirm for
permanent deletion, server errors shown inside the dialog, success shown only after the API confirms. Content actions
that hide material from learners (unpublish, deactivate) now also ask for confirmation.

### 2.7 Learner-facing UX
- `/register` with terms checkbox and links; `/forgot-password`, `/reset-password`, `/verify-email`, `/terms`,
  `/privacy`, `/plans`.
- Email-confirmation banner (dismissible; result text comes from the server).
- Dashboard journey stepper (Assess → Review profile → Learn & practise → Reassess) showing what is done and the next step.
- Settings: account and email status, plan and usage, password change, signed-in devices, data export, close account
  (password confirmation) — replacing the old immediate hard delete.
- Locked advanced resources are labelled "Pro" with a "See plans" link; progress explains when only the latest two
  measurements are shown.
- Staff land in `/admin` after sign-in; learners can't reach it.

### 2.8 Design system additions
`AdminLayout`, `DataTable` (caption, `aria-sort`, link-based rows), `Pagination`, `Breadcrumbs`, `Badge`,
`ConfirmActionDialog`, `PermissionGuard`, `Stepper`, `KeyValueList`, `BarChart` (with a hidden data table), and new
icons. Contrast fixes in existing components (see §5). Documented in `DESIGN_SYSTEM.md`.

## 3. Database migrations

`backend/alembic/versions/0002_rbac_sessions_subscriptions_audit.py`

- New tables: `permissions`, `roles`, `role_permissions`, `user_roles`, `user_sessions`,
  `email_verification_tokens`, `password_reset_tokens`, `subscription_plans`, `plan_entitlements`,
  `user_subscriptions`, `subscription_events`, `payment_webhook_events` (40 tables in total).
- Data migration: every user gets `user`; former `admin` accounts get `super_admin`; `is_active=false` → `deactivated`;
  audit columns renamed with values copied; FK from audit to users removed on purpose.
- Destructive steps, with justification: `users.role` and `users.is_active` are dropped after their values are copied;
  `revoked_tokens` is dropped (it only held ids of expired or logged-out JWTs; users sign in again).
- Backup strategy: `pg_dump -Fc` before upgrading (documented in `database.md`); `alembic downgrade 0001` maps data back.
- PostgreSQL trigger makes `audit_logs` append-only.
- **Verified**: upgrade on a copy of a populated local database (5 users incl. an admin, 45 audit rows) →
  roles and statuses correct, audit rows preserved; downgrade to 0001 → `role`/`is_active` restored with the same values;
  upgrade again; `alembic check` reports no drift; the production Docker image migrates an empty database from scratch.

## 4. API

92 paths in total; full list in [api.md](api.md) (generated from OpenAPI by `backend/scripts/gen_docs.py`). New:

- Auth: `POST /api/auth/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification`,
  `/sessions/revoke-others`, `/deactivate`; `GET /api/auth/sessions`; `DELETE /api/auth/sessions/{id}`.
  `POST /api/auth/register` now requires `accept_terms`; `GET /api/auth/me` returns `status`, `roles`, `permissions`,
  `email_verified`.
- Billing: `GET /api/plans` (public), `GET /api/entitlements/me`, `GET /api/subscription/me`, `GET /api/export/me`,
  `POST /api/billing/webhooks/{provider}`.
- Admin users: `GET /api/admin/users` (filters, sort, pagination), `GET|PATCH|DELETE /api/admin/users/{id}`,
  `POST …/suspend`, `…/reactivate`, `…/deactivate`, `…/revoke-sessions`, `…/password-reset`, `POST …/roles`,
  `DELETE …/roles/{role_key}`.
- Admin billing: `GET|POST /api/admin/plans`, `PATCH /api/admin/plans/{id}`, `GET /api/admin/subscriptions`,
  `GET /api/admin/subscription-events`, `POST /api/admin/users/{id}/subscriptions`,
  `POST /api/admin/subscriptions/{id}/extend|cancel|status`.
- Admin system: `GET /api/admin/me`, `GET /api/admin/analytics/overview`, `GET /api/admin/permissions`,
  `GET|POST /api/admin/roles`, `PUT /api/admin/roles/{id}/permissions`, `GET /api/admin/audit-logs`,
  `GET /api/admin/settings`.
- Removed: `DELETE /api/users/me` (immediate hard delete) → replaced by `POST /api/auth/deactivate` plus the
  admin deletion workflow. `GET /api/admin/users` changed shape (role → roles, status, plan).

## 5. Security issues found and fixed

| Id | Finding (from the audit) | Status | Evidence |
|---|---|---|---|
| S1 | No rate limiting | **Fixed** | `test_login_is_rate_limited_per_email` (429 + Retry-After); observed in the browser run |
| S2 | No CSRF protection | **Fixed** (double-submit token) | `test_cookie_requests_without_csrf_header_are_rejected`, browser check (403 without header) |
| S3 | Coarse admin authorization | **Fixed** (RBAC, ranks, self/last-super-admin rules) | `test_rbac.py` (15 tests), `admin.test.tsx` |
| S4 | Sessions not revocable | **Fixed** (`user_sessions`) | session tests in `test_security.py`; suspension signs the user out (browser run) |
| S5 | Login timing enumeration | **Fixed** (dummy bcrypt) | code review; not measured statistically |
| S6 | Mutable, incomplete audit log | **Fixed** (outcome, reason, request id, trigger, no FK) | trigger verified manually (`DELETE` → "audit_logs is append-only"); audit tests |
| S7 | Missing security headers | **Fixed** | `test_security_headers_and_request_id`; headers checked on the production image |
| S8 | No request size limit | **Fixed** (1 MB) | `test_request_body_size_limit` |
| S9 | Immediate hard deletion | **Fixed** (deactivate; super-admin deletion workflow) | `test_close_account_requires_password_and_signs_out`, `test_deletion_workflow` |
| S10 | Insecure cookie default | **Fixed** (Secure automatically in production) | production container sets `HttpOnly; Secure; SameSite=lax` |
| S11 | CORS wildcard accepted | **Fixed** (refused) | `test_production_rejects_wildcard_cors` |
| S12 | Registration reveals existing emails | **Accepted trade-off**, now rate limited | `409` kept for usability; password reset never reveals accounts |

Also checked: IDOR on attempts, sessions and admin user details (tests return 404/403); self-escalation through extra
fields in registration and profile payloads (ignored); XSS — React escapes output, learning content is rendered by the
design system's Markdown subset without HTML, CSP blocks inline scripts (the browser test had to bypass CSP to inject
axe, which confirms it is active); secrets never returned by `/api/admin/settings`; password hashes and tokens never
returned by any endpoint tested.

## 6. Accessibility

Tests performed:
- **axe-core in jsdom** (`frontend/src/test/a11y.test.tsx`, WCAG 2.0/2.1/2.2 A and AA rules except colour contrast,
  which jsdom can't compute): sign-in, registration, forgot password, admin dashboard with chart, admin user list,
  admin plans, the new data components, the confirmation dialog → 0 violations. A control test confirmed axe reports
  violations when they exist.
- **axe-core in Chromium** (`scripts/e2e/journey.mjs`, all WCAG 2.x A/AA rules **including colour contrast**) on 20
  pages: register, dashboard, competencies, development plan, learning, practice, progress, profile, plans, settings,
  admin dashboard, user detail, audit log, plans, roles, subscriptions, analytics, settings, assessments, learning
  content → **0 violations** in the final run.
- **Keyboard-only checks** in Chromium: sign in with Tab/typing/Enter; focus moves to `main` on navigation and the skip
  link is the first focusable element; sortable column header operated with Enter; table row opened with Enter;
  dialog receives focus, traps Tab, closes on Escape and returns focus to the trigger.

Issues found and fixed during this work:
- Low-contrast text (`neutral-400`, `growth-600`) in design-system components and pages; the success button; the
  locked badge; the AI-insight confidence label (found by the browser axe run).
- Links inside text distinguished by colour only (found by axe on `/register`) → underlined.
- Visible label not contained in the accessible name on practice task buttons (WCAG 2.5.3) → fixed.
- Sortable admin tables now expose `aria-sort`; charts have text alternatives (hidden data table).

Not done: testing with real screen readers (NVDA/VoiceOver) and with users with disabilities. Automated tools catch
only part of WCAG; this is not a conformance claim.

## 7. Tests actually executed (final run)

| Suite | Command | Result |
|---|---|---|
| Backend pytest (SQLite) | `cd backend && .venv/bin/pytest` | **113 passed** (security 22, subscriptions 16, RBAC 15, admin users 13, auth 13, scoring 9, flow 8, AI 6, recommendations 5, admin content 3, gaps 3) |
| Backend lint / types | `ruff check app tests scripts`, `mypy app` | clean / no issues in 76 files |
| Frontend Vitest | `npm test` | **38 passed** (6 files, incl. 7 admin and 8 axe tests) |
| Frontend types / lint | `npm run typecheck`, `npm run lint` | clean |
| Production build | `npm run build` | passes |
| Migration | upgrade → downgrade → upgrade on a populated copy; `alembic check` | data preserved; no drift |
| Docker image | `docker build` (root `Dockerfile`), run against an empty PostgreSQL database in production mode | migrates, seeds, serves SPA and API; HSTS and Secure cookies present |
| Browser E2E + axe + keyboard | `node scripts/e2e/journey.mjs` against API + built SPA on PostgreSQL | **31/31 steps passed, 0 axe violations on 20 pages**, no page errors |

The browser run covers: registration with the terms requirement, onboarding, a full 30-question assessment,
results, dashboard stepper, plan → learning → practice with AI feedback, plan limits and the plans page, settings,
the learner being refused by the admin UI and API (403) and by CSRF (403), super-admin sign-in, searching a user,
granting a 30-day Pro plan, suspending (the user's session stops working immediately), audit entries, reactivation,
the user signing in again with Pro entitlements, every admin section, keyboard-only use, and the admin users page on a
390 px phone without horizontal page scroll.

## 8. Status by category

### Implemented and tested
Registration with terms; login/logout; session list and revocation; password change; forgot/reset password (console
backend); email verification (console backend); self-deactivation; RBAC and all escalation rules; admin user list,
detail and every account action; role assignment; role permission editing; plan management; subscription
assignment, extension, cancellation, transitions and lazy expiry; entitlement enforcement and upgrade prompts;
payment webhook signature checks and idempotency (with a test secret); audit logging and the append-only trigger;
analytics dashboard from real data; security headers, CSRF, rate limits, body size limit; migration 0002 with data;
design-system components; accessibility fixes; data export.

### Implemented but not fully tested
- **SMTP delivery**: the SMTP backend is implemented but was not tested against a real mail server.
- **Custom roles** (`POST /api/admin/roles`) are implemented but not covered by an automated test, and there is no
  UI to create a new role (editing role permissions is tested and has a UI).
- **Analytics accuracy at scale**: figures are computed with SQL aggregates and were checked against small datasets
  only; performance on large datasets wasn't measured.
- **Login timing equalisation** (S5) is implemented but not measured statistically.
- **Tablet layouts** of the new admin pages were not checked one by one (desktop and 390 px phone were).
- **Concurrent webhook deliveries** rely on the unique constraint; not load-tested.

### Not implemented
- An integration with a real payment provider (Stripe or similar), checkout and invoices. The webhook boundary exists;
  an adapter that maps a provider's native events is required.
- Multi-factor authentication, account lockout notifications to the user, login alerts.
- A shared rate-limit store: the limiter is in memory per process, so limits are per instance and reset on restart.
- Automatic expiry notifications for subscriptions, and scheduled (rather than lazy) expiry jobs.
- Audit-log export and retention policy; IP addresses are kept in sessions and audit rows without an automatic
  retention period.
- Localisation of the new screens (English only, like the rest of the interface).
- A UI for creating custom roles and for viewing a single subscription's full event list outside the user page.

### Requires external credentials or infrastructure
- `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` (+ `EMAIL_BACKEND=smtp`) for real verification and
  reset emails. Until then, development logs the emails and production sends none — and the UI says so.
- `PAYMENT_PROVIDER` and `PAYMENT_WEBHOOK_SECRET`, plus a provider account and adapter, for paid self-service plans.
- `OPENAI_API_KEY` (optional) for model-based AI feedback; otherwise the built-in rule-based evaluator is used.
- Redis or another shared store if the API runs as more than one process (rate limits).
- HTTPS termination in front of the app (Render provides it).

## 9. Remaining risks and limitations
- In-memory rate limiting (see above); a distributed attacker can still try many accounts slowly.
- Registration confirms whether an email is registered (409) — accepted for usability, rate limited.
- CSP allows inline styles (needed by the design system's inline style attributes).
- The JWT stays valid until its session is revoked or expires (24 h default); revocation is checked on every request.
- Users with old sessions created before migration 0002 must sign in again (their tokens have no session).
- No automated dependency vulnerability scanning in CI; `npm audit` reports advisories in development dependencies
  that were not triaged as part of this work.

## 10. Environment variables
See `.env.example`. New in this change: `COOKIE_SECURE` (empty = automatic), `APP_BASE_URL`
(falls back to `RENDER_EXTERNAL_URL`), `REQUIRE_EMAIL_VERIFICATION`, `TERMS_VERSION`, `EMAIL_BACKEND`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`, `RATE_LIMIT_ENABLED`,
`MAX_REQUEST_BYTES`, `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET`. Production still requires `JWT_SECRET`
(≥ 32 characters) and `ADMIN_PASSWORD` to create the admin account.

## 11. Deployment and setup
1. **Back up** the database: `pg_dump -Fc "$DATABASE_URL" > backup.dump`.
2. Deploy as before (Docker image or Render blueprint). The entrypoint runs `alembic upgrade head` and the idempotent
   seed, which creates the roles, permissions and default plans and gives the demo account a one-year Pro grant.
   Existing admins become super administrators; everyone else keeps their data and gets the `user` role.
3. Everyone signs in again once (old tokens have no server-side session).
4. Optional: configure SMTP and set `REQUIRE_EMAIL_VERIFICATION=true` once delivery works.
5. Local development: `docker compose -f docker-compose.dev.yml up` or the commands in the README. Seeded accounts:
   `admin@isker.local` (super admin) and `demo@isker.local` (learner with Pro), development passwords in the README.

Verification commands are listed in §7 and in the README ("Quality checks").
