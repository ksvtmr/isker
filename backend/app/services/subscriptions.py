"""Subscription lifecycle.

Statuses and allowed transitions
    incomplete → active | canceled | expired
    trialing   → active | past_due | canceled | expired
    active     → past_due | canceled | expired
    past_due   → active | canceled | expired
    canceled, expired: terminal (a new subscription row is created for a new period)

A user has at most one *current* subscription (trialing, active, past_due or incomplete). Users without one are on
the default plan (Free). Expiry is applied lazily on read: when `expires_at` passes, the subscription moves to
`expired` (or `canceled` if it was set to cancel at period end) and an event is recorded.
Every change writes a `subscription_events` row (who, what, why, source).
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.content_i18n import base_text
from app.core.database import as_utc, utcnow
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models import PlanEntitlement, SubscriptionEvent, SubscriptionPlan, UserSubscription
from app.models.enums import BillingInterval, SubscriptionSource, SubscriptionStatus

S = SubscriptionStatus
CURRENT = (S.TRIALING, S.ACTIVE, S.PAST_DUE, S.INCOMPLETE)
ENTITLED = (S.TRIALING, S.ACTIVE, S.PAST_DUE)  # past_due keeps access during the grace period
TRANSITIONS: dict[SubscriptionStatus, set[SubscriptionStatus]] = {
    S.INCOMPLETE: {S.ACTIVE, S.CANCELED, S.EXPIRED},
    S.TRIALING: {S.ACTIVE, S.PAST_DUE, S.CANCELED, S.EXPIRED},
    S.ACTIVE: {S.PAST_DUE, S.CANCELED, S.EXPIRED},
    S.PAST_DUE: {S.ACTIVE, S.CANCELED, S.EXPIRED},
    S.CANCELED: set(),
    S.EXPIRED: set(),
}

# Default catalogue (editable by admins afterwards). Free must keep the core learning journey usable.
DEFAULT_PLANS: list[tuple[str, str, str, int, BillingInterval, bool, dict[str, tuple[bool, int | None]]]] = [
    (
        "free",
        "Free",
        "Everything you need to assess yourself and follow a development plan.",
        0,
        BillingInterval.NONE,
        True,
        {
            "assessment.full": (True, 2),
            "assessment.reassessment": (True, None),
            "plan.personalized": (True, None),
            "learning.advanced_resources": (False, None),
            "practice.tasks": (True, 3),
            "practice.ai_feedback": (True, None),
            "progress.history": (False, None),
            "export.data": (True, None),
        },
    ),
    (
        "pro",
        "Pro",
        "Unlimited assessments and practice, advanced resources and full progress history.",
        900,
        BillingInterval.MONTH,
        False,
        {
            "assessment.full": (True, None),
            "assessment.reassessment": (True, None),
            "plan.personalized": (True, None),
            "learning.advanced_resources": (True, None),
            "practice.tasks": (True, None),
            "practice.ai_feedback": (True, None),
            "progress.history": (True, None),
            "export.data": (True, None),
        },
    ),
    (
        "premium",
        "Premium",
        "Pro, billed yearly, for programmes and incubators.",
        9000,
        BillingInterval.YEAR,
        False,
        {
            "assessment.full": (True, None),
            "assessment.reassessment": (True, None),
            "plan.personalized": (True, None),
            "learning.advanced_resources": (True, None),
            "practice.tasks": (True, None),
            "practice.ai_feedback": (True, None),
            "progress.history": (True, None),
            "export.data": (True, None),
        },
    ),
]


def _plan_translations(key: str) -> dict | None:
    from app.seed.translations import PLANS

    entry = PLANS.get(key)
    return {lang: dict(values) for lang, values in entry.items() if values} if entry else None


def ensure_default_plans(db: Session) -> None:
    if db.scalar(select(SubscriptionPlan.id).limit(1)) is not None:
        return  # catalogue is managed by admins after the first seed
    for i, (key, name, desc, price, interval, default, ents) in enumerate(DEFAULT_PLANS):
        plan = SubscriptionPlan(
            key=key,
            name=name,
            description=desc,
            price_cents=price,
            currency="USD",
            billing_interval=interval,
            is_default=default,
            sort_order=i,
            is_active=True,
            # Russian and Kazakh names/descriptions, so plans created without the seed are translated too.
            translations=_plan_translations(key),
        )
        for fkey, (enabled, limit) in ents.items():
            plan.entitlements.append(PlanEntitlement(feature_key=fkey, enabled=enabled, limit_value=limit))
        db.add(plan)
    db.flush()


def default_plan(db: Session) -> SubscriptionPlan:
    plan = db.scalar(
        select(SubscriptionPlan).where(SubscriptionPlan.is_default.is_(True)).order_by(SubscriptionPlan.id)
    )
    if plan is None:
        ensure_default_plans(db)
        plan = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.is_default.is_(True)))
    if plan is None:  # pragma: no cover - misconfiguration
        raise ConflictError("No default plan is configured.", "NO_DEFAULT_PLAN")
    return plan


def record(
    db: Session,
    sub: UserSubscription,
    event_type: str,
    *,
    actor_id: int | None,
    source: str,
    from_status: str | None = None,
    reason: str | None = None,
    **details,
) -> None:
    db.add(
        SubscriptionEvent(
            subscription_id=sub.id,
            user_id=sub.user_id,
            event_type=event_type,
            from_status=from_status,
            to_status=sub.status.value,
            plan_id=sub.plan_id,
            actor_id=actor_id,
            source=source,
            reason=reason,
            details=details or None,
        )
    )


def transition(
    db: Session,
    sub: UserSubscription,
    to: SubscriptionStatus,
    *,
    actor_id: int | None,
    source: str,
    reason: str | None = None,
    event_type: str | None = None,
) -> None:
    if to == sub.status:
        return
    if to not in TRANSITIONS[sub.status]:
        raise ConflictError(f"A {sub.status.value} subscription can't become {to.value}.", "INVALID_TRANSITION")
    prev = sub.status.value
    sub.status = to
    now = utcnow()
    if to in (S.CANCELED, S.EXPIRED):
        sub.ended_at = now
        if to == S.CANCELED:
            sub.canceled_at = sub.canceled_at or now
    db.flush()
    record(
        db, sub, event_type or f"status.{to.value}", actor_id=actor_id, source=source, from_status=prev, reason=reason
    )


def apply_expiry(db: Session, sub: UserSubscription) -> None:
    """Lazy expiry: called whenever a subscription is read."""
    if sub.status in CURRENT and sub.expires_at is not None and as_utc(sub.expires_at) <= utcnow():
        to = S.CANCELED if sub.cancel_at_period_end else S.EXPIRED
        transition(
            db,
            sub,
            to,
            actor_id=None,
            source=SubscriptionSource.SYSTEM.value,
            reason="Period ended",
            event_type="expired" if to == S.EXPIRED else "canceled_at_period_end",
        )


def reactivate_by_payment(db: Session, sub: UserSubscription, *, reason: str) -> bool:
    """A paid renewal for a subscription that lazy expiry already ended (the renewal webhook arrived after
    `expires_at`). Only `expired` subscriptions that ended by reaching their period end are reopened, and only
    when the user has no other current subscription (a newer one is never displaced). Returns True if reopened.
    This is the only path out of a terminal status; it is recorded as a `reactivated` event."""
    if sub.status != S.EXPIRED:
        return False
    lock_user_subscriptions(db, sub.user_id)
    other = db.scalar(
        select(UserSubscription.id).where(
            UserSubscription.user_id == sub.user_id,
            UserSubscription.status.in_(CURRENT),
            UserSubscription.id != sub.id,
        )
    )
    if other is not None:
        return False
    prev = sub.status.value
    sub.status = S.ACTIVE
    sub.ended_at = None
    db.flush()
    record(
        db, sub, "reactivated", actor_id=None, source=SubscriptionSource.PAYMENT.value, from_status=prev, reason=reason
    )
    return True


def lock_user_subscriptions(db: Session, user_id: int) -> None:
    """Serialize subscription changes for one user (PostgreSQL row locks; SQLite serializes writers anyway)."""
    if db.get_bind().dialect.name == "postgresql":
        from app.models import User

        db.execute(select(User.id).where(User.id == user_id).with_for_update())


def current_subscription(db: Session, user_id: int) -> UserSubscription | None:
    subs = list(
        db.scalars(
            select(UserSubscription)
            .where(UserSubscription.user_id == user_id, UserSubscription.status.in_(CURRENT))
            .order_by(UserSubscription.id.desc())
        )
    )
    for s in subs:
        apply_expiry(db, s)
    live = [s for s in subs if s.status in ENTITLED]
    return live[0] if live else None


def get(db: Session, sub_id: int) -> UserSubscription:
    sub = db.get(UserSubscription, sub_id)
    if sub is None:
        raise NotFoundError("Subscription not found", "SUBSCRIPTION_NOT_FOUND")
    apply_expiry(db, sub)
    return sub


def assign(
    db: Session,
    *,
    user_id: int,
    plan: SubscriptionPlan,
    actor_id: int | None,
    source: SubscriptionSource,
    reason: str,
    expires_at: datetime | None = None,
    status: SubscriptionStatus = S.ACTIVE,
    provider: str | None = None,
    provider_reference: str | None = None,
) -> UserSubscription:
    """Start a subscription on `plan`, replacing the user's current one (which is canceled with a reason)."""
    if not plan.is_active:
        raise ValidationError("This plan is inactive and can't be assigned.", "PLAN_INACTIVE")
    if plan.is_default:
        raise ValidationError(
            "Users are on the default plan automatically. Cancel their subscription instead.", "PLAN_IS_DEFAULT"
        )
    if expires_at is not None and as_utc(expires_at) <= utcnow():
        raise ValidationError("The end date must be in the future.", "INVALID_EXPIRY")
    if status not in (S.ACTIVE, S.TRIALING, S.INCOMPLETE):
        raise ValidationError("New subscriptions start as active, trialing or incomplete.", "INVALID_STATUS")
    # One current subscription per user (also enforced by a partial unique index): lock the user so concurrent
    # assignments queue up instead of both canceling the old row and inserting two new ones.
    lock_user_subscriptions(db, user_id)
    for old in db.scalars(
        select(UserSubscription).where(UserSubscription.user_id == user_id, UserSubscription.status.in_(CURRENT))
    ):
        transition(
            db,
            old,
            S.CANCELED,
            actor_id=actor_id,
            source=source.value,
            # Stored history text: the English base name, whatever language the request that assigned it used.
            reason=f"Replaced by {base_text(plan, 'name')}: {reason}",
            event_type="replaced",
        )
    db.flush()  # the replaced rows leave the "current" index before the new row enters it
    sub = UserSubscription(
        user_id=user_id,
        plan_id=plan.id,
        plan=plan,
        status=status,
        source=source,
        expires_at=expires_at,
        created_by_id=actor_id,
        provider=provider,
        provider_reference=provider_reference,
        note=reason,
    )
    db.add(sub)
    db.flush()
    record(
        db,
        sub,
        "created",
        actor_id=actor_id,
        source=source.value,
        reason=reason,
        expires_at=expires_at.isoformat() if expires_at else None,
    )
    return sub


