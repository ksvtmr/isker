#!/usr/bin/env bash
# One command for local development with live reload:
#
#   npm run dev:all                 # or: bash scripts/dev.sh
#   npm run dev:all -- --docker-db  # also start PostgreSQL in Docker if none is running
#
# Starts the API (http://localhost:8000, restarts on backend changes) and the web app
# (http://localhost:5173, hot reload in the browser, /api proxied to the API). Before that it checks the tools,
# installs missing dependencies, checks the database, applies migrations and seeds reference + demo data.
# Ctrl+C stops both processes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"
DOCKER_DB=0
for arg in "$@"; do
  case "$arg" in
    --docker-db) DOCKER_DB=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)"; exit 2 ;;
  esac
done

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step() { printf '\033[36m▶ %s\033[0m\n' "$*"; }
fail() { red "✖ $*"; exit 1; }

# --- Tools -------------------------------------------------------------------------------------------------------
command -v node >/dev/null || fail "Node.js is not installed. Install Node 22 (https://nodejs.org) and run again."
command -v npm >/dev/null || fail "npm is not installed (it comes with Node.js)."
PY="$(command -v python3.12 || command -v python3 || true)"
[ -n "$PY" ] || fail "Python 3 is not installed. Install Python 3.12 (https://python.org) and run again."
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' \
  || fail "Python 3.11+ is required (found $("$PY" -V 2>&1))."

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
port_busy "$API_PORT" && fail "Port $API_PORT is already in use (another API running?). Stop it or set API_PORT."
port_busy "$WEB_PORT" && fail "Port $WEB_PORT is already in use (another dev server?). Stop it or set WEB_PORT."

# --- Dependencies (only when missing or out of date) ---------------------------------------------------------------
if [ ! -x "$BACKEND/.venv/bin/python" ]; then
  step "Creating the Python environment (backend/.venv)…"
  "$PY" -m venv "$BACKEND/.venv"
fi
REQ_STAMP="$BACKEND/.venv/.requirements-stamp"
if [ ! -f "$REQ_STAMP" ] || ! cmp -s <(cat "$BACKEND/requirements.txt" "$BACKEND/requirements-dev.txt") "$REQ_STAMP"; then
  step "Installing backend dependencies…"
  if command -v uv >/dev/null; then
    uv pip install -q --python "$BACKEND/.venv/bin/python" -r "$BACKEND/requirements-dev.txt"
  else
    "$BACKEND/.venv/bin/python" -m pip --version >/dev/null 2>&1 || "$BACKEND/.venv/bin/python" -m ensurepip -q
    "$BACKEND/.venv/bin/python" -m pip install -q -r "$BACKEND/requirements-dev.txt"
  fi
  cat "$BACKEND/requirements.txt" "$BACKEND/requirements-dev.txt" > "$REQ_STAMP"
fi
if [ ! -d "$ROOT/node_modules" ] || ! cmp -s "$ROOT/package-lock.json" "$ROOT/node_modules/.package-lock-copy"; then
  step "Installing frontend dependencies (npm ci)…"
  (cd "$ROOT" && npm ci --no-audit --no-fund && cp package-lock.json node_modules/.package-lock-copy)
fi

# --- Database ----------------------------------------------------------------------------------------------------
# Same default as the backend settings; .env / environment variables override it.
# (Only DATABASE_URL is read here; the backend loads the rest of .env itself.)
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/.env" ]; then
  DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ROOT/.env" | tail -1 | tr -d "\"' \r")"
fi
export DATABASE_URL="${DATABASE_URL:-postgresql+psycopg://isker:isker@localhost:5432/isker}"
db_ok() { (cd "$BACKEND" && .venv/bin/python - <<'EOF' >/dev/null 2>&1
import os, sqlalchemy as sa
sa.create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True).connect().close()
EOF
); }
if ! db_ok; then
  if [ "$DOCKER_DB" = 1 ]; then
    command -v docker >/dev/null || fail "--docker-db needs Docker, which is not installed."
    step "Starting PostgreSQL in Docker (docker-compose.dev.yml, service postgres)…"
    docker compose -f "$ROOT/docker-compose.dev.yml" up -d postgres >/dev/null
    for _ in $(seq 1 40); do db_ok && break; sleep 1; done
  fi
  db_ok || fail "Cannot connect to the database at $(printf %s "$DATABASE_URL" | sed -E "s#(://[^:/@]+):[^@]*@#\1:***@#").
   Start PostgreSQL 16 with user/password/database 'isker', or run:  npm run dev:all -- --docker-db
   (or set DATABASE_URL in .env to your own database)."
fi
green "✔ Database reachable"

step "Applying database migrations…"
(cd "$BACKEND" && .venv/bin/alembic upgrade head) || fail "Migrations failed (see the error above). Nothing was started."
step "Seeding reference and demo data (idempotent)…"
(cd "$BACKEND" && .venv/bin/python -m app.seed.run) || fail "Seeding failed (see the error above)."

# --- Start both servers ------------------------------------------------------------------------------------------
pids=()
cleanup() {
  trap - INT TERM EXIT
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

step "Starting the API on http://localhost:$API_PORT (restarts when backend files change)…"
(cd "$BACKEND" && exec .venv/bin/uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port "$API_PORT" \
  2>&1 | sed -u 's/^/[api] /') &
pids+=($!)

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 \
  || fail "The API did not start (see the [api] lines above)."

step "Starting the web app on http://localhost:$WEB_PORT (hot reload)…"
(cd "$ROOT" && VITE_API_PROXY="http://127.0.0.1:$API_PORT" exec npm -w frontend run dev -- --port "$WEB_PORT" --strictPort \
  2>&1 | sed -u 's/^/[web] /') &
pids+=($!)

cat <<EOF

$(green "Isker is running:")
  App:       http://localhost:$WEB_PORT
  API docs:  http://localhost:$API_PORT/api/docs
  Demo:      demo@isker.local / IskerDemo2026     Admin: admin@isker.local / IskerAdmin2026
  Edit files in frontend/, design-system/ or backend/app/ — the browser / API update by themselves.
  Press Ctrl+C to stop.

EOF
# Exit (and stop the other process) as soon as one of them stops.
wait -n "${pids[@]}"
red "A server stopped — shutting down the other one."
