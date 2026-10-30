# Character Progression System

A character that grows with the learner's confirmed entrepreneurial competencies: one hero, four stages
(Novice → Starter → Entrepreneur → Business leader), eight context states, and a stage history kept in the database.
This document describes what was actually built and checked.

## 1. Where the data comes from

The system adds no new measurement; it summarises results the platform already stores.

| Input | Source | Why it qualifies |
|---|---|---|
| Assessment score (0–100) | `services/profile.overall_score` over `current_scores`: the mean of the latest `competency_scores.score` of every published competency | Each competency score is already a 0–100 method-weighted score (`services/scoring.py`, version `v1`), so their mean is a valid 0–100 aggregate. It is the same "overall score" the dashboard and progress snapshots show. |
| Evidence coverage | `competency_scores.evidence_level` (`sufficient` / `limited` / `insufficient`, NULL for scores written before evidence was recorded) | Prevents summarising a thin profile as a stage. |
| Confirmed practice | `practice_submissions` with status `completed` whose latest `ai_evaluations` row has status `success` or `retried` | A heuristic fallback after a failed AI call (`fallback`) is not treated as confirmed. Tasks of unpublished competencies are ignored. |
| Not used | `user_learning_progress` (viewed/completed lessons), plan step clicks | Viewing lessons must not raise the stage. |

## 2. Stage rule

Implemented once, on the server: `backend/app/services/character.py`.

```
get_character_stage(UserProgress) -> StageResult      # pure function, unit-tested
collect_progress(db, user_id) -> UserProgress         # reads the confirmed inputs above
```

1. No completed **full** assessment → `status = "no_assessment"`; no stage.
2. Fewer than 80 % of published competencies scored, or fewer than 60 % of those with at least `limited` evidence →
   `status = "insufficient_data"`; no stage.
3. Stage score = assessment score; from **2** confirmed practical tasks:
   `0.8 × assessment score + 0.2 × mean practice score`.
4. Stage = band of the stage score:

| Stage | Key | Stage score |
|---|---|---|
| 1 Novice / Новичок | `novice` | 0–24 |
| 2 Starter / Стартапер | `starter` | 25–49 |
| 3 Entrepreneur / Предприниматель | `entrepreneur` | 50–74 |
| 4 Business leader / Бизнес-лидер | `leader` | 75–100 |

