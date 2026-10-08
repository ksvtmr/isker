# Database

PostgreSQL 16, managed with **SQLAlchemy 2** models (`backend/app/models/`) and **Alembic** migrations
(`backend/alembic/versions/`). 29 normalised tables. JSON is used only for genuinely unstructured payloads
(rubric definitions, AI outputs and evidence lists, audit details).

## Entity overview

```
users 1─1 user_profiles          users 1─* user_goals *─1 goal_definitions 1─* goal_competency_weights *─1 competencies
competency_areas 1─* competencies          competency_levels (5 bands)
assessments 1─* questions 1─* question_options
                questions 1─* question_competencies *─1 competencies   (weight)
users 1─* assessment_attempts 1─* answers *─1 questions / question_options
          assessment_attempts 1─* competency_scores   (immutable history, one row per competency per attempt)
          assessment_attempts 1─* competency_gaps     (target, gap, band, priority components, rank)
          assessment_attempts 1─1 progress_snapshots  (overall + area scores at that moment)
          assessment_attempts 1─0..1 reassessments    (links to the previous attempt)
competency_gaps 1─* recommendations *─1 learning_resources / practical_tasks / goal_definitions
recommendations 1─4 learning_activities  (learn → practice → reflect → reassess)
users 1─* user_learning_progress *─1 learning_resources      users 1─* practice_submissions *─1 practical_tasks
ai_prompt_versions 1─* ai_evaluations *─0..1 answers / practice_submissions / assessment_attempts
users 1─* notifications      users 1─* audit_logs      revoked_tokens (JWT denylist)
```

## Integrity rules
- Every foreign key is explicit with an `ON DELETE` policy (user data cascades; catalogue rows are `RESTRICT`).
- Unique constraints: one answer per question per attempt; one score/gap per competency per attempt; one
  progress row per user and resource; one submission per user and task; one active plan step per kind per recommendation.
- CHECK constraints: option and competency scores 0–100, mapping weights 0–1, progress 0–100, and every enum column
  (stored as VARCHAR + CHECK so migrations stay portable).
- **History is never overwritten.** Each completed attempt writes new `competency_scores`, `competency_gaps` and a
  `progress_snapshot`. The "current profile" is the latest score per competency.
- Indexes on all foreign keys used for lookups, plus `users.email`, `competencies.code`, attempt status and created_at columns.

## Migrations
```bash
cd backend
alembic upgrade head                                  # apply
alembic revision --autogenerate -m "describe change"  # create
alembic check                                         # verify models and migrations match
```

## Tables

### `ai_prompt_versions`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `key` | VARCHAR(64) | no | indexed |
| `version` | INTEGER | no |  |
| `system_prompt` | TEXT | no |  |
| `user_template` | TEXT | no |  |
| `notes` | TEXT | yes |  |
| `is_active` | BOOLEAN | no |  |
| `created_at` | DATETIME | no |  |

Unique: (key, version)

### `assessments`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `code` | VARCHAR(48) | no | unique |
| `title` | VARCHAR(160) | no |  |
| `description` | TEXT | no |  |
| `kind` | VARCHAR(32) | no |  |
| `version` | INTEGER | no |  |
| `estimated_minutes` | INTEGER | no |  |
| `is_active` | BOOLEAN | no |  |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

Unique: (code)

### `competency_areas`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `code` | VARCHAR(32) | no | unique |
| `name` | VARCHAR(80) | no |  |
| `color_token` | VARCHAR(48) | no |  |
| `sort_order` | INTEGER | no |  |

Unique: (code)

### `competency_levels`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `rank` | INTEGER | no |  |
| `name` | VARCHAR(32) | no | unique |
| `min_score` | INTEGER | no |  |
| `max_score` | INTEGER | no |  |
| `description` | TEXT | no |  |

Unique: (rank); (name)

### `goal_definitions`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `code` | VARCHAR(48) | no | unique |
| `title` | VARCHAR(160) | no |  |
| `description` | TEXT | yes |  |
| `sort_order` | INTEGER | no |  |

Unique: (code)

### `revoked_tokens`

| Column | Type | Null | Notes |
|---|---|---|---|
| `jti` | VARCHAR(64) | no | PK |
| `expires_at` | DATETIME | no | indexed |

