# Traceability

Business requirement → product requirement → user story → frontend → API → database → tests.

| BR | PR | US | Frontend | API | Database | Tests |
|---|---|---|---|---|---|---|
| – | PR-1 | US-1 | `/register`, `/login`, `layouts/guards.tsx`, Sign out | `POST /api/auth/register·login·logout`, `GET /api/auth/me`, `POST /api/auth/password` | `users`, `revoked_tokens`, `audit_logs` | `test_auth.py`; `forms.test.tsx`, `routes.test.tsx` |
| BR-2 | PR-2 | US-2 | `/onboarding`, `/profile` | `GET /api/goals`, `POST /api/profile/onboarding`, `GET·PUT /api/profile` | `user_profiles`, `user_goals`, `goal_definitions`, `goal_competency_weights` | `test_flow.py::test_full_product_loop`, `::test_onboarding_rejects_unknown_goal`; `routes.test.tsx` |
| BR-1 | PR-3 | US-3 | `/assessment`, `/assessment/:id` (autosave, resume, leave guard) | `GET /api/assessments`, `POST /attempts`, `GET /attempts/{id}`, `PUT /attempts/{id}/answers/{q}`, `PUT /position`, `POST /abandon` | `assessments`, `questions`, `question_options`, `question_competencies`, `assessment_attempts`, `answers` | `test_flow.py` (resume, incomplete, min length, invalid option, cross-user); `assessment.test.tsx` |
| BR-1, BR-4 | PR-4 | US-4 | `/results` | `POST /attempts/{id}/submit`, `GET /attempts/{id}/results` | `competency_scores`, `competency_levels`, `ai_evaluations` | `test_scoring.py`, `test_ai.py`, `test_flow.py` |
| BR-1 | PR-5 | US-4 | `/results`, `/competencies`, `/dashboard` | `GET /api/scores/profile`, `GET /api/dashboard` | `competency_scores` (latest per competency) | `test_flow.py`; `routes.test.tsx` |
| BR-2 | PR-6 | US-4 | `/competencies?tab=gaps` | `GET /api/gaps` | `competency_gaps` | `test_gaps.py`, `test_flow.py` |
| BR-2 | PR-7 | US-6 | Dashboard priority card, plan, "Recommended" badges | `GET /api/recommendations`, `POST /api/recommendations/regenerate` | `recommendations` (→ gap, competency, goal, resource, task) | `test_recommendations.py`, `test_flow.py` |
| BR-2 | PR-8 | US-6 | `/development-plan` | `GET /api/plan`, `POST /api/plan/activities/{id}/reflection` | `learning_activities` | `test_flow.py` |
| BR-2 | PR-9 | US-7 | `/learning`, `/learning/:id`, `/practice`, `/practice/:id` | `/api/learning/resources/*` (start, progress, complete), `/api/practice/tasks/*` (start, submit, complete) | `learning_resources`, `user_learning_progress`, `practical_tasks`, `practice_submissions`, `ai_evaluations` | `test_flow.py` |
| BR-3 | PR-10 | US-8 | Reassess buttons, `/progress`, competency history chart | `POST /attempts {scope: competency}`, `GET /api/progress` | `reassessments`, `progress_snapshots`, `competency_scores` history | `test_flow.py` (history preserved, snapshots, trends) |
| BR-4 | PR-11 | US-5 | `/competencies/:id` "Why this score?" | `GET /api/competencies/{code}`, `GET /api/ai/evaluations/{id}` | `ai_evaluations`, `answers`, `competency_scores.explanation` | `test_flow.py` (evidence, explanation); `test_ai.py` |
| BR-4 | PR-12 | US-9 | `/admin/ai` | `GET /api/admin/ai/evaluations`, `GET·POST /api/admin/ai/prompts`, `POST …/activate` | `ai_prompt_versions`, `ai_evaluations` | `test_admin.py::test_prompt_versioning` |
| BR-5 | PR-13 | US-9 | `/admin/*` | `/api/admin/*` | catalogue tables, `audit_logs` | `test_admin.py`, `test_auth.py::test_admin_requires_admin_role`; `routes.test.tsx` |
| – | PR-14 | all | `design-system/`, `AppShell` (sidebar / collapsed / bottom nav) | – | – | `designSystem.test.tsx`; Playwright run at 3 viewports |