These are **preliminary product thresholds**, not a validated scale. They live in configuration
(`STAGE_BANDS`, `PRACTICE_WEIGHT`, `PRACTICE_MIN_TASKS`, `MIN_COVERAGE`, `MIN_EVIDENCE`) and every stored change records
`RULES_VERSION = "stage-v1"`; change the version whenever the rule changes. The interface says the same ("How is the
stage determined?") and repeats that the stage describes the current profile, not a person's worth.

Progress inside a stage: percent of the way from the band's lower bound to the next band, and the points still needed.

## 3. Transitions and history

Table `character_stage_events` (migration `0008`, additive):

| Column | Meaning |
|---|---|
| `user_id`, `sequence` (unique together) | Ordered, append-only history per learner |
| `stage`, `previous_stage`, `direction` (`initial` / `up` / `down`) | The change |
| `score`, `assessment_score`, `practice_score`, `practice_tasks`, `basis` (JSON) | What the stage rested on |
| `rules_version` | Rule used |
| `trigger` (`assessment` / `practice` / `baseline`), `attempt_id`, `practice_submission_id` | Which confirmed result caused it |
| `confirmed_at` | Date of the confirmed transition |
| `seen_at` | When the change was shown to the learner (the only field ever updated) |

When a row is written:

- `services/assessments.submit` calls `record_confirmed_result(...)` after scores, gaps, plan and snapshot are stored,
  **in the same transaction**. If the submit fails, no event exists.
- `POST /api/practice/tasks/{id}/complete` does the same with `trigger = "practice"`.
- A row is appended only when the stage differs from the last one. Past rows are never rewritten.
- Without enough data (`no_assessment` / `insufficient_data`) nothing is written; the last confirmed stage stays. A
  broken or partial read therefore cannot cause a false promotion or demotion.
- Learners whose results predate the feature get one `baseline` row the first time they open the app, already marked
  as seen (no congratulation). Concurrent requests are resolved by the `(user_id, sequence)` constraint.

API (`backend/app/api/routes/character.py`):

| Endpoint | Purpose |
|---|---|
| `GET /api/character` | Status, last confirmed stage, live stage score and progress to the next stage, basis, thresholds, pending (unseen, non-initial) change, full history |
| `POST /api/character/events/{id}/seen` | Marks a change as shown; idempotent; only the learner's own events (404 otherwise); ignores any body |

There is no endpoint that accepts a stage or score. `PUT/POST/PATCH /api/character` return 405.

If the live rule disagrees with the last confirmed stage without a new confirmed result (for example, content was
unpublished), the confirmed stage is shown and progress is measured inside it; the stage changes only with the next
confirmed result.

## 4. States

`frontend/src/character/config.ts` maps the interface context to a state; states are never random.

| Context | State |
|---|---|
| Dashboard, progress page | `idle` (gentle breathing, 3 cycles then still) |
| Assessment runner | `thinking`; the stage is frozen while the screen is open |
| Results | `confident`, or `supportive` when the overall score is below 40 |
| Learning resource | `learning` → short `happy` after "Mark as completed" |
| Practical task | `working` → short `happy` after completion, then `confident` |
| Confirmed promotion | `celebrating` (in the stage-change notice) |
| Lower result | `supportive`, neutral text, no celebration |

Reactions (`useCharacterReaction`) last 1.6 s (`happy`) and return to the context state; one at a time, timers are
cleared on unmount. There is no sad or disappointed character.

## 5. Assets

32 SVG illustrations in `frontend/src/assets/characters/stage-<1–4>-<state>.svg` (viewBox `0 0 200 280`, transparent).
Style: minimalist geometric figures in the spirit of 16Personalities (MBTI) illustrations — flat colours with one
facet of shade, simple faces — in the Isker palette.

- The same head, eyes, brows, nose and side-swept hair silhouette at every stage; age cues change (body proportions,
  a squarer jaw from stage 3, light stubble and grey temples at stage 4).
- Stage 1: hoodie in brand blue, green backpack, notebook. Stage 2: hoodie under a blazer, chinos, laptop.
  Stage 3: blue blazer and shirt, tablet. Stage 4: dark suit, slim tie, pocket square, watch; no luxury signs.
- Generated by `frontend/scripts/characters/generate.mjs` (`node frontend/scripts/characters/generate.mjs`). Any file
  can be replaced by an illustrator's version with the same name and viewBox; no code change is needed.
- Loaded through `import.meta.glob` (`config.ts`): a missing file fails the build instead of producing a broken path.
  `vite.config.ts` keeps these files as separate cached assets rather than inlining them. A test checks that all 32
  files exist and are valid SVGs; the avatar shows a same-size fallback if an image still fails to load.

Note: the requested "stylised 3D" look was replaced by the minimalist MBTI-like style the learner asked for in the
same request ("минималистичные как в MBTI"). No 3D engine or animation library was added.

## 6. Components

`frontend/src/character/`:

- `CharacterAvatar` — props `stage`, `state`, `size` (`xs` 56 / `sm` 88 / `md` 160 / `lg` 220 or pixels), `animated`,
  `showLabel`, `showProgress` + `progress`, `reducedMotion`, `crop`. Small sizes crop to head and shoulders. It has an
  `role="img"` text description ("Character: Entrepreneur, stage 3 of 4, thinking"); `stage = null` shows a neutral
  silhouette ("appears after your first assessment"), never an invented level.
- `CharacterPanel` — dashboard/results card: stage name, "Stage n of 4" chips (not colour alone), description, progress
  bar to the next stage, recommendation (top priority gap), basis, the rule explanation and the action.
- `StageChangeNotice` — inline, dismissible notice (not a modal) for a pending confirmed change.
- `CharacterAside` — compact character for assessment, learning and practice.
- `StageHistory` — progress page history with dates.

No screen computes a stage; all read `useCharacter()` (`GET /api/character`), which is invalidated with the other
profile queries after assessments and learning actions.

## 7. Animations

CSS only (`frontend/src/styles/app.css`, `.ik-char*`):

- Stage morph: the new illustration fades and sharpens in while the previous one fades out, 700 ms, then the old image
  is removed. It runs only when the stage prop changes, i.e. after the API confirmed a new stage.
- State animations play once (hop 0.6 s, rise 0.9 s, fade 0.3 s); idle breathing runs 3 cycles. No flashing, no large
  scaling, no confetti, nothing infinite.
- Reduced motion: `prefers-reduced-motion` (and the `reducedMotion` prop) disables every animation; the stage swaps
  without movement. The design system's global reduced-motion rule also applies.
- A change is congratulated once: the notice marks the event as seen on the server as soon as it is shown, keeps it
  visible for the rest of that visit, and a reload has nothing pending.

## 8. Integration

| Screen | What was added |
|---|---|
| Dashboard | Stage-change notice; character panel with stage, progress, recommendation and "Continue development" (the header button is kept only when the panel cannot load). Without an assessment: silhouette + "Take your first assessment" (or "Continue assessment"). |
| Assessment runner | Compact `thinking` character: "Take your time — your stage stays the same while you answer." |
| Results | Stage-change notice; character panel (confident / supportive) with "What your results mean for your stage" (assessment score, coverage, practice). Strengths and priority areas stay in the existing cards below. |
| Learning resource | Compact `learning` character with the current goal (the resource's competency); `happy` after completion. |
| Practical task | Stage-change notice; compact `working` character with the goal; `happy` after completion. |
| Progress | Stage history: current stage and stage score, every confirmed change with date and trigger, separated from the existing competency dynamics. |

Texts are in ru / kk / en (`frontend/src/i18n/locales/*/character.json`).

## 9. Tests and checks run

| Check | Result |
|---|---|
| `backend`: `pytest` (whole suite, incl. new `tests/test_character.py`, 25 tests) | passed |
| `ruff check app tests scripts browser`, `mypy app`, `scripts/check_migrations.py` | passed |
| Migrations on PostgreSQL 16: `alembic upgrade head`, `alembic check` (no drift), seed | passed |
| `frontend`: `vitest` (129 tests, incl. new `src/test/character.test.tsx`, 21 tests), `eslint`, `tsc` | passed |
| Production build (`npm run build`) | passed; 32 character SVGs emitted as separate assets |
| `scripts/e2e/journey.mjs` (learner + admin journey, axe-core WCAG 2.2 AA, keyboard, mobile) | passed, no violations |
| `scripts/e2e/languages.mjs` (ru / kk / en, 113 page checks) | passed |
| Manual run with the demo account (desktop 1366 px, phone 390 px) | a real reassessment produced a `down` notice (Entrepreneur → Starter), another one an `up` notice (Starter → Entrepreneur); after a reload neither appeared again; all avatar images loaded |

Covered by the new tests: stage boundaries (0/24/25/49/50/74/75/100), progress to the next stage, no stage before the
first full assessment, insufficient data, practice counted from two confirmed tasks, failed AI evaluation not counted,
unpublished competencies ignored, lessons not counted, initial / up / down transitions, history not rewritten, a
change shown once (server `seen` + no repeat after remount), no transitions from repeated dashboard/character loads,
silent baseline for existing profiles, no endpoint to set a stage (405) and private events (404), asset presence and
validity, image-load fallback, bust/full sizes, states per context, short reactions, reduced motion (prop and system).

## 10. Limits

- The thresholds and the 20 % practice weight are product choices to be reviewed with real data; they are versioned
  for that reason.
- The illustrations are generated vector art in a consistent style, not commissioned illustrations; they can be
  replaced file by file.
- The demo account's history now shows Starter → Entrepreneur (from its seeded assessments).
