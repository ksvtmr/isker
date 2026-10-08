# Testing

| Layer | Tool | Command | Count |
|---|---|---|---|
| Backend unit + API | pytest, FastAPI TestClient, SQLite | `cd backend && .venv/bin/pytest` | 45 tests |
| Backend lint / types | ruff, mypy | `ruff check app tests && mypy app` | clean |
| Frontend unit / component / route / flow | Vitest, Testing Library, jsdom | `npm test` | 22 tests |
| Frontend types / lint | tsc, ESLint (+ jsx-a11y, react-hooks) | `npm run typecheck && npm run lint` | clean |
| Build | Vite | `npm run build` | passes |
| Migrations | Alembic | `alembic upgrade head && alembic check` | no drift |
| End-to-end (manual script) | Playwright + Chromium | see below | full loop + 14 routes × 3 viewports + admin |

## Backend suites
- `test_auth.py` — registration, bcrypt hashing, duplicate email, password rules and error envelope, login, bearer and cookie sessions, logout revocation, protected endpoints, admin authorisation, reserved-domain login, CORS env parsing.
- `test_scoring.py` — level bands, gap bands, method weighting and renormalisation, item weights, confidence, explanation text, rubric scoring and clamping.
- `test_gaps.py` — goal-based target boost, the priority formula and ranking, no-gap ordering.
- `test_ai.py` — score recomputed from the rubric (model score ignored), retry on invalid JSON, missing criteria rejected, provider failure → fallback, out-of-range values, mock determinism.
- `test_recommendations.py` — difficulty and format matching, skipping completed items, reason text, recommendations matching stored gaps and goals.
- `test_flow.py` — **the full product loop through the API**: register → onboarding → start and resume → answer 30 → submit → profile, gaps and recommendations → learn → practice with AI feedback → reflection → reassess unlocked → single-competency reassessment → history preserved → plan cycle completed → progress and dashboard. Plus incomplete submission, minimum length, invalid option, cross-user access (404), empty dashboard, invalid goal, account deletion.
- `test_admin.py` — statistics, catalogue counts, create resource and question (with validation), deactivate, prompt versioning and template validation.

## Frontend suites
- `designSystem.test.tsx` — level and gap helpers, badges show text, accessible progress bar, AnswerOption radio, Prose renders markdown and never injects HTML.
- `forms.test.tsx` — Zod rules, login validation without API calls, server error display, successful login navigation, taken email mapped to its field.
- `routes.test.tsx` — anonymous redirect with `next`, onboarding gate, admin guard, empty-state CTA, error state with retry, 404.
- `assessment.test.tsx` — answer completeness rules, autosave payloads, disabled Continue until answered, open-answer minimum length, finish → submit → results navigation, resume at the saved question with saved answers, the competency is never shown.

## End-to-end verification (performed)
The Playwright script drives Chromium against the running stack (Vite dev and the Docker Compose build):
register → onboarding (including a validation error) → start assessment → answer 30 questions with a page reload mid-way (resume) → results → plan → learning start/complete → practice submit/feedback/complete → reflection → single-competency reassessment → progress → dashboard → logout → demo login → every learner route at 1440, 900 and 375px (checks for error states and horizontal overflow) → every admin route.
