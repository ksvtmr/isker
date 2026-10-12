"""Subscription entitlements: one place that decides what a user's plan allows.

Callers ask `require(db, user, feature)` (raises UPGRADE_REQUIRED) or `entitlements_for(db, user)`.
No code outside this module compares plan keys.

Feature catalogue
- kind "flag": on/off.
- kind "limit": a count within a rolling window (`window_days`); `limit_value = NULL` means unlimited.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.errors import AppError
from app.models import (
    AssessmentAttempt,
    PracticeSubmission,
    SubscriptionPlan,
    User,
)
from app.models.enums import AttemptScope, AttemptStatus
from app.services import subscriptions as sub_service


@dataclass(frozen=True)
class Feature:
    key: str
    kind: Literal["flag", "limit"]
    label: str
    description: str
    window_days: int | None = None


FEATURES: dict[str, Feature] = {f.key: f for f in [
    Feature("assessment.full", "limit", "Full assessments",
            "Full 30-question assessments you can start in a rolling 30-day window.", 30),
    Feature("assessment.reassessment", "flag", "Competency reassessment",
            "Reassess a single competency after working on your plan."),
    Feature("plan.personalized", "flag", "Personalised development plan",
            "Recommendations and a Learn → Practice → Reflect → Reassess plan."),
    Feature("learning.advanced_resources", "flag", "Advanced learning resources",
            "Access to advanced-level courses, case studies and exercises."),
    Feature("practice.tasks", "limit", "Practical tasks",
            "Different practical tasks you can start in a rolling 30-day window.", 30),
    Feature("practice.ai_feedback", "flag", "AI feedback on practice",
            "Rubric-based AI feedback on your practical task submissions."),
    Feature("progress.history", "flag", "Full progress history",
            "Every past measurement in your progress charts, not only the latest two."),
    Feature("export.data", "flag", "Data export", "Download all your data as JSON."),
]}


class UpgradeRequired(AppError):
    status_code = 403
    code = "UPGRADE_REQUIRED"


@dataclass
class Entitlement:
    feature: Feature
    enabled: bool
    limit: int | None
    used: int | None = None

    @property
    def remaining(self) -> int | None:
        if self.limit is None or self.used is None:
            return None
        return max(0, self.limit - self.used)

    def as_dict(self) -> dict:
        return {"key": self.feature.key, "label": self.feature.label, "description": self.feature.description,
                "kind": self.feature.kind, "enabled": self.enabled, "limit": self.limit, "used": self.used,
                "remaining": self.remaining, "window_days": self.feature.window_days}


def _usage(db: Session, user: User, key: str) -> int:
    since = utcnow() - timedelta(days=FEATURES[key].window_days or 30)
    if key == "assessment.full":
        return db.scalar(select(func.count(AssessmentAttempt.id)).where(
            AssessmentAttempt.user_id == user.id, AssessmentAttempt.scope == AttemptScope.FULL,
            AssessmentAttempt.started_at >= since, AssessmentAttempt.status != AttemptStatus.ABANDONED)) or 0
    if key == "practice.tasks":
        return db.scalar(select(func.count(PracticeSubmission.id)).where(
            PracticeSubmission.user_id == user.id, PracticeSubmission.started_at >= since)) or 0
    return 0


def plan_for(db: Session, user: User) -> SubscriptionPlan:
    sub = sub_service.current_subscription(db, user.id)
    return sub.plan if sub is not None else sub_service.default_plan(db)


def entitlements_for(db: Session, user: User, with_usage: bool = True) -> dict[str, Entitlement]:
    plan = plan_for(db, user)
    rows = {e.feature_key: e for e in plan.entitlements}
    out: dict[str, Entitlement] = {}
    for key, feature in FEATURES.items():
        row = rows.get(key)
        enabled = bool(row and row.enabled)
        limit = row.limit_value if (row and feature.kind == "limit") else None
        used = _usage(db, user, key) if (with_usage and feature.kind == "limit" and enabled) else None
        out[key] = Entitlement(feature, enabled, limit, used)
    return out


def check(db: Session, user: User, key: str) -> Entitlement:
    return entitlements_for(db, user)[key]


def require(db: Session, user: User, key: str, *, consume: int = 1) -> None:
    """Raise UPGRADE_REQUIRED unless the user's plan allows `consume` more uses of `key`."""
    ent = check(db, user, key)
    plan = plan_for(db, user)
    details = {"feature": key, "plan": plan.key, "limit": ent.limit, "used": ent.used}
    if not ent.enabled:
        raise UpgradeRequired(f"{ent.feature.label} is not included in your {plan.name} plan.", details=details)
    if ent.feature.kind == "limit" and ent.limit is not None and (ent.used or 0) + consume > ent.limit:
        raise UpgradeRequired(
            f"You've used {ent.used} of {ent.limit} {ent.feature.label.lower()} in the last "
            f"{ent.feature.window_days} days on the {plan.name} plan.", details=details)


def allows(db: Session, user: User, key: str) -> bool:
    try:
        require(db, user, key, consume=0)
        return True
    except UpgradeRequired:
        return False
