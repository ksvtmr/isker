"""Plans and subscriptions administration. All changes are audited and recorded as subscription events."""

from __future__ import annotations

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, or_, select

from app.api.deps import DB, require_permission
from app.core.database import as_utc, utcnow
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models import PlanEntitlement, SubscriptionEvent, SubscriptionPlan, User, UserSubscription
from app.models.enums import SubscriptionSource, SubscriptionStatus
from app.schemas.billing import (
    AssignSubscriptionIn,
    CancelSubscriptionIn,
    ExtendSubscriptionIn,
    PlanAdminOut,
    PlanEntitlementIn,
    PlanIn,
    PlanUpdate,
    SubscriptionAdminOut,
    SubscriptionEventOut,
    SubscriptionStatusIn,
)
from app.schemas.common import ERROR_RESPONSES, Page
from app.services import subscriptions as subs
from app.services.audit import audit
from app.services.content_admin import clean_translations, touch
from app.services.entitlements import FEATURES
from app.services.locking import changes, check_version, snapshot
from app.services.permissions import assert_can_act_on, assert_not_self

router = APIRouter(prefix="/api/admin", tags=["admin-billing"], responses=ERROR_RESPONSES)

PlanViewer = Annotated[User, Depends(require_permission("admin.access", "plans.view"))]
PlanManager = Annotated[User, Depends(require_permission("admin.access", "plans.manage"))]
SubViewer = Annotated[User, Depends(require_permission("admin.access", "subscriptions.view"))]
SubManager = Annotated[User, Depends(require_permission("admin.access", "subscriptions.manage"))]


def _plan_out(db, p: SubscriptionPlan) -> PlanAdminOut:
    out = PlanAdminOut.model_validate(p)
    if p.is_default:
        paying = db.scalar(select(func.count(func.distinct(UserSubscription.user_id)))
                           .where(UserSubscription.status.in_(subs.ENTITLED))) or 0
        out.subscriber_count = max(0, (db.scalar(select(func.count(User.id))) or 0) - paying)
    else:
        out.subscriber_count = db.scalar(select(func.count(UserSubscription.id)).where(
            UserSubscription.plan_id == p.id, UserSubscription.status.in_(subs.ENTITLED))) or 0
    return out


def _check_entitlements(items: list[PlanEntitlementIn]) -> None:
    keys = [e.feature_key for e in items]
    unknown = sorted(set(keys) - set(FEATURES))
    if unknown:
        raise ValidationError("Unknown feature in entitlements.", "UNKNOWN_FEATURE", {"features": unknown})
    if len(keys) != len(set(keys)):
        raise ValidationError("Each feature may appear only once.", "DUPLICATE_FEATURE")
    for e in items:
        if e.limit_value is not None and FEATURES[e.feature_key].kind != "limit":
            raise ValidationError(f"{e.feature_key} is an on/off feature and has no limit.", "LIMIT_NOT_ALLOWED")


def _set_entitlements(p: SubscriptionPlan, items: list[PlanEntitlementIn]) -> None:
    by_key = {e.feature_key: e for e in p.entitlements}
    wanted = {e.feature_key: e for e in items}
    for key in FEATURES:
        new = wanted.get(key)
        row = by_key.get(key)
        enabled = bool(new and new.enabled)
        limit = new.limit_value if new else None
        if row is None:
            p.entitlements.append(PlanEntitlement(feature_key=key, enabled=enabled, limit_value=limit))
        else:
            row.enabled, row.limit_value = enabled, limit


def _get_plan(db, plan_id: int) -> SubscriptionPlan:
    p = db.get(SubscriptionPlan, plan_id)
    if p is None:
        raise NotFoundError("Plan not found", "PLAN_NOT_FOUND")
    return p


@router.get("/plans", response_model=list[PlanAdminOut], summary="All plans, including inactive ones")
def list_plans(_: PlanViewer, db: DB) -> list[PlanAdminOut]:
    subs.expire_due(db)
    db.commit()
    return [_plan_out(db, p) for p in db.scalars(select(SubscriptionPlan)
                                                 .order_by(SubscriptionPlan.sort_order, SubscriptionPlan.id))]


@router.post("/plans", response_model=PlanAdminOut, status_code=status.HTTP_201_CREATED, summary="Create a plan")
def create_plan(body: PlanIn, actor: PlanManager, db: DB) -> PlanAdminOut:
    if db.scalar(select(SubscriptionPlan.id).where(SubscriptionPlan.key == body.key)):
        raise ConflictError("A plan with this key exists.", "PLAN_KEY_TAKEN")
    _check_entitlements(body.entitlements)
    p = SubscriptionPlan(key=body.key, name=body.name, description=body.description, price_cents=body.price_cents,
                         currency=body.currency, billing_interval=body.billing_interval, trial_days=body.trial_days,
                         is_active=body.is_active, is_default=False, sort_order=body.sort_order,
                         translations=clean_translations(SubscriptionPlan, body.translations))
    _set_entitlements(p, body.entitlements)
    db.add(p)
    db.flush()
    audit(db, actor.id, "admin.plan_created", "subscription_plan", p.id, key=p.key, price_cents=p.price_cents)
    db.commit()
    return _plan_out(db, p)


