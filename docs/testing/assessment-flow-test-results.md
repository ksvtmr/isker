# Assessment flow — tests actually executed (2026-10-29)

All results below were produced in this environment; nothing is reported that was not run.

## Automated suites

| Check | Command | Result |
|---|---|---|
| Backend lint | `ruff check app tests scripts browser` | clean |
| Backend types | `mypy app` | no issues (90 files) |
| Migration guard | `python scripts/check_migrations.py` | 7 migrations OK |
| Backend tests | `pytest` (SQLite) | **297 passed** (274 existing + 23 new in `tests/test_onboarding_analysis.py`) |
| Frontend lint / types | `npm run lint`, `npm run typecheck` | clean |
| Frontend tests | `npm test` (vitest) | **107 passed** (14 files; new: `analysis.test.tsx`, routing tests in `routes.test.tsx`) |
| Translation completeness | `vitest run src/test/i18n.test.ts` | 13 passed (ru/kk/en identical keys, variables, used keys exist) |
| Production build | `npm run build` | OK |
| Migrations on PostgreSQL 16 | `alembic upgrade head`, `alembic check`, downgrade 0007→0006→head, downgrade base → head | OK; backfill verified on 3 existing attempts (version 1, scoring v1, language NULL, 45 scores unchanged) |
| Browser journey | `scripts/e2e/journey.mjs` (register, onboarding, full assessment, results, plan, learning, practice, admin, axe-core WCAG 2.2 AA, keyboard, mobile) | PASSED |
| Three languages | `scripts/e2e/languages.mjs` | 113 page checks, 0 failures (after fixing: the rule-based analysis showed the language it was first written in) |
| Smoke | `scripts/smoke.sh` against the production-like server | PASSED |
| In-browser API (GitHub Pages build) | `node backend/browser/smoke.mjs` | PASSED |
| Secret scan | gitleaks 8.28.0 on full history and working tree | no leaks |
| Bundle scan | grep of `frontend/dist` for key patterns and secret variable names | nothing found |

## New backend tests (`tests/test_onboarding_analysis.py`; providers are MOCKED test doubles)

Onboarding: new user has no assessment and is routed to it; unfinished attempt resumes with saved answers after a
new session and a language switch; completed user is not sent back. Assessment: versions, language, evidence and
evidence level stored; all 15 competencies covered by a demonstrated (non-self-rating) item; a different scoring method
is not compared, the same method is. AI: lifecycle idempotent (one row, scores unchanged, links only to available
content); owner-only and completed-only (404/409); malformed JSON and unknown competency codes → `invalid_output`, then a
successful retry updates the same row; unsupported recommendations (unknown resource, practice without task, reflect
with a link) rejected; 429 → `rate_limited`, timeout → `provider_unavailable`; requested language passed in prompt and
facts, English text claimed as Kazakh → `wrong_language`; regeneration in another language keeps one row; failed
regeneration keeps the previous analysis; rate limit (11th run → 429); facts contain no email, name or free-text
answers; admin list (ai.view, no texts) and retry (ai.manage, audited, failed only); configuration errors for a missing
key; the key never appears in `/api/ai/status` or `/api/admin/settings`; Gemini adapter sends the key only in the
header and hides it in errors; rule-based analysis re-rendered in the reader's language.

Frontend: analysis requested once and rendered with real links only; pending state; failed state with retry; analysis
in another language offers a rewrite; learners without results are sent to the initial assessment; `homeFor` routing.

## Browser checks of the new flow (Playwright, production-like server)

* New learner (ru): before onboarding `/dashboard` → `/onboarding`; after onboarding `/dashboard` → `/assessment` with
  the first-time explanation and language select.
* Results page: analysis panel goes from "Analysing your results…" to the full analysis; the dashboard shows the compact
  analysis.

## Live AI (real Gemini API, `gemini-3.5-flash`, key from the environment only)

* Provider reported as `gemini` / `gemini-3.5-flash`; open answers evaluated by Gemini during submit.
* Development analysis **in Kazakh: succeeded** (16.9 s) — summary in Kazakh, real competencies, actions linked to
  catalog resources and tasks, 3 milestones, 2 confidence notes, reassessment in 8 weeks.
* The key was not found in any API response or log line.
* Then the key's free-tier quota was exhausted (`GenerateRequestsPerDayPerProjectPerModel-FreeTier: 20`, HTTP 429);
  further runs (Russian regeneration) failed as designed with `rate_limited`, results kept. Also observed once: a read
  timeout at 30 s → the analysis now has its own 90 s timeout.

## Not verified / limitations

* Russian and English analyses with the live model (quota exhausted; covered by mocked tests and the rule-based path).
* OpenAI provider with a real key (no key available; adapter covered by existing tests).
* Load and concurrency beyond the unit tests (the partial unique index and the `pending` claim are tested logically,
  not under real parallel load).
* Free tier capacity: one assessment ≈ 7 model requests (≈5 open answers + insight + analysis), so 20/day ≈ 2–3
  assessments. Production needs a billed key or a model with a larger quota.