def extend(
    db: Session, sub: UserSubscription, *, days: int | None, until: datetime | None, actor_id: int | None, reason: str
) -> UserSubscription:
    apply_expiry(db, sub)
    if sub.status not in CURRENT:
        raise ConflictError("Only a current subscription can be extended. Assign a new one instead.", "NOT_CURRENT")
    if (days is None) == (until is None):
        raise ValidationError("Provide either a number of days or an end date.", "INVALID_EXTENSION")
    base = max(as_utc(sub.expires_at), utcnow()) if sub.expires_at else utcnow()
    new_end = base + timedelta(days=days) if days is not None else as_utc(until)  # type: ignore[arg-type]
    if new_end <= utcnow() or (sub.expires_at and new_end <= as_utc(sub.expires_at)):
        raise ValidationError("The new end date must be later than the current one.", "INVALID_EXTENSION")
    old = sub.expires_at
    sub.expires_at = new_end
    sub.cancel_at_period_end = False
    db.flush()
    record(
        db,
        sub,
        "extended",
        actor_id=actor_id,
        source=SubscriptionSource.ADMIN.value,
        from_status=sub.status.value,
        reason=reason,
        previous_expires_at=old.isoformat() if old else None,
        expires_at=new_end.isoformat(),
    )
    return sub


