# API reference

Generated from the FastAPI OpenAPI schema (`docs/openapi.json`). Interactive docs: **`/api/docs`** (Swagger UI) and `/api/redoc`. They are on in development and off in production unless `API_DOCS_ENABLED=true`.

## Conventions

- **Auth (browser):** `POST /api/auth/register` (requires `accept_terms: true`) or `/login` sets two cookies: the
  httpOnly `isker_session` (SameSite=Lax, `Secure` in production) and a readable `isker_csrf`. Every
  POST/PUT/PATCH/DELETE authenticated by the cookie must send `X-CSRF-Token: <isker_csrf value>`; otherwise
  `403 CSRF_FAILED`.
- **Auth (API clients):** send the returned `access_token` as `Authorization: Bearer <token>` (no CSRF header needed).
  Each token is bound to a server-side session (`user_sessions`); logout, password change/reset, suspension and
  "sign out everywhere" revoke sessions immediately (`401 SESSION_REVOKED` / `ACCOUNT_INACTIVE`).
- **Authorization:** role-based permissions checked on the server (`403 FORBIDDEN` with `details.missing`,
  `INSUFFICIENT_RANK`, `SELF_ACTION_FORBIDDEN`, `LAST_SUPER_ADMIN`). Denials are written to the audit log.
- **Entitlements:** plan features are enforced by the server. A missing feature or exhausted limit returns
  `403 UPGRADE_REQUIRED` with `details: {feature, plan, limit, used}`. `GET /api/entitlements/me` lists them.
- **Rate limits:** sign-in, registration, password reset, verification and password change are limited per IP and per
  account → `429 RATE_LIMITED` with a `Retry-After` header.
- **Errors** always use one envelope:
  ```json
  {"error": {"code": "ASSESSMENT_NOT_FOUND", "message": "Assessment not found", "details": null}}
  ```
  Validation errors are `422 VALIDATION_ERROR` with `details: [{field, message}]`. Bodies over 1 MB → `413
  PAYLOAD_TOO_LARGE`. 500s never include stack traces. Every response carries `X-Request-ID` (also stored in audit rows).
- **Pagination:** list endpoints that can grow return `{items, total, page, page_size}` and accept `page`, `page_size`.
- **Privacy:** question payloads never reveal which competency a question measures; password hashes and tokens are
  never returned; reset-password responses never reveal whether an email is registered.
- **Payment webhooks:** `POST /api/billing/webhooks/{provider}` accepts signed, provider-neutral events
  (`X-Isker-Signature: t=<unix>,v1=<HMAC-SHA256(secret, "t.body")>`), processed once per event id. Refused with
  `503 PAYMENTS_NOT_CONFIGURED` until `PAYMENT_PROVIDER` and `PAYMENT_WEBHOOK_SECRET` are set. No card data is accepted.

## Endpoints

### auth

Registration, login, logout, current user

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create an account (terms required) and start a session |
| `POST` | `/api/auth/login` | Sign in with email and password |
| `POST` | `/api/auth/logout` | Sign out and revoke this session |
| `GET` | `/api/auth/me` | Current user, roles and permissions |
| `PUT` | `/api/auth/me/language` | Save the interface language for this account |
| `POST` | `/api/auth/set-password` | Add a password to an account created with Google (requires a sign-in in the last 10 minutes) |
| `POST` | `/api/auth/password` | Change password (signs out other sessions) |
| `POST` | `/api/auth/forgot-password` | Request a password reset link (same response whether or not the email exists) |
| `POST` | `/api/auth/reset-password` | Set a new password with a reset token |
| `POST` | `/api/auth/verify-email` | Confirm an email address with a token |
| `POST` | `/api/auth/resend-verification` | Send the verification email again |
| `GET` | `/api/auth/sessions` | Your active sessions (devices) |
| `DELETE` | `/api/auth/sessions/{session_id}` | Sign out one of your sessions |
| `POST` | `/api/auth/sessions/revoke-others` | Sign out all other sessions |
| `POST` | `/api/auth/deactivate` | Close your account (reversible by support) |
| `GET` | `/api/auth/providers` | Which sign-in methods this server offers |
| `GET` | `/api/auth/google/start` | Start “Continue with Google” (redirects to Google) |
| `POST` | `/api/auth/google/link` | Start linking Google to the signed-in account (returns the Google URL) |
| `DELETE` | `/api/auth/google` | Unlink Google (only if the account keeps a password) |
| `GET` | `/api/auth/google/callback` | Google redirects here after consent |
| `GET` | `/api/sync/state` | Versions of the data an open tab may need to refresh |

### profile

Onboarding, goals and learning preferences

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/goals` | Goal catalogue for onboarding/profile |
| `GET` | `/api/profile` | Current user's profile, goals and preferences |
| `PUT` | `/api/profile` | Update profile, goals and preferences |
| `POST` | `/api/profile/onboarding` | Complete onboarding |

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

### billing

Plans, entitlements, payment webhooks and data export

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/plans` | Active subscription plans (public) |
| `GET` | `/api/entitlements/me` | What my plan allows, with usage |
| `GET` | `/api/subscription/me` | My plan, subscription and history |
| `POST` | `/api/billing/webhooks/{provider}` | Signed payment-provider webhook (idempotent) |
| `GET` | `/api/export/me` | Download all my data as JSON (requires the export.data entitlement) |

### admin

