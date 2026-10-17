#!/bin/bash
# Claude Code cloud sessions: install the project's dependencies so tests, linters and the dev server work
# immediately. Idempotent; the container is cached after this runs, so later sessions start fast.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

# Backend: Python virtual environment with app + dev tools (pytest, ruff, mypy).
PY="$(command -v python3.12 || command -v python3)"
[ -x backend/.venv/bin/python ] || "$PY" -m venv backend/.venv
if command -v uv >/dev/null 2>&1; then
  uv pip install -q --python backend/.venv/bin/python -r backend/requirements-dev.txt
else
  backend/.venv/bin/python -m pip --version >/dev/null 2>&1 || backend/.venv/bin/python -m ensurepip -q
  backend/.venv/bin/python -m pip install -q -r backend/requirements-dev.txt
fi

# Frontend + design system (npm workspaces). `npm install` keeps cached modules between sessions.
npm install --no-audit --no-fund --loglevel=error

# Browser end-to-end scripts (Playwright uses the browser pre-installed in the cloud image).
(cd scripts/e2e && npm install --no-audit --no-fund --loglevel=error)

echo "Isker dependencies ready (backend/.venv, node_modules, scripts/e2e/node_modules)."