PLAN_FIELDS = ("name", "description", "price_cents", "currency", "billing_interval", "trial_days", "is_active",
               "sort_order", "translations")


@router.patch("/plans/{plan_id}", response_model=PlanAdminOut, summary="Edit a plan (price, limits, availability)")
def update_plan(plan_id: int, body: PlanUpdate, actor: PlanManager, db: DB) -> PlanAdminOut:
    p = _get_plan(db, plan_id)
    check_version(p, body.expected_version)
    data = body.model_dump(exclude_unset=True, exclude={"reason", "entitlements", "translations", "expected_version"})
    if p.is_default and data.get("is_active") is False:
        raise ConflictError("The default plan can't be deactivated: users without a subscription rely on it.",
                            "DEFAULT_PLAN_REQUIRED")
    if p.is_default and data.get("price_cents"):
        raise ValidationError("The default plan must stay free.", "DEFAULT_PLAN_FREE")
    before = snapshot(p, PLAN_FIELDS)
    for k, v in data.items():
        setattr(p, k, v)
    if "translations" in body.model_fields_set:
        p.translations = clean_translations(SubscriptionPlan, body.translations)
    diff = changes(before, snapshot(p, PLAN_FIELDS))
    if body.entitlements is not None:
        _check_entitlements(body.entitlements)
        ents_before = {e.feature_key: [e.enabled, e.limit_value] for e in p.entitlements}
        _set_entitlements(p, body.entitlements)
        ents_after = {e.feature_key: [e.enabled, e.limit_value] for e in p.entitlements}
        if ents_before != ents_after:
            diff["entitlements"] = {"from": {k: v for k, v in ents_before.items() if ents_after.get(k) != v},
                                    "to": {k: v for k, v in ents_after.items() if ents_before.get(k) != v}}
    if not diff:
        raise ValidationError("Nothing to change.", "NO_CHANGES")
    touch(p)
    db.flush()
    audit(db, actor.id, "admin.plan_updated", "subscription_plan", p.id, reason=body.reason, fields=sorted(diff),
          changes=diff)
    db.commit()
    return _plan_out(db, p)


@router.get("/subscriptions", response_model=Page[SubscriptionAdminOut], summary="Subscriptions with filters")
def list_subscriptions(
    _: SubViewer,
    db: DB,
    status_filter: Annotated[SubscriptionStatus | None, Query(alias="status")] = None,
    plan: Annotated[str | None, Query(max_length=48)] = None,
    source: SubscriptionSource | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    expiring_within_days: Annotated[int | None, Query(ge=1, le=365)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> Page:
    subs.expire_due(db)
    db.commit()
    stmt = select(UserSubscription, User.email, User.full_name).join(User, User.id == UserSubscription.user_id)
    if status_filter:
        stmt = stmt.where(UserSubscription.status == status_filter)
    if plan:
        stmt = stmt.join(SubscriptionPlan, SubscriptionPlan.id == UserSubscription.plan_id).where(
            SubscriptionPlan.key == plan)
    if source:
        stmt = stmt.where(UserSubscription.source == source)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.email.ilike(like), User.full_name.ilike(like)))
    if expiring_within_days:
        stmt = stmt.where(UserSubscription.status.in_(subs.CURRENT), UserSubscription.expires_at.is_not(None),
                          UserSubscription.expires_at <= utcnow() + timedelta(days=expiring_within_days))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(UserSubscription.id.desc()).offset((page - 1) * page_size).limit(page_size))
    items = []
    for sub, email, name in rows:
        out = SubscriptionAdminOut.model_validate(sub)
        out.user_email, out.user_name = email, name
        items.append(out)
    return Page[SubscriptionAdminOut](items=items, total=total, page=page, page_size=page_size)


