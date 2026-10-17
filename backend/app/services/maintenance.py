"""Housekeeping: delete authentication rows that can never be used again.

What is purged
- oauth_states: expired, or used more than a day ago (a state is single use and lives 10 minutes).
- user_sessions: expired or revoked more than SESSION_RETENTION_DAYS (30) days ago. Recent ones are kept so users
  and support can still see recent sign-outs; active sessions are never touched.
- email_verification_tokens and password_reset_tokens: used or expired more than TOKEN_RETENTION_DAYS (7) days ago.

How it runs
- Opportunistically: `maybe_purge()` is called from cheap, rate-limited entry points (password sign-in and
  “Continue with Google” start). It runs at most once every PURGE_INTERVAL_MINUTES per process, in its own
  database session, and never fails the request that triggered it.
- On demand (cron, Render job, by hand):  `python -m app.services.maintenance`
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import timedelta

from sqlalchemy import and_, delete, or_
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, utcnow
from app.models import EmailVerificationToken, OAuthState, PasswordResetToken, UserSession

log = logging.getLogger("isker.maintenance")

PURGE_INTERVAL_MINUTES = 30
SESSION_RETENTION_DAYS = 30
TOKEN_RETENTION_DAYS = 7
OAUTH_STATE_RETENTION = timedelta(days=1)

_lock = threading.Lock()
_last_run = 0.0


def purge_expired(db: Session) -> dict[str, int]:
    """Delete dead authentication rows. Returns the number of rows removed per table (caller commits)."""
    now = utcnow()
    session_cutoff = now - timedelta(days=SESSION_RETENTION_DAYS)
    token_cutoff = now - timedelta(days=TOKEN_RETENTION_DAYS)
    out: dict[str, int] = {}

    def run(name: str, stmt) -> None:
        out[name] = int(getattr(db.execute(stmt.execution_options(synchronize_session=False)), "rowcount", 0) or 0)

    run("oauth_states", delete(OAuthState).where(
        or_(OAuthState.expires_at <= now, OAuthState.used_at <= now - OAUTH_STATE_RETENTION)))
    run("user_sessions", delete(UserSession).where(
        or_(UserSession.expires_at <= session_cutoff, UserSession.revoked_at <= session_cutoff)))
    for name, model in (("email_verification_tokens", EmailVerificationToken),
                        ("password_reset_tokens", PasswordResetToken)):
        run(name, delete(model).where(or_(model.expires_at <= token_cutoff,
                                          and_(model.used_at.is_not(None), model.used_at <= token_cutoff))))
    return out


def maybe_purge(force: bool = False) -> dict[str, int] | None:
    """Run `purge_expired` at most once per PURGE_INTERVAL_MINUTES in this process. Never raises."""
    global _last_run
    with _lock:
        if not force and time.monotonic() - _last_run < PURGE_INTERVAL_MINUTES * 60 and _last_run:
            return None
        _last_run = time.monotonic()
    db = SessionLocal()
    try:
        counts = purge_expired(db)
        db.commit()
        if any(counts.values()):
            log.info("Purged expired authentication rows: %s", counts)
        return counts
    except Exception:  # noqa: BLE001 - housekeeping must never break the request that triggered it
        db.rollback()
        log.exception("Housekeeping purge failed")
        return None
    finally:
        db.close()


def main() -> None:  # pragma: no cover - CLI entry point
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    counts = maybe_purge(force=True)
    print(counts if counts is not None else "Purge failed; see the log.")


if __name__ == "__main__":  # pragma: no cover
    main()