### `users`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `email` | VARCHAR(255) | no | unique, indexed |
| `password_hash` | VARCHAR(255) | no |  |
| `full_name` | VARCHAR(120) | no |  |
| `role` | VARCHAR(32) | no |  |
| `is_active` | BOOLEAN | no |  |
| `onboarding_completed` | BOOLEAN | no |  |
| `last_login_at` | DATETIME | yes |  |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

### `audit_logs`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `user_id` | INTEGER | yes | FK → `users.id` (SET NULL), indexed |
| `action` | VARCHAR(64) | no | indexed |
| `entity_type` | VARCHAR(64) | yes |  |
| `entity_id` | INTEGER | yes |  |
| `details` | JSON | yes |  |
| `created_at` | DATETIME | no | indexed |

### `competencies`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `code` | VARCHAR(48) | no | unique, indexed |
| `area_id` | INTEGER | no | FK → `competency_areas.id` (RESTRICT), indexed |
| `name` | VARCHAR(120) | no |  |
| `short_name` | VARCHAR(40) | no |  |
| `description` | TEXT | no |  |
| `hint` | TEXT | yes |  |
| `reflection_prompt` | TEXT | yes |  |
| `importance` | FLOAT | no |  |
| `learning_priority` | FLOAT | no |  |
| `default_target` | INTEGER | no |  |
| `sort_order` | INTEGER | no |  |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

### `notifications`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), indexed |
| `type` | VARCHAR(48) | no |  |
| `title` | VARCHAR(200) | no |  |
| `body` | TEXT | yes |  |
| `link` | VARCHAR(255) | yes |  |
| `is_read` | BOOLEAN | no | indexed |
| `created_at` | DATETIME | no |  |

### `questions`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `assessment_id` | INTEGER | no | FK → `assessments.id` (CASCADE), indexed |
| `sort_order` | INTEGER | no |  |
| `type` | VARCHAR(32) | no |  |
| `section` | VARCHAR(64) | no |  |
| `text` | TEXT | no |  |
| `help_text` | TEXT | yes |  |
| `rubric` | JSON | yes |  |
| `reverse_scored` | BOOLEAN | no |  |
| `min_length` | INTEGER | no |  |
| `is_active` | BOOLEAN | no |  |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

### `user_goals`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), indexed |
| `goal_id` | INTEGER | no | FK → `goal_definitions.id` (RESTRICT) |
| `note` | VARCHAR(255) | yes |  |
| `created_at` | DATETIME | no |  |

Unique: (user_id, goal_id)

### `user_profiles`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), unique |
| `education` | VARCHAR(120) | yes |  |
| `background` | TEXT | yes |  |
| `entrepreneurial_experience` | VARCHAR(32) | no |  |
| `business_experience` | TEXT | yes |  |
| `preferred_learning_format` | VARCHAR(32) | no |  |
| `weekly_learning_minutes` | INTEGER | no |  |
| `language` | VARCHAR(8) | no |  |
| `notify_reassessment` | BOOLEAN | no |  |
| `notify_weekly_summary` | BOOLEAN | no |  |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

Unique: (user_id)

### `assessment_attempts`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), indexed |
| `assessment_id` | INTEGER | no | FK → `assessments.id` (RESTRICT), indexed |
| `scope` | VARCHAR(32) | no |  |
| `scope_competency_id` | INTEGER | yes | FK → `competencies.id` (SET NULL) |
| `status` | VARCHAR(32) | no | indexed |
| `current_index` | INTEGER | no |  |
| `started_at` | DATETIME | no |  |
| `completed_at` | DATETIME | yes |  |
| `overall_score` | INTEGER | yes |  |
| `sequence` | INTEGER | no |  |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

### `goal_competency_weights`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `goal_id` | INTEGER | no | FK → `goal_definitions.id` (CASCADE), indexed |
| `competency_id` | INTEGER | no | FK → `competencies.id` (CASCADE), indexed |
| `weight` | FLOAT | no |  |

Unique: (goal_id, competency_id)

### `learning_resources`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `slug` | VARCHAR(120) | no | unique |
| `competency_id` | INTEGER | no | FK → `competencies.id` (RESTRICT), indexed |
| `title` | VARCHAR(200) | no |  |
| `description` | TEXT | no |  |
| `type` | VARCHAR(32) | no |  |
| `difficulty` | VARCHAR(32) | no |  |
| `duration_minutes` | INTEGER | no |  |
| `content` | TEXT | no |  |
| `url` | VARCHAR(500) | yes |  |
| `is_published` | BOOLEAN | no |  |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

