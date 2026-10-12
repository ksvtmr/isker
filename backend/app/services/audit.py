"""Audit log + in-app notifications.

`audit()` adds the event to the caller's transaction, so a business change and its audit row commit together.
`audit_now()` commits in an independent session — for events that must persist even when the request fails
(failed logins, denied access). Never pass passwords, tokens or secrets in `details`.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.context import client_ip_var, request_id_var
from app.models import AuditLog, Notification

_SENSITIVE = ("password", "token", "secret", "hash", "authorization", "cookie")


def _clean(details: dict) -> dict | None:
    out = {k: v for k, v in details.items() if not any(s in k.lower() for s in _SENSITIVE)}
    return out or None


def _row(actor_id, action, target_type, target_id, outcome, reason, details) -> AuditLog:
    return AuditLog(actor_id=actor_id, action=action, target_type=target_type, target_id=target_id,
                    outcome=outcome, reason=(reason or None) and reason[:500], request_id=request_id_var.get(),
                    ip_address=client_ip_var.get(), details=_clean(details))


def audit(db: Session, actor_id: int | None, action: str, target_type: str | None = None,
          target_id: int | None = None, *, outcome: str = "success", reason: str | None = None, **details) -> None:
    db.add(_row(actor_id, action, target_type, target_id, outcome, reason, details))


def audit_now(actor_id: int | None, action: str, target_type: str | None = None, target_id: int | None = None, *,
              outcome: str = "failure", reason: str | None = None, **details) -> None:
    from app.core.database import SessionLocal

    s = SessionLocal()
    try:
        s.add(_row(actor_id, action, target_type, target_id, outcome, reason, details))
        s.commit()
    finally:
        s.close()


def notify(db: Session, user_id: int, type_: str, title: str, body: str | None = None, link: str | None = None) -> None:
    db.add(Notification(user_id=user_id, type=type_, title=title, body=body, link=link))
