# Admin panel and platform consistency

Audit date: 17 October 2026.

## 1. Data synchronization architecture

* **Single source of truth**: one PostgreSQL database. The admin panel and the learner platform call the same
  FastAPI backend and read the same tables; there is no second store, cache of users, or mock API.
* **All mutations go through the backend**, with server-side validation, permission checks
  (`require_permission`) and one commit per request. Multi-row operations (assigning a subscription, versioning a
  question, deleting a user) run in a single transaction.
* **Access is evaluated per request**: the session token carries only `sub`, `jti`, `ver`, `exp` and `iat`; roles,
  permissions, account status and entitlements are read from the database on every call, so admin changes apply
  on the next request even if a stale page is still open.
* **Concurrent edits**: users, competencies, questions, assessments, resources, tasks and plans carry
  `lock_version`. Editors send `expected_version`; a stale save gets 409 `VERSION_CONFLICT` with a "load latest
  version" action (no silent overwrite). SQLAlchemy's version check also catches races between two requests.
* **Content lifecycle**: draft → published → archived. Learners see published content only; archived content
  leaves new workflows but history (answers, scores, progress, submissions) stays readable. Answered questions are
  versioned instead of edited, so completed assessments stay reproducible.

## 2. Entities and workflows checked

| Workflow | Verified by |
|---|---|
| A user who registers (password or Google) appears in the admin user list; no duplicates under concurrency | `test_user_sync.py`, `test_google_oauth.py`, `test_audit_fixes.py` (concurrent register → 409) |
| Admin creates a user (invitation link, no admin-set password); the user can sign in per status | `test_user_sync.py` |
| Admin edits name/profile/language; the learner sees it | `test_user_sync.py`; browser journey |
| Block / unblock: protected APIs refused (401 `ACCOUNT_SUSPENDED`), sessions revoked, access restored | `test_user_sync.py`, `test_security.py`; browser journey (suspend → learner's session invalid → reactivate → sign in) |
| Role change changes backend permissions; no self-escalation; rank rules; last super-admin protected | `test_user_sync.py`, `test_rbac.py`, `test_audit_fixes.py` |
| Plan or subscription change changes entitlements and limits | `test_subscriptions.py`, `test_user_sync.py`; browser journey (grant Pro → learner has Pro) |
| New competency published appears; draft hidden | `test_content_sync.py` |
| Archived resource/task/question leaves new workflows, history kept; an archived step of an active plan can still be completed | `test_content_sync.py` |
| Translation edits appear in that language; stale translations flagged | `test_content_sync.py`, `test_localization_audit.py` |
| Two admins editing the same record: the second gets 409 | `test_content_sync.py`, `test_user_sync.py`, frontend `adminContentSync.test.tsx`, `userSync.test.tsx` |
| Reload keeps saved state | `test_content_sync.py`, `test_user_sync.py` |
| Admin dashboard and analytics figures come from the database | `test_admin.py`, `test_audit_fixes.py` (paid vs granted) |

## 3. API and database inconsistencies found and fixed

| Finding | Fix |
|---|---|
| Analytics counted admin-granted plans as paid | only payment-sourced subscriptions are "paid" |
| Admin stats, analytics and user goals showed English names to ru/kk admins (column queries bypassed translation) | entity queries |
| Two current subscriptions / two default plans / two open attempts possible | partial unique indexes (migration 0005) with data cleanup that expires or abandons duplicates (never deletes) |
| Deleting content would cascade-delete score history | foreign keys switched to RESTRICT |
| Race conditions returning 500 on register, profile, goals, progress, submissions, assessment submit | savepoints, conditional updates, 409 responses |
| Frontend types out of date (`Profile.language`, `Feedback.level`, `SessionInfo`) | aligned |
| `plan.personalized` entitlement never enforced | enforced on plan endpoints |
| Admin email change kept the user's sessions and reset links | revoked; old address notified |

## 4. Permission enforcement

Every admin endpoint requires a named permission (`users.view`, `users.manage`, `content.manage`, `ai.manage`,
`audit.view`, …). Enforcement is on the backend; the frontend hides actions the user can't perform (e.g. AI prompt
activation now requires `ai.manage` in the UI as well, matching the API). Users cannot change their own roles,
email (through the admin endpoint) or subscription; super-admin rights can only be granted by a super-admin; the
last super-admin can't be demoted, deactivated or deleted, also under concurrent requests.

## 5. Cache invalidation and live updates

* After a confirmed mutation, the frontend invalidates the affected react-query caches, including learner-side
  queries that show admin-edited content and the current user's own permissions.
* Other open pages refresh by polling `GET /api/sync/state` every 30 s and on window focus; it returns versions for
  the account, its access, entitlements and content, and only changed data is refetched. The current user and
  subscription are also refetched on focus and every 60 s.
* If an account is blocked, the next request returns 401 with the reason, the cache is cleared and the user is
  sent to the sign-in page with a localized explanation.
* No WebSocket/SSE push: security never depends on it, because every request is authorized on the server.

## 6. Data integrity findings

All migrations (0001–0006) were applied to a copy of the populated development database: row counts of users,
answers, competency scores, attempts, subscriptions and audit entries were identical before and after; downgrade
and upgrade succeeded; `alembic check` reports no drift. The audit log is append-only (database trigger on
PostgreSQL) and stores no passwords, tokens or OAuth subjects.

## 7. Remaining risks

* Polling means another admin's change can take up to 30 s to appear in an open page (access decisions are
  always current).
* `expected_version` is optional in the API for backward compatibility: a client that omits it does not get
  conflict protection (the admin UI always sends it).
* The in-memory rate limiter assumes a single API instance.
* Large lists (admin question/resource lists, learning resources) are loaded fully and paginated in Python; fine
  at the current size, needs database pagination if content grows (see remediation plan).