Unique: (slug)

### `practical_tasks`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `slug` | VARCHAR(120) | no | unique |
| `competency_id` | INTEGER | no | FK → `competencies.id` (RESTRICT), indexed |
| `title` | VARCHAR(200) | no |  |
| `description` | TEXT | no |  |
| `instructions` | TEXT | no |  |
| `difficulty` | VARCHAR(32) | no |  |
| `duration_minutes` | INTEGER | no |  |
| `rubric` | JSON | no |  |
| `min_length` | INTEGER | no |  |
| `is_published` | BOOLEAN | no |  |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

Unique: (slug)

### `question_competencies`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `question_id` | INTEGER | no | FK → `questions.id` (CASCADE), indexed |
| `competency_id` | INTEGER | no | FK → `competencies.id` (CASCADE), indexed |
| `weight` | FLOAT | no |  |

Unique: (question_id, competency_id)

### `question_options`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `question_id` | INTEGER | no | FK → `questions.id` (CASCADE), indexed |
| `sort_order` | INTEGER | no |  |
| `label` | TEXT | no |  |
| `score` | INTEGER | no |  |
| `value` | INTEGER | yes |  |

### `answers`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `attempt_id` | INTEGER | no | FK → `assessment_attempts.id` (CASCADE), indexed |
| `question_id` | INTEGER | no | FK → `questions.id` (CASCADE), indexed |
| `option_id` | INTEGER | yes | FK → `question_options.id` (SET NULL) |
| `text_response` | TEXT | yes |  |
| `item_score` | FLOAT | yes |  |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

Unique: (attempt_id, question_id)

### `competency_gaps`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `attempt_id` | INTEGER | no | FK → `assessment_attempts.id` (CASCADE), indexed |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), indexed |
| `competency_id` | INTEGER | no | FK → `competencies.id` (CASCADE), indexed |
| `current_score` | INTEGER | no |  |
| `target_score` | INTEGER | no |  |
| `gap` | INTEGER | no |  |
| `band` | VARCHAR(32) | no |  |
| `goal_relevance` | FLOAT | no |  |
| `importance` | FLOAT | no |  |
| `learning_priority` | FLOAT | no |  |
| `priority_score` | FLOAT | no |  |
| `priority_rank` | INTEGER | no |  |
| `priority_label` | VARCHAR(16) | no |  |
| `created_at` | DATETIME | no |  |

Unique: (attempt_id, competency_id)

### `competency_scores`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `attempt_id` | INTEGER | no | FK → `assessment_attempts.id` (CASCADE), indexed |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), indexed |
| `competency_id` | INTEGER | no | FK → `competencies.id` (CASCADE), indexed |
| `raw_score` | FLOAT | no |  |
| `max_raw_score` | FLOAT | no |  |
| `score` | INTEGER | no |  |
| `level_id` | INTEGER | no | FK → `competency_levels.id` (RESTRICT) |
| `self_score` | FLOAT | yes |  |
| `situational_score` | FLOAT | yes |  |
| `open_score` | FLOAT | yes |  |
| `confidence` | FLOAT | no |  |
| `explanation` | TEXT | no |  |
| `created_at` | DATETIME | no | indexed |

Unique: (attempt_id, competency_id)

### `practice_submissions`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), indexed |
| `task_id` | INTEGER | no | FK → `practical_tasks.id` (CASCADE), indexed |
| `status` | VARCHAR(32) | no |  |
| `response_text` | TEXT | yes |  |
| `feedback_score` | INTEGER | yes |  |
| `started_at` | DATETIME | no |  |
| `submitted_at` | DATETIME | yes |  |
| `completed_at` | DATETIME | yes |  |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

Unique: (user_id, task_id)

### `progress_snapshots`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), indexed |
| `attempt_id` | INTEGER | no | FK → `assessment_attempts.id` (CASCADE), unique |
| `overall_score` | INTEGER | no |  |
| `ideas_score` | INTEGER | no |  |
| `resources_score` | INTEGER | no |  |
| `action_score` | INTEGER | no |  |
| `level` | VARCHAR(32) | no |  |
| `completed_resources` | INTEGER | no |  |
| `completed_tasks` | INTEGER | no |  |
| `plan_progress_pct` | INTEGER | no |  |
| `created_at` | DATETIME | no | indexed |

