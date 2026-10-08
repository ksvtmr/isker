# Isker

AI-powered platform for **assessing and developing entrepreneurial competencies**, built on the EntreComp framework
(15 competencies in 3 areas). Diploma MVP, Astana IT University.

**Product loop:** Assess → Profile → Identify Gaps → Recommend → Learn → Practice → Re-assess → Track Progress.

| | |
|---|---|
| Frontend | React 18, TypeScript, Vite, React Router, TanStack Query, React Hook Form + Zod, Tailwind (layout utilities only) |
| Design system | `design-system/` — tokens, styles and React components ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)) |
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic |
| Database | PostgreSQL 16 |
| AI | Provider abstraction: deterministic mock (default) or OpenAI; rubric-constrained, validated, logged |

## Public link (deploy in one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ksvtmr/isker)

The button creates a web service and a PostgreSQL database on Render's free plan from `render.yaml`. During
deployment you choose an admin password (`ADMIN_PASSWORD`), and optionally an `OPENAI_API_KEY`. After about 5–10
minutes the platform is available at a public address such as `https://isker.onrender.com`, which you can share.
The demo login is `demo@isker.local` / `IskerDemo2026`.

The single image (`Dockerfile` at the repository root) builds the frontend and serves it from the API on one origin.
Free Render services sleep after 15 minutes without traffic, so the first request after that takes about a minute.

## Develop in Docker (hot reload, nothing else to install)

```bash
docker compose -f docker-compose.dev.yml up      # first start takes a few minutes
```

- App: http://localhost:5173. Edit files in `frontend/`, `design-system/` or `backend/` and the page or API reloads by itself.
- API docs: http://localhost:8000/api/docs
- Demo: `demo@isker.local` / `IskerDemo2026`
- Stop with `Ctrl+C` or `docker compose -f docker-compose.dev.yml down`. Add `-v` to also wipe the local database.
- After changing `package.json` or `backend/requirements.txt`, restart with `--build`.

## Run with Docker (production-like)

```bash
cp .env.example .env      # optional; sensible development defaults are built in
docker compose up --build
```

- App: http://localhost:8080
- API docs (Swagger): http://localhost:8000/api/docs

On start the backend applies migrations and seeds the EntreComp catalogue, a 30-question assessment,
30 learning resources, 15 practical tasks and two accounts:

| Account | Email | Password (development default) |
|---|---|---|
| Demo learner, with three assessments of history, a plan in progress and completed activities | `demo@isker.local` | `IskerDemo2026` (or `DEMO_PASSWORD`) |
| Administrator | `admin@isker.local` | `IskerAdmin2026` (or `ADMIN_PASSWORD`) |

In `ENVIRONMENT=production` there are no default passwords. Accounts are created only when `DEMO_PASSWORD` or
`ADMIN_PASSWORD` is set, and the API refuses to start without a `JWT_SECRET` of at least 32 characters.

## Run locally (without Docker)

```bash
# Database
createdb isker   # or use docker compose up postgres

# Backend
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
export DATABASE_URL=postgresql+psycopg://isker:isker@localhost:5432/isker
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed.run
.venv/bin/uvicorn app.main:app --reload --port 8000

# Frontend (from the repository root: npm workspaces)
npm install
npm run dev        # http://localhost:5173, proxies /api to :8000
```

## AI configuration

| Variable | Effect |
|---|---|
| `MOCK_AI=true` (default) | Deterministic rubric-based provider. No network or key needed. |
| `MOCK_AI=false` + `OPENAI_API_KEY` | OpenAI Chat Completions in JSON mode (`OPENAI_MODEL`, default `gpt-4o-mini`) |

The key is only read by the backend. Every evaluation is validated, retried once if invalid and otherwise falls back
safely. Each one is logged with its prompt version, model, confidence and errors. Scores always come from rubric
ratings, never from a model-chosen number.

## Quality checks

```bash
cd backend && .venv/bin/pytest && .venv/bin/ruff check app tests && .venv/bin/mypy app
npm test && npm run typecheck && npm run lint && npm run build
```

## Documentation
- [docs/requirements.md](docs/requirements.md) — business requirements, product requirements, user stories
- [docs/architecture.md](docs/architecture.md) — components, scoring, gap and recommendation formulas, AI subsystem, security
- [docs/api.md](docs/api.md) — every endpoint (generated from OpenAPI; also `docs/openapi.json`)
- [docs/database.md](docs/database.md) — entities, constraints, all tables
- [docs/testing.md](docs/testing.md) — test suites and the end-to-end verification
- [docs/traceability.md](docs/traceability.md) — requirement → UI → API → DB → tests
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) — visual language and component catalogue

## Main routes
`/` · `/login` · `/register` · `/onboarding` · `/dashboard` · `/assessment` · `/assessment/:id` · `/results` ·
`/competencies` · `/competencies/:id` · `/development-plan` · `/learning` · `/learning/:id` · `/practice` ·
`/practice/:id` · `/progress` · `/profile` · `/settings` · `/admin` · `/admin/competencies` · `/admin/questions` ·
`/admin/assessments` · `/admin/resources` · `/admin/users` · `/admin/ai`
