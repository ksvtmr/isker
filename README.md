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

## Accounts, roles and plans

| Seeded account (development defaults) | Role | Plan |
|---|---|---|
| `admin@isker.local` / `IskerAdmin2026` | super_admin | Free |
| `demo@isker.local` / `IskerDemo2026` | user | Pro (1-year admin grant) |

In production, set `ADMIN_PASSWORD` / `DEMO_PASSWORD`; accounts without a password are not created.

- **Roles:** `user`, `content_manager`, `support`, `admin`, `super_admin`. Permissions are checked on the server
  (`backend/app/services/permissions.py`). Staff can only manage accounts and grant roles ranked below their own;
  nobody can change their own roles; the last active super admin is protected.
- **Plans:** Free (core journey with limits), Pro and Premium. Limits are enforced by the API
  (`backend/app/services/entitlements.py`). No payment provider is integrated: paid plans are granted by admins at
  `/admin/users/:id`; signed provider webhooks are supported once configured (`PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET`).
- **Email:** without `SMTP_*` settings, development writes verification/reset emails to the server log and the UI says
  so; production sends nothing and says so. Nothing pretends an email was sent.
- **Security:** httpOnly session cookie + CSRF token, revocable server-side sessions, rate limits, security headers,
  append-only audit log. See [docs/admin-security-ux-report.md](docs/admin-security-ux-report.md) for what is and
  isn't covered.

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
# Browser journey + axe-core accessibility run against a running instance (API + built SPA on one origin):
cd scripts/e2e && npm install && BASE=http://localhost:8000 node journey.mjs
# Localization check in ru/kk/en (raw keys, wrong-language text, content language, switching, phone layout):
cd scripts/e2e && BASE=http://localhost:8000 node languages.mjs
# Regenerate docs/api.md, docs/database.md and docs/openapi.json from the code:
cd backend && .venv/bin/python scripts/gen_docs.py
```

## Documentation
- [docs/requirements.md](docs/requirements.md) — business requirements, product requirements, user stories
- [docs/architecture.md](docs/architecture.md) — components, scoring, gap and recommendation formulas, AI subsystem, security
- [docs/api.md](docs/api.md) — every endpoint (generated from OpenAPI; also `docs/openapi.json`)
- [docs/database.md](docs/database.md) — entities, constraints, all tables
- [docs/testing.md](docs/testing.md) — test suites and the end-to-end verification
- [docs/traceability.md](docs/traceability.md) — requirement → UI → API → DB → tests
- [docs/platform-audit.md](docs/platform-audit.md) — audit of the platform before the admin/security/UX overhaul
- [docs/admin-security-ux-report.md](docs/admin-security-ux-report.md) — what was implemented, tested, and what is left
- [docs/audit/full-system-audit.md](docs/audit/full-system-audit.md) — full system audit (Oct 2026): defects, root causes, fixes
- [docs/audit/localization-audit.md](docs/audit/localization-audit.md) — ru/kk/en coverage, content and AI language, fallback rules
- [docs/audit/admin-platform-consistency.md](docs/audit/admin-platform-consistency.md) — admin ↔ platform data consistency
- [docs/audit/test-results.md](docs/audit/test-results.md) — commands run and their actual results
- [docs/audit/remediation-plan.md](docs/audit/remediation-plan.md) — remaining work by priority
- [docs/audit/glossary.md](docs/audit/glossary.md) — Isker terminology in ru/kk/en
- [docs/localization.md](docs/localization.md), [docs/authentication.md](docs/authentication.md), [docs/google-oauth-setup.md](docs/google-oauth-setup.md)
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) — visual language and component catalogue

## Main routes
`/` · `/login` · `/register` · `/onboarding` · `/dashboard` · `/assessment` · `/assessment/:id` · `/results` ·
`/competencies` · `/competencies/:id` · `/development-plan` · `/learning` · `/learning/:id` · `/practice` ·
`/practice/:id` · `/progress` · `/profile` · `/settings` · `/plans` · `/forgot-password` · `/reset-password` ·
`/verify-email` · `/terms` · `/privacy`

Admin (each section requires its permission): `/admin` · `/admin/users` · `/admin/users/:id` · `/admin/roles` ·
`/admin/subscriptions` · `/admin/plans` · `/admin/assessments` · `/admin/competencies` · `/admin/learning-resources` ·
`/admin/analytics` · `/admin/ai` · `/admin/audit-logs` · `/admin/settings`
