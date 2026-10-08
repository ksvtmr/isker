#!/bin/sh
set -e
echo "Applying database migrations…"
alembic upgrade head
echo "Seeding reference data (idempotent)…"
python -m app.seed.run
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="*"
