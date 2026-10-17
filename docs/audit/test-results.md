# Test results

All results below were produced on 17 October 2026 on the final code of the audit (branch
`claude/sleepy-darwin-ycx2me`), in a Linux container with Python 3.13, Node 22, PostgreSQL 16 and Chromium
(Playwright). Nothing is reported that was not executed.

## 1. Commands executed and results

| Check | Command (directory) | Result |
|---|---|---|
| Backend lint | `.venv/bin/ruff check app tests` (backend) | **pass**, no findings |
| Backend tests | `.venv/bin/python -m pytest -p no:warnings -q` (backend) | **274 passed, 0 failed, 0 errors, 0 skipped** (18 files, 302 s) |
| Frontend type check | `npx tsc --noEmit -p .` (frontend) | **pass** |
| Frontend lint | `npx eslint src` (frontend) | **pass** |
| Frontend tests | `npx vitest run` (frontend) | **97 passed** in 12 files |
| Production build | `npm run build` (frontend) | **pass**; one pre-existing warning: main chunk larger than 800 kB |
| Migrations (scratch DB) | `alembic heads`, `check`, `downgrade 0003`, `upgrade head`, `check` | **pass**: single head 0006, no model/migration drift, down and up clean |
| Migrations (populated dev DB) | `alembic upgrade head` from 0004 | **pass**: users 5, answers 182, competency scores 77, attempts 8, subscriptions 1, audit entries 45 — identical before and after |
| Seed idempotency | `python -m app.seed.run` twice on the dev DB | **pass**; translations only fill missing keys |
| Browser journey | `BASE=http://localhost:8000 node journey.mjs` (scripts/e2e) | **pass**: 31 steps OK, 20 axe-core scans (WCAG 2.2 A/AA) with **0 violations** |
| Three-language check | `BASE=http://localhost:8000 node languages.mjs` (scripts/e2e) | **pass**: 113 page checks in ru/kk/en, 0 failures |

The browser runs used the API serving the built SPA on one origin (`STATIC_DIR=frontend/dist`) against the
populated development database, with `RATE_LIMIT_ENABLED=false` because the scripts sign in dozens of times;
rate limiting itself is covered by backend tests.

## 2. What the suites cover

**Backend (274 tests)**: authentication (registration, login, remember me, rotation and reuse detection incl.
Bearer tokens, expiry, logout, password reset, email verification, set-password), Google OIDC against a local RSA
key standing in for Google (state, nonce, PKCE, issuer, audience, signature, expiry, no auto-linking, linking,
unlinking, suspended accounts, audit without secrets), RBAC and rank rules, last super-admin, CSRF, blocked
accounts, subscriptions and entitlements, payment webhooks (signature, idempotency, late renewal, failures),
assessment flow and scoring, recommendations, learning and practice, admin user management and content management
with optimistic locking, content lifecycle and question versioning, translations and completeness, AI language
handling, concurrency fixes, migrations-related constraints.

New in this audit: `test_audit_fixes.py` (37), `test_localization_audit.py` (31), `test_content_sync.py`,
`test_user_sync.py`, `test_sessions.py`, `test_google_oauth.py`, `test_localization.py`.

**Frontend (97 tests)**: forms and validation, password toggle, remember me, Google button states, route guards,
admin pages, admin content sync and conflict handling, user sync, translation key parity and plurals, design
system, accessibility (axe in jsdom), audit fixes (public plans page, permission gating, audit labels, translated
server errors, admin guard retry, tabs keyboard support, live region), URL-driven learning filters, Kazakh date
formatting fallback.

**Browser journey**: registration with terms, onboarding, the full 30-question assessment to results, dashboard,
development plan → learning → practice with AI feedback, all learner pages, plan limits and locked advanced
resources, settings and sessions, learner kept out of admin (UI and API 403, CSRF), admin sign-in, search, grant
a time-limited plan, suspend (learner's session becomes invalid), audit log entries, reactivate, learner signs in
with the new plan, all admin pages, keyboard-only sign-in and dialog focus handling, phone layout without
horizontal scroll.

## 3. Defects reproduced and fix verification

| Defect | Reproduced by | Verified fixed by |
|---|---|---|
| Admin stats / analytics / user goals in English for ru/kk admins | `languages.mjs` (ru/kk admin pages failed the script check) | `test_admin_stats_competency_names_are_localized`; e2e pass |
| Kazakh dates rendered in English ("Oct 17, 2026") in Chromium without kk locale data | `languages.mjs` (kk `/admin`) | `format.test.ts`; e2e pass |
| 25 questions with English help text for ru/kk learners | translation completeness report | `test_all_seeded_content_is_fully_translated` |
| Learning filters ignored in the URL and lost on refresh | journey (`/learning?difficulty=advanced`) | `learningFilters.test.tsx`; journey pass |
| Admin dashboard value column squeezed in Russian | journey screenshot | visual check in e2e screenshots; journey pass |
| Learning search matched English only | code review | `test_learning_search_matches_the_language_the_learner_sees` |
| Archived plan step blocked plan completion | audit finding D5 | `test_archived_step_of_an_active_plan_can_still_be_completed` |
| Double submit → 500, double start → two attempts, late payment renewal stays expired, Bearer token reuse, demo account mutable, … | audit findings | `test_audit_fixes.py` (one or more tests per finding) |
| Practice feedback / reasons in the wrong language, Kazakh tokenizer, keyword double counting, stale translations | audit findings | `test_localization_audit.py` |
| `remember_me` dropped by the login form schema; cookie expiry crash with naive datetimes | frontend/backend tests | `forms.test.tsx`, `test_sessions.py` |

The end-to-end script itself was updated where the UI changed on purpose (exact "Password" label next to the new
"Show password" toggle, "Start learning" casing, new login heading, reworded locked-resource label) and to switch
the seeded admin account to English, because a saved account language correctly overrides the browser.

## 4. Environment-related blockers and tests not executed

| Not executed | Why | What exists instead |
|---|---|---|
| Google sign-in against a real Google project | no Google client id/secret in this environment | full flow tested against a simulated provider with real ID-token verification |
| Real email delivery (SMTP) | no SMTP server configured; development uses the console backend | template rendering and "email not configured" honesty tested |
| Real AI provider (OpenAI) | no API key; `MOCK_AI=true` | provider contract, retries, language validation and fallback tested with simulated replies |
| Payment provider | none integrated by design | signed webhook format tested |
| Docker image build | Docker daemon not used in this run | the same code paths (migrations, seed, SPA served by the API) exercised directly |
| Load / multi-instance tests | out of scope | rate limiter documented as single-instance |
| Screen reader manual test | no assistive technology in the container | axe-core scans, keyboard tests, ARIA unit tests |

No test failure was left unexplained: every failure seen during the audit was either a product defect (fixed
and listed in section 3) or the end-to-end script expecting text the UI changed on purpose (updated).
