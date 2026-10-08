# API reference

Generated from the FastAPI OpenAPI schema (`docs/openapi.json`). Interactive docs: **`/api/docs`** (Swagger UI) and `/api/redoc`.

## Conventions

- **Auth:** `POST /api/auth/login` or `/register` returns `{user, access_token, expires_at}` and sets an httpOnly `isker_session` cookie (SameSite=Lax). Send either the cookie or `Authorization: Bearer <token>`. `POST /api/auth/logout` revokes the token server-side (JWT `jti` denylist).
- **Errors** always use one envelope:
  ```json
  {"error": {"code": "ASSESSMENT_NOT_FOUND", "message": "Assessment not found", "details": null}}
  ```
  Validation errors are `422 VALIDATION_ERROR` with `details: [{field, message}]`. Other codes: `NOT_AUTHENTICATED` (401), `SESSION_EXPIRED`, `SESSION_REVOKED`, `INVALID_CREDENTIALS`, `FORBIDDEN` (403), `*_NOT_FOUND` (404), `EMAIL_TAKEN`/`CONFLICT` (409), `ASSESSMENT_INCOMPLETE`, `INVALID_OPTION`, `DATABASE_ERROR`/`INTERNAL_ERROR` (500, no stack traces).
- **Pagination:** list endpoints that can grow return `{items, total, page, page_size}` and accept `page`, `page_size`.
- **Privacy:** question payloads never reveal which competency a question measures. Admin endpoints require `role=admin`.

## Endpoints

### auth

Registration, login, logout, current user

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create an account and start a session |
| `POST` | `/api/auth/login` | Sign in with email and password |
| `POST` | `/api/auth/logout` | Sign out and revoke the current token |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/auth/password` | Change password |

### profile

Onboarding, goals and learning preferences

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/goals` | Goal catalogue for onboarding/profile |
| `GET` | `/api/profile` | Current user's profile, goals and preferences |
| `PUT` | `/api/profile` | Update profile, goals and preferences |
| `POST` | `/api/profile/onboarding` | Complete onboarding |
| `DELETE` | `/api/users/me` | Delete account and all personal data |

### assessments

Assessment engine: attempts, autosave, submission, results

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/assessments` | Active assessment, resumable attempt and history |
| `POST` | `/api/assessments/attempts` | Start (or resume) a full assessment or a single-competency reassessment |
| `GET` | `/api/assessments/attempts/{attempt_id}` | Attempt state: questions (one per screen), saved answers, position |
| `PUT` | `/api/assessments/attempts/{attempt_id}/answers/{question_id}` | Autosave an answer |
| `PUT` | `/api/assessments/attempts/{attempt_id}/position` | Save current question |
| `POST` | `/api/assessments/attempts/{attempt_id}/submit` | Finish: score, AI-evaluate open answers, gap analysis, recommendations, snapshot |
| `POST` | `/api/assessments/attempts/{attempt_id}/abandon` | Discard an attempt |
| `GET` | `/api/assessments/attempts/{attempt_id}/results` | Results of an attempt |

### competencies

EntreComp catalogue and per-competency explanations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/competencies` | EntreComp catalogue |
| `GET` | `/api/scores/profile` | Current competency profile (latest score per competency) |
| `GET` | `/api/gaps` | Latest gap analysis, by priority |
| `GET` | `/api/competencies/{key}` | Competency detail: score, why this score (evidence + AI), history, recommendations |

### recommendations

Recommendation engine

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/recommendations` | Active recommendations (each linked to competency, gap, goal and resource/task) |
| `POST` | `/api/recommendations/regenerate` | Re-run the recommendation engine on the latest gap analysis |
| `GET` | `/api/plan` | Development plan: Learn → Practice → Reflect → Reassess per priority |
| `POST` | `/api/plan/activities/{activity_id}/reflection` | Save a reflection (Reflect step) |

### learning

Learning resources and progress

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/learning/resources` | Browse learning resources (filterable) |
| `GET` | `/api/learning/resources/{resource_id}` | Resource content and progress |
| `POST` | `/api/learning/resources/{resource_id}/start` | Start (or continue) |
| `PUT` | `/api/learning/resources/{resource_id}/progress` | Update reading progress |
| `POST` | `/api/learning/resources/{resource_id}/complete` | Mark as completed |

### practice

Practical tasks with AI feedback

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/practice/tasks` | Practical entrepreneurship tasks |
| `GET` | `/api/practice/tasks/{task_id}` | Task, your response and AI feedback |
| `POST` | `/api/practice/tasks/{task_id}/start` | Start a task |
| `POST` | `/api/practice/tasks/{task_id}/submit` | Submit a response and receive rubric-based AI feedback |
| `POST` | `/api/practice/tasks/{task_id}/complete` | Mark a submitted task complete |

### progress

Dashboard and longitudinal progress

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/progress` | Longitudinal development: snapshots, competency trends, activity counts |
| `GET` | `/api/dashboard` | Everything the dashboard needs in one call |
| `GET` | `/api/health` | Liveness and database check |

### ai

AI subsystem status and explanations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/ai/status` | Which AI provider is active (never exposes keys) |
| `GET` | `/api/ai/evaluations/{evaluation_id}` | One of your AI evaluations (explainability) |

### admin

Content management, AI governance and statistics (admin only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/stats` | Platform and assessment statistics |
| `GET` | `/api/admin/users` | Users |
| `GET` | `/api/admin/competencies` | Competencies |
| `PUT` | `/api/admin/competencies/{competency_id}` | Edit a competency |
| `GET` | `/api/admin/questions` | Question bank |
| `POST` | `/api/admin/questions` | Create Question |
| `PUT` | `/api/admin/questions/{question_id}` | Update Question |
| `DELETE` | `/api/admin/questions/{question_id}` | Deactivate (history is preserved) |
| `GET` | `/api/admin/assessments` | Assessments |
| `POST` | `/api/admin/assessments` | Create Assessment |
| `PUT` | `/api/admin/assessments/{assessment_id}` | Update Assessment |
| `GET` | `/api/admin/resources` | Resources |
| `POST` | `/api/admin/resources` | Create Resource |
| `PUT` | `/api/admin/resources/{resource_id}` | Update Resource |
| `DELETE` | `/api/admin/resources/{resource_id}` | Unpublish a resource |
| `GET` | `/api/admin/tasks` | Tasks |
| `POST` | `/api/admin/tasks` | Create Task |
| `PUT` | `/api/admin/tasks/{task_id}` | Update Task |
| `DELETE` | `/api/admin/tasks/{task_id}` | Unpublish a task |
| `GET` | `/api/admin/ai/evaluations` | AI evaluation log |
| `GET` | `/api/admin/ai/prompts` | Prompt versions |
| `POST` | `/api/admin/ai/prompts` | Create a new prompt version |
| `POST` | `/api/admin/ai/prompts/{prompt_id}/activate` | Activate a prompt version |

### notifications



| Method | Path | Description |
|---|---|---|
| `GET` | `/api/notifications` | Notifications |
| `POST` | `/api/notifications/{notification_id}/read` | Mark Read |
