"""Release step for serverless hosts (Vercel): migrate the database and load reference data, once per deploy.

    python scripts/release.py      # from backend/, with DATABASE_URL set

Runs from the Vercel build of the "api" service (vercel.json). Same steps as docker-entrypoint.sh on Render:
`alembic upgrade head` (additive migrations, CI blocks undocumented destructive ones) and the idempotent seed (adds
missing reference data, never deletes). A PostgreSQL advisory lock keeps two deploys from migrating at the same time.

Only production deployments migrate by default (VERCEL_ENV=production). Preview deployments skip it unless
RELEASE_ON_PREVIEW=true, which is safe only when previews have their own database (e.g. a Neon branch per preview).
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text

BACKEND = Path(__file__).resolve().parent.parent
LOCK_ID = 7_302_026  # arbitrary, constant: one release at a time


def main() -> int:
    env = os.environ.get("VERCEL_ENV")
    if env and env != "production" and os.environ.get("RELEASE_ON_PREVIEW", "").lower() != "true":
        print(f"release: skipped for VERCEL_ENV={env} "
              "(set RELEASE_ON_PREVIEW=true when previews have their own database)")
        return 0
    if not os.environ.get("DATABASE_URL"):
        print("release: DATABASE_URL is not set — connect a database (Vercel → Storage) and redeploy", file=sys.stderr)
        return 1
    sys.path.insert(0, str(BACKEND))
    from app.core.config import get_settings

    url = get_settings().database_url
    engine = create_engine(url)
    with engine.connect() as conn:
        if url.startswith("postgresql"):
            conn.execute(text("SELECT pg_advisory_lock(:id)"), {"id": LOCK_ID})
        try:
            for cmd in ([sys.executable, "-m", "alembic", "upgrade", "head"], [sys.executable, "-m", "app.seed.run"]):
                print("release:", " ".join(cmd[1:]), flush=True)
                subprocess.run(cmd, cwd=BACKEND, check=True)  # noqa: S603 - fixed commands
        finally:
            if url.startswith("postgresql"):
                conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})
    print("release: database is up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
