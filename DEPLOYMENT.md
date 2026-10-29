# Deployment, environments and CI/CD

Isker is deployed as **one Docker image** (the API also serves the built frontend, same origin, no CORS) plus **one
PostgreSQL database**, on [Render](https://render.com), described by `render.yaml` (a Render Blueprint). Checks run
on **GitHub Actions** (`.github/workflows/ci.yml`). A Russian step-by-step guide for daily work is in
[docs/claude-code-workflow.ru.md](docs/claude-code-workflow.ru.md).

## 1. Why this setup

* The repository already targeted Render (Blueprint, root `Dockerfile`, health check), so nothing was migrated.
* One image for frontend and backend: a release is atomic (UI and API always match), cookies and CSRF work on one
  origin, and there is one thing to roll back.
* Render can wait for GitHub checks before deploying (`autoDeployTrigger: checksPass`), offers preview environments
  for pull requests, keeps previous deploys for one-click rollback, and stores secrets outside Git.

## 2. Environments

| | Local (your computer / Claude Code session) | CI (GitHub Actions) | Preview (pull request) | Production |
|---|---|---|---|---|
| Purpose | write and try changes | prove a change is safe | try a change on the internet before release | the public site |
| Started by | `npm run dev:all` | every PR and every push to `main` | a PR whose title contains `[render preview]` | merge into `main` + green checks |
| URL | http://localhost:5173 (app), :8000 (API) | none (logs and artifacts) | Render shows it on the PR and in the dashboard | Render service URL, e.g. `https://<service>.onrender.com` |
| Database | local PostgreSQL (`isker`) | throw-away PostgreSQL in the runner | **its own new database**, created for the preview, seeded with demo data, deleted with the preview | production database |
| Secrets | none needed (dev defaults); optional `.env` | none (test-only values in the workflow) | same variables as production (Render) | Render → service → Environment |
| Who sees it | you | — | anyone with the link | everyone |

Preview environments never touch the production database: Render creates a fresh database from `render.yaml` for
each preview (`previews.generation: manual`, expires after 3 days).

## 3. Continuous integration (`.github/workflows/ci.yml`)

Runs on every pull request and every push to `main` (and manually). Jobs, all using the project's own commands:

| Job | Steps |
|---|---|
| Backend | `pip install -r requirements-dev.txt` (cached) → `ruff check app tests scripts browser` → `mypy app` → `python scripts/check_migrations.py` (no undocumented destructive migration) → `pytest` (274 tests, SQLite; includes ru/kk content-translation completeness) → on PostgreSQL 16: `alembic upgrade head`, `alembic check` (models = migrations), seed, `alembic downgrade base`, `alembic upgrade head`, seed twice (idempotent) |
| Frontend | `npm ci` (cached, lockfile) → `npm run lint` → `npm run typecheck` → translation completeness ru/kk/en (`src/test/i18n.test.ts`) → `npm test` (97 tests) → `npm run build` |
| End-to-end | after Backend and Frontend: PostgreSQL + migrations + seed → API serving the built SPA → Playwright: `scripts/e2e/journey.mjs` (learner and admin journey, axe-core WCAG 2.2 AA, keyboard, mobile) and `scripts/e2e/languages.mjs` (113 page checks in ru/kk/en). Screenshots and the API log are uploaded when it fails |
| Production image | builds the root `Dockerfile` (what Render deploys), with build cache |

No secrets are used or printed: test-only values are set in the workflow file. A red job marks the commit red, and
Render does not deploy a red commit from `main`.

## 4. Continuous deployment (Render)

`render.yaml`:

* `branch: main` — only `main` is deployed to production.
* `autoDeployTrigger: checksPass` — after a push to `main`, Render waits until the GitHub checks of that commit pass,
  then deploys. If any check fails, nothing is deployed.
* `healthCheckPath: /api/health` — the new release receives traffic only when it answers 200 with the database
  reachable; otherwise the deploy is marked failed and the previous release keeps serving.

What a deploy does (`backend/docker-entrypoint.sh`): build the image → `alembic upgrade head` → seed reference data
(idempotent, never deletes) → start the server → health check → switch traffic. Migrations never reset the database.

### Smoke check after a deploy

```bash
bash scripts/smoke.sh https://<your-service>.onrender.com
```

Read-only checks: health + database, home page, deep links, sign-in providers, protected API returns 401, public
plans, security headers (CSP, HSTS), translated content in Kazakh. Also available in GitHub → Actions →
"Smoke check (deployed site)" (`.github/workflows/smoke.yml`), on demand or daily once the repository variable
`PRODUCTION_URL` is set.

## 5. One-time setup (needs your accounts)

These steps can only be done by the account owner; nothing in the repository can do them.

1. **Merge the CI/CD setup into `main`.** On GitHub open a pull request from `claude/sleepy-darwin-ycx2me` into
   `main` (*Compare & pull request*), wait for the green checks, then *Merge pull request*. From then on `main` is the
   production branch.
2. **Create the Render services from the Blueprint.** Render → *New* → *Blueprint* → connect GitHub and choose
   `ksvtmr/isker` (or use https://render.com/deploy?repo=https://github.com/ksvtmr/isker). Render reads
   `render.yaml`, asks for `ADMIN_PASSWORD` (and optionally `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`), and creates the web service `isker` and the database `isker-db`.
   If the services already exist (created earlier with the Deploy button), open the Blueprint in Render and
   choose *Sync* so the new `branch` / `autoDeployTrigger` / `previews` settings apply.
3. **Let Render see GitHub checks.** Render needs its GitHub app installed on the repository (done when you connect
   the repo). Without it `checksPass` can't see the CI results.
4. **Protect `main` on GitHub** (Settings → Branches → Add rule for `main`): require a pull request before merging,
   require status checks to pass — select *Backend — lint, types, tests, migrations*, *Frontend — lint, types,
   tests, translations, build*, *End-to-end — browser journey and ru/kk/en check*, *Production image builds* — and
   block force pushes. This stops anything unverified from reaching `main`.
5. **Tell the smoke check where production is:** GitHub → Settings → Secrets and variables → Actions → *Variables* →
   `PRODUCTION_URL` = your Render URL.
6. **Preview environments** need a Render workspace plan that includes Preview Environments. With it, add
   `[render preview]` to a pull request title to get a preview; without it, test pull requests locally.
7. **GitHub Pages address** (works without Render, see below): Settings → Pages → *Build and deployment* →
   Source: **GitHub Actions**. Then Actions → *GitHub Pages* → *Run workflow* (later merges to `main` publish it
   automatically after green checks). The site is https://ksvtmr.github.io/isker/ .

### GitHub Pages (no server needed)

GitHub Pages serves static files only, so `.github/workflows/pages.yml` publishes a **standalone** build: the real
API (`backend/app`, the same Python code, scoring, permissions and seed data as on Render) runs **inside the
visitor's browser** with [Pyodide](https://pyodide.org), on SQLite instead of PostgreSQL.

* `backend/browser/build.py` packs the Pyodide runtime (self-hosted from its GitHub release, about 21 MB, cached by
  the browser after the first visit), the few extra Python packages (`backend/browser/requirements.txt`) and
  `backend/app` into `frontend/dist/pyodide/`; `backend/browser/smoke.mjs` tests that exact package before publishing
  (health, sign-in, dashboard, Kazakh content, registration, admin list, sign-out).
* The interface is built with `VITE_STANDALONE=true`: `src/api/client.ts` sends requests to a Web Worker
  (`src/standalone/worker.ts`) instead of the network. Sign-in uses the session token in the tab
  (`sessionStorage`; `localStorage` with "Remember me"), the same as the API's Bearer clients.
* The database is saved in the browser's IndexedDB (before each change is confirmed), so data survives reloads.
* Accounts: `demo@isker.local` / `IskerDemo2026` (learner with history) and `admin@isker.local` / `IskerAdmin2026`
  (super administrator) — public demo passwords, fine because every visitor has a private copy.

What is different from a real server:

* **Data is per browser.** Nothing is shared between visitors or devices; clearing site data resets the platform
  to the demo state. It is a demo/prototype, not a place for real users' data.
* **Start-up time:** first visit about 15 s (download + demo data), every full page load about 10 s (Python starts
  again); moving between pages inside the app is instant.
* **One tab at a time** per browser: a second tab waits until the first is closed (both would overwrite each
  other's data otherwise).
* No email is sent, Google sign-in is not offered, and AI feedback uses the built-in mock provider.
* Security headers come from a `<meta>` Content-Security-Policy (Pages can't send headers).
* Every site under `https://ksvtmr.github.io/` (all your repositories' Pages) shares one browser origin, so their
  scripts could read Isker's local data. Publish only trusted code there, or use a custom domain.

**With a server instead:** set the repository variable `PAGES_API_URL` to a Render URL (Settings → Secrets and
variables → Actions → *Variables*). The same workflow then publishes the interface only, calling that API
(`render.yaml` allows the origin with `CORS_ORIGINS=https://ksvtmr.github.io`); data is shared and real.

Rollback: Actions → *GitHub Pages* → *Run workflow* on an older branch or tag, or revert on `main`. To stop
publishing: Settings → Pages → *Unpublish site*.

## 6. Environment variables

Full list with comments: [.env.example](.env.example). Where to set them:

| Variable | Local | Production / preview (Render → Environment) |
|---|---|---|
| `DATABASE_URL` | default `postgresql+psycopg://isker:isker@localhost:5432/isker` | set by Render from `isker-db` |
| `ENVIRONMENT` | `development` | `production` (render.yaml) |
| `JWT_SECRET` | not needed (temporary secret) | generated by Render (render.yaml) — required, ≥ 32 chars |
| `COOKIE_SECURE` | empty | `true` |
| `TRUSTED_PROXY_HOPS` | 1 (harmless locally) | `1` (Render's load balancer) |
| `ADMIN_PASSWORD` | dev default `IskerAdmin2026` | **you choose it** when creating the Blueprint |
| `DEMO_PASSWORD` | dev default `IskerDemo2026` | set in render.yaml (public demo account, read-only by default) |
| `MOCK_AI`, `OPENAI_API_KEY` | `true` / empty | `true`, or `false` + key (secret, Render only) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | optional — see docs/google-oauth-setup.md |
| `SMTP_*` | empty (emails go to the log) | needed for real emails |
| `API_DOCS_ENABLED` | on by default | off by default in production |
| `VITE_SUPPORT_EMAIL`, `VITE_SHOW_DEMO` | `.env` | Render environment (passed to the image build) |

Private values (passwords, API keys, OAuth secret, SMTP password) are entered only in Render's Environment page.
They are never in Git and never in the frontend: only `VITE_*` values reach the browser, and those are public by
design.

## 7. Database safety

* **Migrations run automatically** on every deploy, before the new release takes traffic, in Alembic order
  (0001 → 0006). They are additive or data-preserving; CI verifies the chain up and down on PostgreSQL.
* **Destructive steps are blocked by CI** unless the migration documents them (`backend/scripts/check_migrations.py`).
  Such a migration must be released deliberately, after a backup.
* **Nothing resets or deletes the database** on deploy; the seed only adds missing reference data and translations.
* **Previews use their own database.** CI uses a throw-away one.
* **Backups:** before a risky schema change, take one:
  `pg_dump -Fc "<External Database URL from Render>" > isker-$(date +%F).dump` (restore with `pg_restore`).
  Render's free PostgreSQL has no automatic backups and is time-limited; use a paid database plan for real users.

## 8. Logs, failures and rollback

| Where | What |
|---|---|
| GitHub → pull request → Checks / Actions tab | CI results; failed e2e runs include screenshots (artifact `e2e-failure`) |
| Render → service `isker` → Events | each deploy: building, live, failed (with the reason) |
| Render → service `isker` → Logs | application logs (migrations, seed, requests, errors) |
| GitHub → Actions → Smoke check | post-deploy smoke results |

**A deploy fails:** the previous release keeps serving. Read the Render event and logs, fix, push again.

**A release is live but broken — roll back:**
1. Render → service `isker` → Events → find the last good deploy → *Rollback* (Render redeploys that exact image).
2. Then fix forward in Git: on GitHub open the merge commit's PR → *Revert* → merge the revert PR. Otherwise the next
   push to `main` would deploy the broken code again.
3. Database: rolling back the app does not undo migrations. Isker's migrations are additive, so the older release
   keeps working with the newer schema. If a release ever includes a destructive migration, restore the backup taken
   before it.

## 9. Local development

```bash
npm run dev:all                  # API :8000 + app :5173, hot reload; migrations and seed first
npm run dev:all -- --docker-db   # same, and starts PostgreSQL in Docker if none is running
docker compose -f docker-compose.dev.yml up   # everything in Docker instead (no local Python/Node needed)
```

`scripts/dev.sh` checks Node, Python and the ports, installs missing dependencies, checks the database (clear
message if it's not reachable), applies migrations, seeds data, then runs `uvicorn --reload` (backend changes restart
the API in ~2 s) and Vite (frontend and translation changes appear in the browser in under a second, without a page
reload). Ctrl+C stops both.

In Claude Code cloud sessions, `.claude/hooks/session-start.sh` installs all dependencies when a session starts.
