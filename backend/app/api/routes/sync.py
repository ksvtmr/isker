"""Cheap change detection for open browser tabs (live refresh by polling).

The SPA polls `GET /api/sync/state` (every 30 s and when the tab regains focus) and compares the opaque versions
with the previous answer; when one changes it refetches the affected data. Security never depends on this: every
protected request is authorized against the database (account status, roles, plan) at the time it is made.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import DB, CurrentUser
from app.core.database import utcnow
from app.models import Assessment, Competency, LearningResource, PracticalTask, Question, SubscriptionPlan
from app.schemas.common import ERROR_RESPONSES
from app.services import entitlements as ent_service
from app.services import subscriptions as subs
from app.services.permissions import user_permissions

router = APIRouter(prefix="/api/sync", tags=["auth"], responses=ERROR_RESPONSES)

CONTENT_MODELS = (Competency, Assessment, Question, LearningResource, PracticalTask, SubscriptionPlan)


class SyncState(BaseModel):
    user_version: int = Field(description="The account's lock_version: changes when profile, status or roles change")
    access_version: str = Field(description="Changes when the account's roles or effective permissions change")
    entitlements_version: str = Field(description="Changes when the plan, subscription or plan limits change")
    content_version: str | None = Field(description="Latest change to published learning/assessment content")
    server_time: datetime


def _digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _content_version(db: Session) -> str | None:
    latest = [db.scalar(select(func.max(m.updated_at))) for m in CONTENT_MODELS]
    stamps = [d.isoformat() for d in latest if d is not None]
    return max(stamps) if stamps else None


@router.get("/state", response_model=SyncState, summary="Versions of the data an open tab may need to refresh")
def sync_state(user: CurrentUser, db: DB) -> SyncState:
    sub = subs.current_subscription(db, user.id)
    ents = ent_service.entitlements_for(db, user, with_usage=False)
    out = SyncState(
        user_version=user.lock_version,
        access_version=_digest([user.status.value, user.role_keys, sorted(user_permissions(user))]),
        entitlements_version=_digest([
            sub.plan.key if sub else None, sub.status.value if sub else None, sub.expires_at if sub else None,
            [(k, e.enabled, e.limit) for k, e in sorted(ents.items())],
        ]),
        content_version=_content_version(db),
        server_time=utcnow(),
    )
    db.commit()
    return out
