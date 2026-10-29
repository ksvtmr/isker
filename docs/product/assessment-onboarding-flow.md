# Assessment-first onboarding

Product loop: **Register → Onboarding questions → Initial assessment → AI analysis → Competency profile → Gap
analysis → Development plan → Learn → Practice → Reassess → Track progress.**

## New user journey

| Step | What happens | Where |
|---|---|---|
| 1. Register | Account + profile row are created; the interface language becomes the account language. | `POST /api/auth/register` |
| 2. Onboarding | About you, experience, goals (goals weight the gap priorities). Saved on the server. | `/onboarding`, `POST /api/profile/onboarding` |
| 3. Initial assessment | The learner is taken to `/assessment`. On a first visit it explains **why** the assessment comes first and **how** results are used, shows time/question count/privacy, and lets the learner pick the **assessment language** (ru / kk / en; saved to the account). | `pages/AssessmentIntro.tsx` |
| 4. Answering | One question per step, progress indicator, back/next, validation (choice required, minimum length for open answers), contextual help, autosave of every answer, "save and exit", confirmation before finishing. | `pages/AssessmentRunner.tsx` |
| 5. Scoring | Deterministic scores per competency (see methodology); gaps, recommendations and plan are created in the same transaction. Double submission is refused (409), never duplicated. | `POST /api/assessments/attempts/{id}/submit` |
| 6. AI analysis | Requested automatically on the results page; shows a pending state, then the analysis, or a recoverable error with "Try again". Results are saved before the analysis starts. | `GET/POST /api/assessments/attempts/{id}/analysis` |
| 7. Results → plan → dashboard | Results screen leads to the development plan; the dashboard shows the profile, plan, progress and a compact analysis. | `/results`, `/development-plan`, `/dashboard` |

## Routing rules (no forced re-assessment)

`/api/auth/me` returns `initial_assessment_completed` (a full assessment was completed at least once) and
`in_progress_attempt_id`.

* Not onboarded → `/onboarding`.
* Onboarded, no completed full assessment → result pages (dashboard, results, competencies, plan, learning, practice,
  progress) redirect to `/assessment/{open attempt}` if one is open, otherwise to `/assessment`
  (`RequireInitialAssessment`, `homeFor` in `layouts/guards.tsx`).
* Completed at least once → the dashboard, always. Reassessment is offered, never forced.
* Staff accounts (admin area access) are never held back.
* Profile, settings, plans and the assessment itself stay reachable at any time.

## Save and resume

* Every answer is saved on the server as it is given (`PUT .../answers/{question_id}`), the position too.
* Refreshing, closing the tab or signing in on another day resumes the same attempt (one open attempt per user,
  enforced by a partial unique index); answers are keyed by question/option IDs, so switching the language mid-way
  keeps every answer.
* "Start over" abandons the open attempt explicitly (answers kept for history) after a confirmation dialog.

## When the AI is unavailable

The assessment result never depends on the analysis. If the provider fails, the analysis is stored as `failed` with
a stable reason (provider unavailable, rate limited, invalid output, wrong language); the learner sees "The analysis is
not available right now. Your assessment results are saved" and a retry button. Retrying updates the same record (one
analysis per attempt). A failed *regeneration* keeps the previous analysis. Administrators see and retry failed runs
in Admin → AI governance → Development analyses.

## Screens and states

| Screen | States |
|---|---|
| Assessment intro | first visit (why/how/language), resume open attempt, restart (confirm), reassess one competency |
| Runner | saving / saved / not saved (retry), validation hints, finish confirmation, analysing, not found, error with retry |
| Results | loading, empty (no assessment), error with retry, results; analysis: pending / failed + retry / ready / written in another language (+ rewrite) |
| Dashboard | redirected to the assessment until the first one is completed; then profile, plan, progress, compact analysis |

Verified in a browser on desktop (1280 px) and phone layout (390 px) — see
[docs/testing/assessment-flow-test-results.md](../testing/assessment-flow-test-results.md).
