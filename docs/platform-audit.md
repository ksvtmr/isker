# Isker platform audit (before the admin, security and UX overhaul)

> **Status:** this audit describes the platform *before* the overhaul. What was fixed, how it was tested and what
> remains is in [admin-security-ux-report.md](admin-security-ux-report.md).

Scope: frontend (React + design system), backend (FastAPI), database (PostgreSQL + Alembic), auth, admin,
deployment config. This was a code inspection of the repository at commit `25e038c`.

## 1. Existing features
- Learner loop end to end: register → onboarding → 30-question assessment (autosave, resume) → deterministic
  scoring + rubric-constrained AI → profile → gaps → recommendations → plan (Learn/Practice/Reflect/Reassess) →
  learning resources → practical tasks with AI feedback → single-competency reassessment → progress snapshots.
- Auth: email + password (bcrypt), JWT in an httpOnly SameSite=Lax cookie or a Bearer header, logout through a `jti`
  denylist (`revoked_tokens`), change password, self-service account deletion.
- Admin (single `admin` role): stats, user list (read-only), competencies, questions, assessments, resources,
  tasks, AI evaluation log, prompt versions.
- Audit: `audit_logs(user_id, action, entity_type, entity_id, details)` written by most mutations.
- Design system with tokens and components. Docker and Render deployment.

## 2. Missing features
| Area | Missing |
|---|---|
| Account lifecycle | Email verification, forgot/reset password, terms acceptance, account status (suspend/reactivate), safe deactivation instead of hard delete, a session list and revocation of all sessions |
| RBAC | Only a binary `user`/`admin` enum column. No roles, permissions, `support`, `content_manager` or `super_admin`; no policy layer; no last-admin protection |
| Subscriptions | No plans, subscriptions, entitlements, subscription history or payment boundary |
| Admin | No user detail page or user actions (suspend, roles, plan, sessions, password reset); no role, plan, subscription, analytics, audit-log or settings screens; no breadcrumbs, sortable tables or filters |
| Analytics | No registration or activity time series; no "active users" (no last-seen tracking) |
| Email | No email service abstraction |

## 3. Security vulnerabilities (verified in code)
| # | Severity | Finding | Location |
|---|---|---|---|
| S1 | High | **No rate limiting** on login, registration or password endpoints, so passwords can be brute-forced | `api/routes/auth.py` |
| S2 | High | **No CSRF protection** for cookie-authenticated state-changing requests (SameSite=Lax mitigates cross-site POSTs from other sites but not from same-site subdomains or older browsers) | `api/deps.py` |
| S3 | High | **Coarse authorization**: `require_admin` grants every admin endpoint to every admin. No least privilege and no protection against an admin demoting or locking out other admins | `api/deps.py`, `api/routes/admin.py` |
| S4 | Medium | **Sessions cannot be revoked server-side** except one token at logout. Changing the password or deactivating the account leaves other sessions valid until JWT expiry (24 h) | `core/security.py`, `deps.py` |
| S5 | Medium | **Timing-based account enumeration** at login: an unknown email skips bcrypt, so the response is measurably faster | `auth.py: login` |
| S6 | Medium | **Audit log is mutable and incomplete**: no outcome, reason or request id; `user_id` FK is `SET NULL` (rows are rewritten on user deletion); no DB protection against UPDATE/DELETE; login failures are logged without an email or IP context | `models/progress.py` |
| S7 | Medium | **Missing security headers** (CSP, X-Frame-Options, nosniff, Referrer-Policy, HSTS) when the API serves the SPA | `main.py` |
| S8 | Medium | **No request size limit**, so large JSON bodies are accepted | `main.py` |
| S9 | Medium | **Hard deletion** of accounts via `DELETE /api/users/me` with no grace period or controlled workflow | `routes/profile.py` |
| S10 | Low | `COOKIE_SECURE` defaults to false even in production | `core/config.py` |
| S11 | Low | CORS accepts any configured origin string, including `*` with credentials, without validation | `core/config.py` |
| S12 | Low | Registration reveals existing emails (409). This is an accepted product trade-off but needs rate limiting | `auth.py: register` |
| — | OK | SQL via ORM (parameterised); Pydantic validation; per-user ownership checks on attempts, activities and evaluations; no `dangerouslySetInnerHTML`; bcrypt; no secrets in the repo (demo password only) | — |

## 4. UX problems
- No way to recover a forgotten password; no visible terms or privacy information at registration.
- No indication of plan, limits or what is included; no upgrade path.
- Dashboard shows the next step but not the overall journey (what's done and what remains).
- Admin is a set of tabs inside the learner shell: no breadcrumbs, no user detail, no filters or sorting, and
  destructive actions (unpublish, deactivate question) have no confirmation.
- Self-service "Delete account" is irreversible and immediate.

## 5. Accessibility issues
- **Contrast**: `--color-neutral-400` (#94a3b8, 2.6:1 on white) is used for text in 12 places in DS components
  (the "/ 100" score suffix, "Not assessed", section labels, chart ticks, option letters). `--color-growth-600`
  (#17965e, 3.6:1) is used for 14px delta text. Both fail WCAG 1.4.3 (4.5:1).
- No automated accessibility tests.
- Admin tables are not sortable, and none expose `aria-sort`.
- Positive: skip link, focus moved to main on route change, focus-trapped modals, labelled inputs with
  `aria-describedby`, radio-group roving focus, reduced-motion support, text summaries for charts.

## 6. Technical debt
- The role is stored as an enum column on `users`, and frontend checks are scattered (`role === "admin"`).
- `revoked_tokens` duplicates what a sessions table would provide.
- The in-memory rate limiter will need Redis when running more than one instance (see residual risks after the fix).

## 7. Prioritised implementation plan
1. **P0 security**: rate limiting, CSRF (double-submit token), server-side sessions with revocation, constant-time
   login, security headers, body size limit, production cookie/CORS defaults.
2. **P0 data model**: roles/permissions/user_roles, account status, sessions, verification/reset tokens,
   plans/entitlements/subscriptions/subscription events, append-only audit log (migration 0002).
3. **P1 auth lifecycle**: email verification, forgot/reset password, terms acceptance, deactivation workflow.
4. **P1 RBAC policy layer**, then **subscriptions + entitlements** with backend enforcement.
5. **P1 admin backend** (users, roles, plans, subscriptions, analytics, audit, settings) and **admin UI** with a
   dedicated layout, breadcrumbs, data tables and confirmation dialogs with a reason.
6. **P2 UX**: journey stepper, plan and limits visibility, upgrade prompts, email verification banner.
7. **P2 accessibility**: contrast fixes in the DS, axe tests (Vitest + Playwright), keyboard tests.
8. **Verification**: backend and frontend tests, production build, end-to-end run, final report.