Unique: (attempt_id)

### `reassessments`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), indexed |
| `attempt_id` | INTEGER | no | FK → `assessment_attempts.id` (CASCADE), unique |
| `previous_attempt_id` | INTEGER | yes | FK → `assessment_attempts.id` (SET NULL) |
| `competency_id` | INTEGER | yes | FK → `competencies.id` (SET NULL) |
| `reason` | VARCHAR(255) | yes |  |
| `created_at` | DATETIME | no |  |

Unique: (attempt_id)

### `user_learning_progress`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), indexed |
| `resource_id` | INTEGER | no | FK → `learning_resources.id` (CASCADE), indexed |
| `status` | VARCHAR(32) | no |  |
| `progress_pct` | INTEGER | no |  |
| `started_at` | DATETIME | yes |  |
| `completed_at` | DATETIME | yes |  |
| `last_accessed_at` | DATETIME | yes |  |
| `created_at` | DATETIME | no |  |
| `updated_at` | DATETIME | no |  |

Unique: (user_id, resource_id)

### `ai_evaluations`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `user_id` | INTEGER | yes | FK → `users.id` (CASCADE), indexed |
| `attempt_id` | INTEGER | yes | FK → `assessment_attempts.id` (CASCADE), indexed |
| `answer_id` | INTEGER | yes | FK → `answers.id` (CASCADE), indexed |
| `practice_submission_id` | INTEGER | yes | FK → `practice_submissions.id` (CASCADE), indexed |
| `competency_id` | INTEGER | yes | FK → `competencies.id` (SET NULL) |
| `prompt_version_id` | INTEGER | yes | FK → `ai_prompt_versions.id` (SET NULL) |
| `input_type` | VARCHAR(32) | no |  |
| `provider` | VARCHAR(32) | no |  |
| `model` | VARCHAR(64) | no |  |
| `status` | VARCHAR(32) | no |  |
| `input_excerpt` | TEXT | yes |  |
| `output` | JSON | yes |  |
| `score` | INTEGER | yes |  |
| `level` | VARCHAR(32) | yes |  |
| `confidence` | FLOAT | yes |  |
| `evidence` | JSON | yes |  |
| `strengths` | JSON | yes |  |
| `development_areas` | JSON | yes |  |
| `explanation` | TEXT | yes |  |
| `error` | TEXT | yes |  |
| `attempts` | INTEGER | no |  |
| `latency_ms` | INTEGER | yes |  |
| `created_at` | DATETIME | no | indexed |

### `recommendations`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), indexed |
| `attempt_id` | INTEGER | no | FK → `assessment_attempts.id` (CASCADE), indexed |
| `gap_id` | INTEGER | no | FK → `competency_gaps.id` (CASCADE) |
| `competency_id` | INTEGER | no | FK → `competencies.id` (CASCADE), indexed |
| `goal_id` | INTEGER | yes | FK → `goal_definitions.id` (SET NULL) |
| `resource_id` | INTEGER | yes | FK → `learning_resources.id` (SET NULL) |
| `task_id` | INTEGER | yes | FK → `practical_tasks.id` (SET NULL) |
| `priority` | INTEGER | no |  |
| `priority_score` | FLOAT | no |  |
| `reason` | TEXT | no |  |
| `status` | VARCHAR(32) | no | indexed |
| `created_at` | DATETIME | no |  |
| `completed_at` | DATETIME | yes |  |

### `learning_activities`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | INTEGER | no | PK |
| `recommendation_id` | INTEGER | no | FK → `recommendations.id` (CASCADE), indexed |
| `user_id` | INTEGER | no | FK → `users.id` (CASCADE), indexed |
| `kind` | VARCHAR(32) | no |  |
| `sort_order` | INTEGER | no |  |
| `title` | VARCHAR(255) | no |  |
| `resource_id` | INTEGER | yes | FK → `learning_resources.id` (SET NULL) |
| `task_id` | INTEGER | yes | FK → `practical_tasks.id` (SET NULL) |
| `prompt` | TEXT | yes |  |
| `response_text` | TEXT | yes |  |
| `status` | VARCHAR(32) | no |  |
| `completed_at` | DATETIME | yes |  |

Unique: (recommendation_id, kind)
