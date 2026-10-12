# Testing

| Layer | Tool | Command | Count |
|---|---|---|---|
| Backend unit + API | pytest, FastAPI TestClient, SQLite | `cd backend && .venv/bin/pytest` | 113 tests |
| Backend lint / types | ruff, mypy | `ruff check app tests && mypy app` | clean |
| Frontend unit / component / route / flow / a11y | Vitest, Testing Library, jsdom, axe-core | `npm test` | 38 tests |
| Frontend types / lint | tsc, ESLint (+ jsx-a11y, react-hooks) | `npm run typecheck && npm run lint` | clean |
| Build | Vite | `npm run build` | passes |
| Migrations | Alembic | `alembic upgrade head && alembic check` | no drift |
| Migrations with data | Alembic on a copy of a populated database | `alembic upgrade head` → `downgrade 0001` → `upgrade head` | data preserved both ways |
| End-to-end + accessibility | Playwright + Chromium + axe-core | `cd scripts/e2e && BASE=… node journey.mjs` | 31 steps incl. keyboard-only checks, axe on 20 pages (0 violations) |

## Backend suites
- `test_auth.py` — registration, bcrypt hashing, duplicate email, password rules and error envelope, login, bearer and cookie sessions, logout revocation, protected endpoints, admin authorisation, reserved-domain login, CORS env parsing.
- `test_scoring.py` — level bands, gap bands, method weighting and renormalisation, item weights, confidence, explanation text, rubric scoring and clamping.
- `test_gaps.py` — goal-based target boost, the priority formula and ranking, no-gap ordering.
- `test_ai.py` — score recomputed from the rubric (model score ignored), retry on invalid JSON, missing criteria rejected, provider failure → fallback, out-of-range values, mock determinism.
- `test_recommendations.py` — difficulty and format matching, skipping completed items, reason text, recommendations matching stored gaps and goals.
- `test_flow.py` — **the full product loop through the API**: register → onboarding → start and resume → answer 30 → submit → profile, gaps and recommendations → learn → practice with AI feedback → reflection → reassess unlocked → single-competency reassessment → history preserved → plan cycle completed → progress and dashboard. Plus incomplete submission, minimum length, invalid option, cross-user access (404), empty dashboard, invalid goal, account deletion.
- `test_security.py` — terms required at registration, default role, honest verification state, no secrets in
  responses; CSRF (cookie requests without/with wrong header rejected, Bearer exempt), cookie flags; session list,
  revoke others, cannot revoke another user's session (IDOR), password change signs out other sessions, suspended
  user's session stops working; forgot-password gives identical responses for existing/unknown emails, reset flow,
  single-use hashed tokens, garbage tokens, honest message when email is disabled; email verification; per-email login
  rate limit with `Retry-After`; failed logins audited without the password; security headers and request id;
  413 body limit; no stack traces; wildcard CORS refused.
- `test_rbac.py` — every admin endpoint returns 403 for learners (and is audited) and 401 anonymously; self-escalation
  through registration/profile payloads is ignored; permission matrix for support / content_manager / admin;
  admin can't grant admin or super_admin (vertical escalation); nobody changes their own roles; admin can't suspend,
  edit or sign out a peer or a super admin; support can't suspend or edit; last super admin is protected; super_admin
  role is immutable and reserved permissions can't be granted; admin can't edit role definitions; learners can't read
  other users' attempts or admin user details (horizontal escalation).
- `test_admin_users.py` — search/filter/sort/paginate (status, role, plan, inactivity), sort-key allow-list; user
  detail contains the journey but no secrets; support sees no audit trail; suspend requires a reason, revokes sessions
  and is audited, reactivate; no self-suspend; email edit conflict and re-verification; password reset is honest in
  dev mode; deletion only after deactivation with matching email, audit history survives without the email; plain
  admins can't delete; analytics from real data and empty states; audit-log filters; settings never expose secrets.
- `test_subscriptions.py` — public plans and Free entitlements; full-assessment and practice-task limits enforced by
  the API (resume doesn't consume quota); advanced resources locked on Free and unlocked by an admin grant;
  history depth on Free; lazy expiry writes an event; extend / past_due / invalid transition / cancel at period end /
  cancel now with full event history (actor + reason); assignment replaces the current subscription; support can view
  but not change; users can't grant themselves a plan; plan management validation; data export; payment webhooks:
  refused when not configured, signature/replay checks, idempotent activation, renewal and status events.
- `test_admin.py` — statistics, catalogue counts, create resource and question (with validation), deactivate, prompt versioning and template validation.

## Frontend suites
- `admin.test.tsx` — a support agent only sees permitted admin sections; a missing permission shows an explanation;
  user list sorting (`aria-sort`) and filters reach the API; suspend needs a reason and reports success only after
  the API confirms; refused actions keep the dialog open with the server message; deletion requires typing the
  email; the API client sends `X-CSRF-Token` on unsafe requests only.
- `a11y.test.tsx` — axe-core (WCAG 2.0–2.2 A/AA tags) on sign-in, registration, forgot password, admin dashboard
  (charts), admin user list, admin plans, the new data components and the confirmation dialog. jsdom can't compute
  colour contrast, so that rule runs in the browser run instead.
- `designSystem.test.tsx` — level and gap helpers, badges show text, accessible progress bar, AnswerOption radio, Prose renders markdown and never injects HTML.
- `forms.test.tsx` — Zod rules, login validation without API calls, server error display, successful login navigation, taken email mapped to its field.
- `routes.test.tsx` — anonymous redirect with `next`, onboarding gate, admin guard, empty-state CTA, error state with retry, 404.
- `assessment.test.tsx` — answer completeness rules, autosave payloads, disabled Continue until answered, open-answer minimum length, finish → submit → results navigation, resume at the saved question with saved answers, the competency is never shown.

## End-to-end verification (performed)
The Playwright script drives Chromium against the running stack (Vite dev and the Docker Compose build):
register → onboarding (including a validation error) → start assessment → answer 30 questions with a page reload mid-way (resume) → results → plan → learning start/complete → practice submit/feedback/complete → reflection → single-competency reassessment → progress → dashboard → logout → demo login → every learner route at 1440, 900 and 375px (checks for error states and horizontal overflow) → every admin route.
