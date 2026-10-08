"""Audit log + in-app notifications. Never store secrets or raw passwords in `details`."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import AuditLog, Notification


def audit(
    db: Session,
    user_id: int | None,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    **details,
) -> None:
    db.add(
        AuditLog(user_id=user_id, action=action, entity_type=entity_type, entity_id=entity_id, details=details or None)
    )


def notify(db: Session, user_id: int, type_: str, title: str, body: str | None = None, link: str | None = None) -> None:
    db.add(Notification(user_id=user_id, type=type_, title=title, body=body, link=link))