def cancel(
    db: Session,
    sub: UserSubscription,
    *,
    at_period_end: bool,
    actor_id: int | None,
    reason: str,
    source: SubscriptionSource = SubscriptionSource.ADMIN,
) -> UserSubscription:
    apply_expiry(db, sub)
    if sub.status not in CURRENT:
        raise ConflictError("This subscription has already ended.", "NOT_CURRENT")
    if at_period_end:
        if sub.expires_at is None:
            raise ValidationError("This subscription has no end date; cancel it immediately instead.", "NO_PERIOD_END")
        sub.cancel_at_period_end = True
        db.flush()
        record(
            db,
            sub,
            "cancel_scheduled",
            actor_id=actor_id,
            source=source.value,
            from_status=sub.status.value,
            reason=reason,
            effective_at=as_utc(sub.expires_at).isoformat(),
        )
    else:
        transition(db, sub, S.CANCELED, actor_id=actor_id, source=source.value, reason=reason, event_type="canceled")
    return sub


def set_status(
    db: Session,
    sub: UserSubscription,
    to: SubscriptionStatus,
    *,
    actor_id: int | None,
    reason: str,
    source: SubscriptionSource = SubscriptionSource.ADMIN,
) -> UserSubscription:
    apply_expiry(db, sub)
    transition(db, sub, to, actor_id=actor_id, source=source.value, reason=reason)
    return sub


def expire_due(db: Session) -> int:
    """Apply expiry to every current subscription whose period has ended (used before admin queries/analytics)."""
    due = list(
        db.scalars(
            select(UserSubscription).where(
                UserSubscription.status.in_(CURRENT),
                UserSubscription.expires_at.is_not(None),
                UserSubscription.expires_at <= utcnow(),
            )
        )
    )
    for s in due:
        apply_expiry(db, s)
    return len(due)
