# Architecture

```
Browser (React SPA, design system)
   │  same-origin /api  (httpOnly session cookie)
   ▼
nginx (Docker) / Vite proxy (dev)
   ▼
FastAPI  ── routes (app/api/routes) ── services (app/services) ── models (app/models) ── PostgreSQL
                                          │
                                          └── AI subsystem (app/ai): provider → validation → retry → fallback → audit
```

AI is a **subsystem**, not the product. The product loop is implemented as deterministic services:

```
EntreComp catalogue ─► Assessment engine ─► Scoring engine ─► AI evaluation (rubric-constrained)
   ─► Competency profile ─► Gap analysis ─► Recommendation engine ─► Development plan
   ─► Learning / Practice / Reflection ─► Reassessment ─► Progress snapshots
```

## Repository layout

| Path | Purpose |
|---|---|
| `design-system/` | Tokens, styles, React components (single source of truth, npm workspace) |
| `frontend/src/api/` | The only place that talks to the server: `client.ts` (fetch + error envelope), one module per domain with TanStack Query hooks, `keys.ts` for cache invalidation |
| `frontend/src/pages/` | Route screens (learner + `admin/`) |
| `frontend/src/layouts/` | App shell (sidebar / collapsed sidebar / bottom nav), focus layout, auth guards |
| `frontend/src/features/` | Zod schemas and form option lists |
| `backend/app/core/` | Settings, database, error envelope, password hashing and JWT |
| `backend/app/models/` | SQLAlchemy models (29 tables) |
| `backend/app/schemas/` | Pydantic request/response models (OpenAPI) |
| `backend/app/services/` | Domain logic: `assessments`, `scoring`, `gaps`, `recommendations`, `profile`, `views`, `levels`, `audit` |
| `backend/app/ai/` | `providers.py` (AIProvider, MockAIProvider, OpenAIProvider), `service.py` (validation, retry, fallback, logging), `prompts.py`, `schemas.py` |
| `backend/app/seed/` | EntreComp content, question bank, resources, tasks, demo history |

## Key flows

**Submit assessment** (`POST /api/assessments/attempts/{id}/submit`, one transaction):
1. Check every question in scope is answered (open answers meet their minimum length).
2. Score choice items from option scores (likert reverse-scoring applied).
3. Evaluate open and practical answers with the AI provider against the question rubric. The model rates each criterion 0–4; the **score is recomputed from the ratings**, and criteria tagged with a competency count only towards that competency.
4. Combine per competency: self-assessment 20%, situational 40%, open 40% (renormalised when a method is absent) → `competency_scores`.
5. Profile = latest score per competency → overall score.
6. Gap analysis for all 15 competencies → `competency_gaps` (target, gap, band, priority, rank).
7. Recommendation engine refreshes the plan (keeps relevant in-progress items, closes completed cycles, creates new ones).
8. Progress snapshot, AI profile insight (logged), notification and audit log.

**Scoring and levels** (`services/levels.py`): Foundation 0–39, Developing 40–59, Intermediate 60–79, Advanced 80–89, Proficient 90–100 (design-system bands).

**Gap priority** (`services/gaps.py`): `0.5·min(gap/30,1) + 0.25·goal relevance + 0.15·importance + 0.10·learning priority`. The target is 70, or 75 when the competency is central (≥0.7) to the user's goals.

**Recommendation ranking** (`services/recommendations.py`): +5 not completed, +3 difficulty matches the level (+1 adjacent), +2 preferred format, +1 fits in half the weekly time, +1 already in progress. Each recommendation stores competency, gap, goal, resource, task, priority and a human-readable reason.

## AI subsystem
- `AIProvider` interface → `MockAIProvider` (deterministic rubric heuristics, default; `MOCK_AI=true` or no key) and `OpenAIProvider` (Chat Completions, JSON mode, `OPENAI_API_KEY` server-side only).
- Output is validated with Pydantic (`EvaluationOutput`): ranges, every rubric criterion rated. If it is invalid, the call is retried once with a correction instruction, then falls back to the heuristic (`status=fallback`, confidence capped at 0.5). The assessment never fails because of the AI.
- Governance: every call writes `ai_evaluations` (prompt version, provider, model, input excerpt, validated output, score, confidence, evidence, errors, attempts, latency). Prompts are versioned in `ai_prompt_versions`, and admins can create and activate versions.
- Explainability: competency pages show the method breakdown, rubric criteria, evidence quotes and the model or prompt version.

## Security
bcrypt password hashing; JWT with expiry and a server-side revocation list; httpOnly SameSite=Lax cookie (Secure via `COOKIE_SECURE`); role-based admin dependency; all queries via the SQLAlchemy ORM (parameterised); Pydantic validation on every input; per-user ownership checks on attempts, activities and evaluations; CORS allow-list from env; no secrets or API keys reach the frontend; errors never expose stack traces; audit logs never store passwords or tokens. Production refuses to start without `JWT_SECRET`.