@router.get("/subscription-events", response_model=Page[SubscriptionEventOut], summary="Subscription history")
def subscription_events(
    _: SubViewer,
    db: DB,
    user_id: int | None = None,
    subscription_id: int | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> Page:
    stmt = select(SubscriptionEvent)
    if user_id:
        stmt = stmt.where(SubscriptionEvent.user_id == user_id)
    if subscription_id:
        stmt = stmt.where(SubscriptionEvent.subscription_id == subscription_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(SubscriptionEvent.id.desc()).offset((page - 1) * page_size).limit(page_size))
    return Page[SubscriptionEventOut](items=[SubscriptionEventOut.model_validate(r) for r in rows], total=total,
                                      page=page, page_size=page_size)


def _target(db, user_id: int, actor: User) -> User:
    u = db.get(User, user_id)
    if u is None:
        raise NotFoundError("User not found", "USER_NOT_FOUND")
    # Staff can't grant, extend or change their own plan (403 SELF_ACTION_FORBIDDEN).
    assert_not_self(actor, u, "change the subscription of")
    assert_can_act_on(actor, u)
    return u


def _sub_for_actor(db, sub_id: int, actor: User) -> UserSubscription:
    sub = subs.get(db, sub_id)
    _target(db, sub.user_id, actor)
    return sub


def _admin_out(db, sub: UserSubscription) -> SubscriptionAdminOut:
    out = SubscriptionAdminOut.model_validate(sub)
    u = db.get(User, sub.user_id)
    out.user_email, out.user_name = (u.email, u.full_name) if u else (None, None)
    return out


@router.post("/users/{user_id}/subscriptions", response_model=SubscriptionAdminOut,
             status_code=status.HTTP_201_CREATED,
             summary="Assign or change a user's plan (optionally time-limited); replaces the current subscription")
def assign_subscription(user_id: int, body: AssignSubscriptionIn, actor: SubManager, db: DB) -> SubscriptionAdminOut:
    u = _target(db, user_id, actor)
    plan = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.key == body.plan_key))
    if plan is None:
        raise NotFoundError("Plan not found", "PLAN_NOT_FOUND")
    if body.days and body.expires_at:
        raise ValidationError("Give either a number of days or an end date, not both.", "INVALID_EXPIRY")
    expires = utcnow() + timedelta(days=body.days) if body.days else (as_utc(body.expires_at)
                                                                       if body.expires_at else None)
    if body.status == SubscriptionStatus.TRIALING and expires is None:
        raise ValidationError("A trial needs an end date.", "TRIAL_NEEDS_END")
    sub = subs.assign(db, user_id=u.id, plan=plan, actor_id=actor.id, source=SubscriptionSource.ADMIN,
                      reason=body.reason, expires_at=expires, status=body.status)
    audit(db, actor.id, "admin.subscription_assigned", "user", u.id, reason=body.reason, plan=plan.key,
          subscription_id=sub.id, status=sub.status.value, expires_at=expires.isoformat() if expires else None)
    db.commit()
    return _admin_out(db, sub)


@router.post("/subscriptions/{sub_id}/extend", response_model=SubscriptionAdminOut, summary="Extend the end date")
def extend_subscription(sub_id: int, body: ExtendSubscriptionIn, actor: SubManager, db: DB) -> SubscriptionAdminOut:
    sub = _sub_for_actor(db, sub_id, actor)
    subs.extend(db, sub, days=body.days, until=body.until, actor_id=actor.id, reason=body.reason)
    audit(db, actor.id, "admin.subscription_extended", "subscription", sub.id, reason=body.reason,
          user_id=sub.user_id, expires_at=as_utc(sub.expires_at).isoformat() if sub.expires_at else None)
    db.commit()
    return _admin_out(db, sub)


@router.post("/subscriptions/{sub_id}/cancel", response_model=SubscriptionAdminOut,
             summary="Cancel now or at the end of the period")
def cancel_subscription(sub_id: int, body: CancelSubscriptionIn, actor: SubManager, db: DB) -> SubscriptionAdminOut:
    sub = _sub_for_actor(db, sub_id, actor)
    subs.cancel(db, sub, at_period_end=body.at_period_end, actor_id=actor.id, reason=body.reason)
    audit(db, actor.id, "admin.subscription_canceled", "subscription", sub.id, reason=body.reason,
          user_id=sub.user_id, at_period_end=body.at_period_end)
    db.commit()
    return _admin_out(db, sub)


@router.post("/subscriptions/{sub_id}/status", response_model=SubscriptionAdminOut,
             summary="Change status along an allowed transition")
def change_subscription_status(sub_id: int, body: SubscriptionStatusIn, actor: SubManager,
                               db: DB) -> SubscriptionAdminOut:
    sub = _sub_for_actor(db, sub_id, actor)
    prev = sub.status
    subs.set_status(db, sub, body.status, actor_id=actor.id, reason=body.reason)
    audit(db, actor.id, "admin.subscription_status_changed", "subscription", sub.id, reason=body.reason,
          user_id=sub.user_id, from_status=prev.value, to_status=sub.status.value)
    db.commit()
    return _admin_out(db, sub)