Content management and AI governance (permission-based)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/stats` | Platform and assessment statistics |
| `GET` | `/api/admin/competencies` | Competencies (all statuses) |
| `POST` | `/api/admin/competencies` | Create a competency (draft unless published explicitly) |
| `PUT` | `/api/admin/competencies/{competency_id}` | Edit a competency |
| `POST` | `/api/admin/competencies/{competency_id}/status` | Publish, unpublish or archive |
| `GET` | `/api/admin/questions` | Question bank (all versions) |
| `POST` | `/api/admin/questions` | Create Question |
| `PUT` | `/api/admin/questions/{question_id}` | Edit (versioned once answered) |
| `DELETE` | `/api/admin/questions/{question_id}` | Archive (history is preserved) |
| `POST` | `/api/admin/questions/{question_id}/status` | Publish or archive |
| `GET` | `/api/admin/assessments` | Assessments |
| `POST` | `/api/admin/assessments` | Create Assessment |
| `PUT` | `/api/admin/assessments/{assessment_id}` | Update Assessment |
| `GET` | `/api/admin/resources` | Resources |
| `POST` | `/api/admin/resources` | Create Resource |
| `PUT` | `/api/admin/resources/{resource_id}` | Update Resource |
| `DELETE` | `/api/admin/resources/{resource_id}` | Archive a resource (history is kept) |
| `POST` | `/api/admin/resources/{resource_id}/status` | Publish, unpublish, archive |
| `GET` | `/api/admin/tasks` | Tasks |
| `POST` | `/api/admin/tasks` | Create Task |
| `PUT` | `/api/admin/tasks/{task_id}` | Update Task |
| `DELETE` | `/api/admin/tasks/{task_id}` | Archive a task (submissions are kept) |
| `POST` | `/api/admin/tasks/{task_id}/status` | Publish, unpublish or archive |
| `GET` | `/api/admin/ai/evaluations` | AI evaluation log |
| `GET` | `/api/admin/ai/prompts` | Prompt versions |
| `POST` | `/api/admin/ai/prompts` | Create a new prompt version |
| `POST` | `/api/admin/ai/prompts/{prompt_id}/activate` | Activate a prompt version |
| `GET` | `/api/admin/translations/status` | Translation completeness of the content (ru, kk) |

### admin-users

User management, roles and account lifecycle (permission-based)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/users` | Search, filter, sort and page user accounts |
| `POST` | `/api/admin/users` | Create an account (no password: the person sets one through an emailed link) |
| `GET` | `/api/admin/users/{user_id}` | Full account details |
| `PATCH` | `/api/admin/users/{user_id}` | Edit name, email or interface language (reason required; send expected_version) |
| `DELETE` | `/api/admin/users/{user_id}` | Permanently delete a deactivated account (super admin; email confirmation required) |
| `POST` | `/api/admin/users/{user_id}/suspend` | Suspend (signs the user out) |
| `POST` | `/api/admin/users/{user_id}/deactivate` | Deactivate (data kept; permanent deletion is a separate step) |
| `POST` | `/api/admin/users/{user_id}/reactivate` | Reactivate a suspended account |
| `POST` | `/api/admin/users/{user_id}/revoke-sessions` | Sign the user out everywhere |
| `POST` | `/api/admin/users/{user_id}/password-reset` | Send the user a password reset link (staff never see or set passwords) |
| `POST` | `/api/admin/users/{user_id}/resend-verification` | Send the email confirmation link again |
| `POST` | `/api/admin/users/{user_id}/roles` | Grant a role |
| `DELETE` | `/api/admin/users/{user_id}/roles/{role_key}` | Revoke a role |

### admin-billing

Plans and subscriptions administration (permission-based)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/plans` | All plans, including inactive ones |
| `POST` | `/api/admin/plans` | Create a plan |
| `PATCH` | `/api/admin/plans/{plan_id}` | Edit a plan (price, limits, availability) |
| `GET` | `/api/admin/subscriptions` | Subscriptions with filters |
| `GET` | `/api/admin/subscription-events` | Subscription history |
| `POST` | `/api/admin/users/{user_id}/subscriptions` | Assign or change a user's plan (optionally time-limited); replaces the current subscription |
| `POST` | `/api/admin/subscriptions/{sub_id}/extend` | Extend the end date |
| `POST` | `/api/admin/subscriptions/{sub_id}/cancel` | Cancel now or at the end of the period |
| `POST` | `/api/admin/subscriptions/{sub_id}/status` | Change status along an allowed transition |

### admin-system

Analytics, roles, audit logs and settings (permission-based)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/me` | The caller's admin permissions (drives the admin navigation) |
| `GET` | `/api/admin/analytics/overview` | Dashboard metrics computed from the database |
| `GET` | `/api/admin/permissions` | Permission catalogue |
| `GET` | `/api/admin/roles` | Roles with their permissions and member counts |
| `POST` | `/api/admin/roles` | Create a custom role |
| `PUT` | `/api/admin/roles/{role_id}/permissions` | Replace a role's permissions |
| `GET` | `/api/admin/audit-logs` | Append-only audit log with filters |
| `GET` | `/api/admin/settings` | Configuration status (no secrets) |

### notifications



| Method | Path | Description |
|---|---|---|
| `GET` | `/api/notifications` | Notifications |
| `POST` | `/api/notifications/{notification_id}/read` | Mark Read |
