# Assessment methodology, AI analysis and personalisation

## 1. Competency model

EntreComp: 3 areas, 15 competencies, stored in `competency_areas` / `competencies` with stable codes
(`spotting`, `creativity`, `vision`, `valuing`, `ethics`, `self-awareness`, `motivation`, `mobilizing-resources`,
`financial-literacy`, `mobilizing-others`, `initiative`, `planning`, `uncertainty`, `teamwork`,
`learning-experience`) and ru/kk/en translations. Nothing was renamed or replaced.

## 2. Assessment content (active assessment `entrecomp-core`, version 1)

30 published questions with stable IDs and per-question versions (`questions.version`, `previous_id`):

| Type | Count | Measures | Method weight |
|---|---|---|---|
| Self-assessment (Likert 1–5) | 15 | self-perception (one per competency) | 0.2 |
| Situational judgement (scenario, scored options) | 10 | judgement in a concrete situation | 0.4 |
| Open answer (behavioural / past experience) | 4 | demonstrated behaviour, scored against a rubric | 0.4 |
| Practical (short applied exercise) | 1 | applied skill, scored against a rubric | 0.4 |

Every competency has at least one item that is **not** a self-rating (test
`test_every_competency_is_covered_with_demonstrated_evidence`).

**Content gaps (documented, not invented):** *Planning & Management*, *Coping with uncertainty* and *Working with
others* rest on two items each (self-rating + one scenario), so their evidence level is "limited". There are no
knowledge questions yet. Administrators can add questions, options, rubrics and translations in Admin → Assessments
(publication status and versioning apply); new questions raise coverage without changing past results.

There is no adaptive question selection: every learner answers the same published set, so coverage is fixed and
comparable.

## 3. Scoring (deterministic, `services/scoring.py`, method `v1`)

1. Item score 0–100: choice questions use the option's stored score (reverse-scored Likert handled); open/practical
   answers use the rubric: every criterion is rated 0–4 (AI or the rule-based evaluator), and the score is
   `mean(rating / 4) × 100` — the model never sets a score directly.
2. Per competency: the mean per method, then `Σ weight × method mean / Σ weights present` (self 0.2, situational 0.4,
   open 0.4). Self-perception therefore never outweighs demonstrated behaviour.
3. Stored per competency (`competency_scores`, never overwritten): raw score, max raw score, normalised score
   (0–100), level, per-method scores, confidence, explanation, **evidence** (question ID, answer ID, method, weight,
   item score — no answer text), **evidence level** (`sufficient`: ≥3 answers from ≥2 methods incl. a demonstrated
   one; `limited`: ≥2 answers incl. a demonstrated one; otherwise `insufficient`), timestamp.
4. Stored per attempt: assessment version, scoring version (`v1`), answering language, completion time, overall
   score, sequence.

Scores are presented as estimates from the answers, not as a validated psychometric measurement; nothing diagnoses
personality, intelligence or health. Changing weights or item scoring requires a new `SCORING_VERSION`.

## 4. Gaps, recommendations and plan (deterministic)

`services/gaps.py`: gap = target − score; priority = gap × goal relevance (from the learner's goals) × importance ×
learning priority → rank and band. `services/recommendations.py`: for each priority gap, one published resource and
one published practical task of the right difficulty for the score, preferring the learner's format and skipping
completed items, plus a reflection step and a reassessment step. These are real rows (`recommendations`,
`learning_activities`); completion is recorded only by the learner's actions under explicit rules (resource marked
done; practice submission meeting its rubric threshold). Learning never changes competency scores: only a
reassessment does.

## 5. AI development analysis (`app/ai/analysis.py`)

After a full assessment the analysis explains the deterministic results; it never changes scores, gaps or plan items.

**Input ("facts", data-minimised):** language; assessment/scoring version; overall score; per competency: code,
name, area, score, level, per-method scores, evidence level, target, gap, priority rank; goal codes/titles;
experience level, weekly learning minutes, preferred format; counts of completed resources/tasks; the catalog of
up to 3 resources and 2 tasks per top-5 gap competency that are **published and available on the learner's plan**
(advanced resources only with the entitlement), with completion flags. No name, email, free-text answer or other
personal data (test `test_facts_contain_no_personal_data`).

**Output schema** (strict Pydantic, `DevelopmentAnalysis`):

```
summary: str
strengths: [{competency_code, explanation}]                      ≤5
development_areas: [{competency_code, explanation, priority 1-5}] ≤5
competency_insights: [{competency_code, insight}]                 ≤15
recommended_actions: [{competency_code, kind: learn|practice|reflect, resource_id?, task_id?, reason}] ≤10
milestones: [{competency_code, objective, measure, target_weeks 1-26}] ≤6
confidence_notes: [str]                                           ≤6
reassessment_weeks: int 2-26
language: ru|kk|en
```

(`learning_path` = the `learn` actions, `practice_tasks` = the `practice` actions.)

**Validation before saving:** JSON parse → schema → references: every competency code must be in the facts; a
`learn` action needs a catalog resource of the same competency, a `practice` action a catalog task of the same
competency, a `reflect` action neither → `language` field must equal the requested language → script check of the
summary alone and of all texts together (Cyrillic for ru/kk, Latin for en). Invalid output, a wrong language or a
provider error → retry (`AI_MAX_RETRIES`, default 1 → 2 tries; a 429 stops immediately) → `failed` with
`error_code` `invalid_output` | `wrong_language` | `provider_unavailable` | `rate_limited`.

**Lifecycle:** one row per attempt in `ai_analyses` (unique `attempt_id`), status `pending → succeeded | failed`,
runs counter, provider, model, prompt version, latency. Concurrent requests see `pending` and do not start a second
run; a `pending` row older than 3 minutes is treated as interrupted. Endpoints (owner only, attempt must be
completed): `GET /api/assessments/attempts/{id}/analysis`, `POST …/analysis {regenerate}` (rate limit
`ai_analysis_user`: 10 runs per user per hour). Display: model texts as written; competency names, scores and
resource/task titles are read from the database at display time, and an item that is no longer published/available is
shown without a link.

**Providers** (`app/ai/providers.py`): `GeminiProvider` (Generative Language API `generateContent`, JSON response
mode, key in the `x-goog-api-key` header), `OpenAIProvider` (Chat Completions, JSON mode), `MockAIProvider`
(rule-based, deterministic, texts from the backend catalog in ru/kk/en; labelled "Built-in rule-based analysis" in the
interface and re-rendered in the reader's language). Prompts are versioned in `ai_prompt_versions`
(`development_analysis` v1; admins create/activate new versions).

**Existing AI parts reused:** rubric evaluation of open answers and practice submissions (scores from criterion
ratings), profile insight; both keep their existing documented rule-based fallback when a provider call fails, recorded
as `fallback` in the AI evaluation log.

## 6. Reassessment and comparison

Every attempt is kept with its versions. `services/profile.comparison(previous, current)`: `same` (same scoring
method and assessment version), `content_changed` (same method, questions revised — change shown with a note),
`method_changed` (no change number is computed). Applied to the results "change" values and to progress trends
(`change_since_previous`, `change_since_first`).

## 7. Admin

Admin → AI governance: evaluations log, **Development analyses** (status counts, provider/model, language, error code,
runs, latency — no answers or texts; retry for failed runs with `ai.manage`, audited), prompt versions (incl.
`development_analysis`). Competencies, questions/options/rubrics, versions and publication status, resources, tasks,
translations completeness, users and assessment history are managed in the existing admin modules.
