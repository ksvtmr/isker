"""User management for staff. Every operation checks a permission and the rank policy in services/permissions.py."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import DB, require_permission
from app.core.database import utcnow
from app.core.errors import AppError, ConflictError, NotFoundError, ValidationError
from app.models import (
    AssessmentAttempt,
    AuditLog,
    Competency,
    GoalDefinition,
    PracticeSubmission,
    Role,
    SubscriptionEvent,
    SubscriptionPlan,
    User,
    UserGoal,
    UserLearningProgress,
    UserRole,
    UserSubscription,
)
from app.models.enums import AccountStatus, AttemptStatus, PracticeStatus, ProgressStatus
from app.schemas.admin_users import (
    ActionResult,
    AdminAttemptOut,
    AdminCompetencyScoreOut,
    AdminSessionOut,
    AdminUserDetail,
    AdminUserRow,
    AdminUserUpdate,
    AuditLogOut,
    DeleteUserIn,
    ReasonIn,
    RoleAssignIn,
)
from app.schemas.billing import SubscriptionEventOut, SubscriptionOut
from app.schemas.common import ERROR_RESPONSES, Page
from app.services import accounts
from app.services import email as email_service
from app.services import subscriptions as subs
from app.services.audit import audit
from app.services.permissions import (
    assert_can_act_on,
    assert_can_assign_role,
    assert_keeps_a_super_admin,
    assert_not_self,
    has_permission,
    user_permissions,
)
from app.services.profile import current_scores

router = APIRouter(prefix="/api/admin", tags=["admin-users"], responses=ERROR_RESPONSES)

Viewer = Annotated[User, Depends(require_permission("admin.access", "users.view"))]
DetailViewer = Annotated[User, Depends(require_permission("admin.access", "users.view_details"))]
Supporter = Annotated[User, Depends(require_permission("admin.access", "users.support"))]
Manager = Annotated[User, Depends(require_permission("admin.access", "users.manage"))]
RoleAssigner = Annotated[User, Depends(require_permission("admin.access", "roles.assign"))]
Deleter = Annotated[User, Depends(require_permission("admin.access", "users.delete"))]

SORTS = {
    "created_at": User.created_at,
    "email": User.email,
    "full_name": User.full_name,
    "last_seen_at": User.last_seen_at,
    "last_login_at": User.last_login_at,
    "status": User.status,
}


class EmailUnavailable(AppError):
    status_code = 503
    code = "EMAIL_UNAVAILABLE"


def _get_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found", "USER_NOT_FOUND")
    return user


def _day_start(d: date) -> datetime:
    return datetime.combine(d, time.min).replace(tzinfo=utcnow().tzinfo)


def _current_sub_exists(plan_id: int | None = None):
    cond = [UserSubscription.user_id == User.id, UserSubscription.status.in_(subs.ENTITLED)]
    if plan_id is not None:
        cond.append(UserSubscription.plan_id == plan_id)
    return exists().where(*cond)


@router.get("/users", response_model=Page[AdminUserRow], summary="Search, filter, sort and page user accounts")
def list_users(
    _: Viewer,
    db: DB,
    q: Annotated[str | None, Query(max_length=100, description="Email or name contains")] = None,
    role: Annotated[str | None, Query(max_length=48)] = None,
    status: AccountStatus | None = None,
    plan: Annotated[
        str | None, Query(max_length=48, description="Plan key; the default plan = no paid subscription")
    ] = None,
    registered_from: date | None = None,
    registered_to: date | None = None,
    active_within_days: Annotated[int | None, Query(ge=1, le=3650)] = None,
    inactive_for_days: Annotated[int | None, Query(ge=1, le=3650)] = None,
    sort: Literal["created_at", "email", "full_name", "last_seen_at", "last_login_at", "status"] = "created_at",
    order: Literal["asc", "desc"] = "desc",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> Page:
    subs.expire_due(db)
    db.commit()
    stmt = select(User)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.email.ilike(like), User.full_name.ilike(like)))
    if role:
        stmt = stmt.where(exists().where(UserRole.user_id == User.id, UserRole.role_id == Role.id, Role.key == role))
    if status:
        stmt = stmt.where(User.status == status)
    if plan:
        p = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.key == plan))
        if p is None:
            raise ValidationError("Unknown plan.", "UNKNOWN_PLAN")
        stmt = stmt.where(~_current_sub_exists()) if p.is_default else stmt.where(_current_sub_exists(p.id))
    if registered_from:
        stmt = stmt.where(User.created_at >= _day_start(registered_from))
    if registered_to:
        stmt = stmt.where(User.created_at < _day_start(registered_to) + timedelta(days=1))
    if active_within_days:
        stmt = stmt.where(User.last_seen_at >= utcnow() - timedelta(days=active_within_days))
    if inactive_for_days:
        cutoff = utcnow() - timedelta(days=inactive_for_days)
        stmt = stmt.where(or_(User.last_seen_at.is_(None), User.last_seen_at < cutoff))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    col = SORTS[sort]
    ordered = (col.desc().nulls_last() if order == "desc" else col.asc().nulls_last(), User.id.desc())
    rows = list(db.scalars(stmt.order_by(*ordered).offset((page - 1) * page_size).limit(page_size)))
    ids = [u.id for u in rows]
    done: dict[int, tuple[int, int | None]] = {}
    if ids:
        for uid, n in db.execute(
            select(AssessmentAttempt.user_id, func.count(AssessmentAttempt.id))
            .where(AssessmentAttempt.user_id.in_(ids), AssessmentAttempt.status == AttemptStatus.COMPLETED)
            .group_by(AssessmentAttempt.user_id)
        ):
            done[uid] = (n, None)
        for a in db.scalars(
            select(AssessmentAttempt)
            .where(AssessmentAttempt.user_id.in_(ids), AssessmentAttempt.status == AttemptStatus.COMPLETED)
            .order_by(AssessmentAttempt.completed_at)
        ):
            done[a.user_id] = (done[a.user_id][0], a.overall_score)
    default = subs.default_plan(db)
    items = []
    for u in rows:
        sub = subs.current_subscription(db, u.id)
        plan_obj = sub.plan if sub else default
        n, latest = done.get(u.id, (0, None))
        items.append(
            AdminUserRow(
                id=u.id,
                email=u.email,
                full_name=u.full_name,
                status=u.status,
                roles=u.role_keys,
                plan_key=plan_obj.key,
                plan_name=plan_obj.name,
                subscription_status=sub.status if sub else None,
                email_verified=u.email_verified_at is not None,
                onboarding_completed=u.onboarding_completed,
                created_at=u.created_at,
                last_login_at=u.last_login_at,
                last_seen_at=u.last_seen_at,
                completed_attempts=n,
                latest_overall=latest,
            )
        )
    return Page[AdminUserRow](items=items, total=total, page=page, page_size=page_size)


def _detail(db: Session, viewer: User, u: User) -> AdminUserDetail:
    p = u.profile
    sub = subs.current_subscription(db, u.id)
    plan_obj = sub.plan if sub else subs.default_plan(db)
    scores = current_scores(db, u.id)
    comps = {c.id: c for c in db.scalars(select(Competency))}
    lp = dict(
        db.execute(
            select(UserLearningProgress.status, func.count(UserLearningProgress.id))
            .where(UserLearningProgress.user_id == u.id)
            .group_by(UserLearningProgress.status)
        ).all()
    )
    pr = dict(
        db.execute(
            select(PracticeSubmission.status, func.count(PracticeSubmission.id))
            .where(PracticeSubmission.user_id == u.id)
            .group_by(PracticeSubmission.status)
        ).all()
    )
    audit_rows = None
    if has_permission(viewer, "audit.view"):
        rows = db.scalars(
            select(AuditLog)
            .where(or_(AuditLog.actor_id == u.id, (AuditLog.target_type == "user") & (AuditLog.target_id == u.id)))
            .order_by(AuditLog.id.desc())
            .limit(50)
        )
        audit_rows = [AuditLogOut.model_validate(r) for r in rows]
    can_manage = has_permission(viewer, "users.manage") and _outranks(viewer, u)
    return AdminUserDetail(
        id=u.id,
        email=u.email,
        full_name=u.full_name,
        status=u.status,
        status_reason=u.status_reason,
        status_changed_at=u.status_changed_at,
        deletion_requested_at=u.deletion_requested_at,
        roles=u.role_keys,
        permissions=sorted(user_permissions(u)),
        email_verified_at=u.email_verified_at,
        terms_accepted_at=u.terms_accepted_at,
        terms_version=u.terms_version,
        onboarding_completed=u.onboarding_completed,
        created_at=u.created_at,
        last_login_at=u.last_login_at,
        last_seen_at=u.last_seen_at,
        profile=None
        if p is None
        else {
            "education": p.education,
            "background": p.background,
            "entrepreneurial_experience": p.entrepreneurial_experience.value,
            "preferred_learning_format": p.preferred_learning_format.value,
            "weekly_learning_minutes": p.weekly_learning_minutes,
            "language": p.language,
        },
        goals=list(
            db.scalars(
                select(GoalDefinition.title)
                .join(UserGoal, UserGoal.goal_id == GoalDefinition.id)
                .where(UserGoal.user_id == u.id)
                .order_by(GoalDefinition.sort_order)
            )
        ),
        attempts=[
            AdminAttemptOut.model_validate(a)
            for a in db.scalars(
                select(AssessmentAttempt)
                .where(AssessmentAttempt.user_id == u.id)
                .order_by(AssessmentAttempt.id.desc())
                .limit(50)
            )
        ],
        competencies=[
            AdminCompetencyScoreOut(
                code=comps[cid].code,
                name=comps[cid].name,
                score=s.score,
                level=s.level.name if s.level else None,
                measured_at=s.created_at,
            )
            for cid, s in sorted(scores.items(), key=lambda kv: comps[kv[0]].sort_order)
        ],
        learning={
            "completed": lp.get(ProgressStatus.COMPLETED, 0),
            "in_progress": lp.get(ProgressStatus.IN_PROGRESS, 0),
        },
        practice={
            "completed": pr.get(PracticeStatus.COMPLETED, 0),
            "in_progress": sum(v for k, v in pr.items() if k != PracticeStatus.COMPLETED),
        },
        plan_key=plan_obj.key,
        plan_name=plan_obj.name,
        subscription=SubscriptionOut.model_validate(sub) if sub else None,
        subscription_history=[
            SubscriptionEventOut.model_validate(e)
            for e in db.scalars(
                select(SubscriptionEvent)
                .where(SubscriptionEvent.user_id == u.id)
                .order_by(SubscriptionEvent.id.desc())
                .limit(50)
            )
        ],
        sessions=[AdminSessionOut.model_validate(s) for s in accounts.active_sessions(db, u.id)],
        audit_events=audit_rows,
        can_manage=can_manage and viewer.id != u.id,
        can_assign_roles=has_permission(viewer, "roles.assign") and viewer.id != u.id and _outranks(viewer, u),
        can_delete=has_permission(viewer, "users.delete")
        and viewer.id != u.id
        and u.status == AccountStatus.DEACTIVATED,
    )


def _outranks(viewer: User, target: User) -> bool:
    try:
        assert_can_act_on(viewer, target)
        return True
    except AppError:
        return False


@router.get("/users/{user_id}", response_model=AdminUserDetail, summary="Full account details")
def get_user(user_id: int, viewer: DetailViewer, db: DB) -> AdminUserDetail:
    out = _detail(db, viewer, _get_user(db, user_id))
    db.commit()
    return out


@router.patch("/users/{user_id}", response_model=AdminUserDetail, summary="Edit name or email (reason required)")
def update_user(user_id: int, body: AdminUserUpdate, actor: Manager, db: DB) -> AdminUserDetail:
    u = _get_user(db, user_id)
    assert_can_act_on(actor, u)
    changed = []
    if body.full_name and body.full_name != u.full_name:
        u.full_name = body.full_name
        changed.append("full_name")
    if body.email and body.email != u.email:
        if db.scalar(select(User.id).where(User.email == body.email, User.id != u.id)):
            raise ConflictError("Another account already uses this email.", "EMAIL_TAKEN")
        u.email = body.email
        u.email_verified_at = None  # the new address has not been verified
        changed.append("email")
    if not changed:
        raise ValidationError("Nothing to change.", "NO_CHANGES")
    audit(db, actor.id, "admin.user_updated", "user", u.id, reason=body.reason, fields=changed)
    db.commit()
    return _detail(db, actor, u)


def _set_status(db: Session, actor: User, u: User, to: AccountStatus, reason: str, action: str) -> int:
    assert_not_self(actor, u, "change the status of")
    assert_can_act_on(actor, u)
    if u.status == to:
        raise ConflictError(f"This account is already {to.value}.", "STATUS_UNCHANGED")
    if to != AccountStatus.ACTIVE:
        assert_keeps_a_super_admin(db, u, deactivating=True)
    prev = u.status
    u.status, u.status_reason, u.status_changed_at = to, reason, utcnow()
    revoked = 0
    if to == AccountStatus.ACTIVE:
        u.deletion_requested_at = None
    else:
        revoked = accounts.revoke_all_sessions(db, u.id, f"account {to.value}")
    audit(
        db,
        actor.id,
        action,
        "user",
        u.id,
        reason=reason,
        from_status=prev.value,
        to_status=to.value,
        revoked_sessions=revoked,
    )
    db.commit()
    return revoked


@router.post("/users/{user_id}/suspend", response_model=ActionResult, summary="Suspend (signs the user out)")
def suspend(user_id: int, body: ReasonIn, actor: Manager, db: DB) -> ActionResult:
    n = _set_status(db, actor, _get_user(db, user_id), AccountStatus.SUSPENDED, body.reason, "admin.user_suspended")
    return ActionResult(message="Account suspended. The user has been signed out.", revoked_sessions=n)


@router.post(
    "/users/{user_id}/deactivate",
    response_model=ActionResult,
    summary="Deactivate (data kept; permanent deletion is a separate step)",
)
def deactivate(user_id: int, body: ReasonIn, actor: Manager, db: DB) -> ActionResult:
    n = _set_status(db, actor, _get_user(db, user_id), AccountStatus.DEACTIVATED, body.reason, "admin.user_deactivated")
    return ActionResult(message="Account deactivated. The user has been signed out.", revoked_sessions=n)


@router.post("/users/{user_id}/reactivate", response_model=ActionResult, summary="Reactivate a suspended account")
def reactivate(user_id: int, body: ReasonIn, actor: Manager, db: DB) -> ActionResult:
    _set_status(db, actor, _get_user(db, user_id), AccountStatus.ACTIVE, body.reason, "admin.user_reactivated")
    return ActionResult(message="Account reactivated.")


@router.post("/users/{user_id}/revoke-sessions", response_model=ActionResult, summary="Sign the user out everywhere")
def revoke_sessions(user_id: int, body: ReasonIn, actor: Supporter, db: DB) -> ActionResult:
    u = _get_user(db, user_id)
    assert_can_act_on(actor, u)
    n = accounts.revoke_all_sessions(db, u.id, "revoked by staff")
    audit(db, actor.id, "admin.sessions_revoked", "user", u.id, reason=body.reason, revoked_sessions=n)
    db.commit()
    return ActionResult(message=f"{n} active session(s) revoked.", revoked_sessions=n)


@router.post(
    "/users/{user_id}/password-reset",
    response_model=ActionResult,
    summary="Send the user a password reset link (staff never see or set passwords)",
    responses={503: {"description": "No email delivery is configured"}},
)
def send_password_reset(user_id: int, body: ReasonIn, actor: Supporter, db: DB) -> ActionResult:
    u = _get_user(db, user_id)
    assert_can_act_on(actor, u)
    if not email_service.is_available():
        raise EmailUnavailable(
            "Email delivery is not configured, so no reset link can be sent. Configure SMTP (EMAIL_BACKEND=smtp) first."
        )
    if u.status != AccountStatus.ACTIVE:
        raise ConflictError("Reactivate the account before sending a password reset.", "ACCOUNT_INACTIVE")
    result = accounts.start_password_reset(db, u, requested_by_id=actor.id)
    audit(
        db,
        actor.id,
        "admin.password_reset_sent",
        "user",
        u.id,
        reason=body.reason,
        backend=result.backend,
        delivered=result.delivered,
    )
    db.commit()
    if result.delivered:
        msg = f"A password reset link was emailed to {u.email}."
    else:
        msg = "Email is in development mode: the reset link was written to the server log, not emailed."
    return ActionResult(message=msg, delivered=result.delivered, backend=result.backend)


@router.post("/users/{user_id}/roles", response_model=AdminUserDetail, summary="Grant a role")
def assign_role(user_id: int, body: RoleAssignIn, actor: RoleAssigner, db: DB) -> AdminUserDetail:
    u = _get_user(db, user_id)
    role = db.scalar(select(Role).where(Role.key == body.role_key))
    if role is None:
        raise NotFoundError("Role not found", "ROLE_NOT_FOUND")
    assert_can_assign_role(actor, u, role)
    if body.role_key in u.role_keys:
        raise ConflictError("The user already has this role.", "ROLE_ALREADY_ASSIGNED")
    u.role_links.append(UserRole(role_id=role.id, role=role, granted_by_id=actor.id))
    audit(db, actor.id, "admin.role_granted", "user", u.id, reason=body.reason, role=role.key)
    db.commit()
    db.refresh(u)
    return _detail(db, actor, u)


@router.delete("/users/{user_id}/roles/{role_key}", response_model=AdminUserDetail, summary="Revoke a role")
def revoke_role(
    user_id: int,
    role_key: str,
    actor: RoleAssigner,
    db: DB,
    reason: Annotated[str, Query(min_length=3, max_length=500)],
) -> AdminUserDetail:
    u = _get_user(db, user_id)
    role = db.scalar(select(Role).where(Role.key == role_key))
    if role is None:
        raise NotFoundError("Role not found", "ROLE_NOT_FOUND")
    assert_can_assign_role(actor, u, role)
    link = next((x for x in u.role_links if x.role_id == role.id), None)
    if link is None:
        raise ConflictError("The user does not have this role.", "ROLE_NOT_ASSIGNED")
    assert_keeps_a_super_admin(db, u, removing_role=role)
    u.role_links.remove(link)
    audit(db, actor.id, "admin.role_revoked", "user", u.id, reason=" ".join(reason.split()), role=role.key)
    db.commit()
    db.refresh(u)
    return _detail(db, actor, u)


@router.delete(
    "/users/{user_id}",
    response_model=ActionResult,
    summary="Permanently delete a deactivated account (super admin; email confirmation required)",
)
def delete_user(user_id: int, actor: Deleter, db: DB, body: Annotated[DeleteUserIn, Body()]) -> ActionResult:
    u = _get_user(db, user_id)
    assert_not_self(actor, u, "delete")
    assert_can_act_on(actor, u)
    if u.status != AccountStatus.DEACTIVATED:
        raise ConflictError(
            "Only deactivated accounts can be deleted. Deactivate the account first.", "NOT_DEACTIVATED"
        )
    if body.confirm_email.strip().lower() != u.email:
        raise ValidationError("The confirmation email does not match this account.", "CONFIRMATION_MISMATCH")
    assert_keeps_a_super_admin(db, u, deactivating=True)
    # The audit row keeps only the numeric id: the deleted person's email/name are not retained.
    audit(db, actor.id, "admin.user_deleted", "user", u.id, reason=body.reason)
    db.delete(u)
    db.commit()
    return ActionResult(message="The account and its personal data were permanently deleted.")
