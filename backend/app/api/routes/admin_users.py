"""User management for staff. Every operation checks a permission and the rank policy in services/permissions.py."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, Query, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import DB, require_permission
from app.core.database import utcnow
from app.core.errors import AppError, AuthorizationError, ConflictError, NotFoundError, ValidationError
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
    UserProfile,
    UserRole,
    UserSubscription,
)
from app.models.enums import AccountStatus, AttemptStatus, PracticeStatus, ProgressStatus
from app.schemas.admin_users import (
    ActionResult,
    AdminAttemptOut,
    AdminCompetencyScoreOut,
    AdminSessionOut,
    AdminUserCreate,
    AdminUserCreated,
    AdminUserDetail,
    AdminUserRow,
    AdminUserUpdate,
    AuditLogOut,
    DeleteUserIn,
    ReasonIn,
    RoleAssignIn,
    VersionedReasonIn,
)
from app.schemas.billing import SubscriptionEventOut, SubscriptionOut
from app.schemas.common import ERROR_RESPONSES, Page
from app.services import accounts
from app.services import email as email_service
from app.services import entitlements as ent_service
from app.services import subscriptions as subs
from app.services.audit import audit
from app.services.locking import changes, check_version, snapshot
from app.services.permissions import (
    DEFAULT_ROLE,
    SUPER_ADMIN,
    assert_can_act_on,
    assert_can_assign_role,
    assert_keeps_a_super_admin,
    assert_not_self,
    give_role,
    has_permission,
    is_super_admin,
    user_permissions,
    user_rank,
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
    language: Annotated[
        Literal["ru", "kk", "en", "none"] | None, Query(description="Saved interface language; none = not chosen")
    ] = None,
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
    if language == "none":
        stmt = stmt.where(~exists().where(UserProfile.user_id == User.id, UserProfile.language.is_not(None)))
    elif language:
        stmt = stmt.where(exists().where(UserProfile.user_id == User.id, UserProfile.language == language))
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
                language=u.profile.language if u.profile else None,
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
    audit_rows = activity_rows = history_rows = None
    if has_permission(viewer, "audit.view"):
        audit_rows = _audit_out(
            db,
            select(AuditLog)
            .where(or_(AuditLog.actor_id == u.id, (AuditLog.target_type == "user") & (AuditLog.target_id == u.id)))
            .order_by(AuditLog.id.desc())
            .limit(50),
        )
        activity_rows = _audit_out(
            db, select(AuditLog).where(AuditLog.actor_id == u.id).order_by(AuditLog.id.desc()).limit(50)
        )
        sub_ids = select(UserSubscription.id).where(UserSubscription.user_id == u.id)
        history_rows = _audit_out(
            db,
            select(AuditLog)
            .where(
                ~AuditLog.action.like("auth.log%"),
                ~AuditLog.action.like("auth.session%"),
                ~AuditLog.action.like("access.%"),
                or_(
                    and_(AuditLog.target_type == "user", AuditLog.target_id == u.id),
                    and_(AuditLog.target_type == "subscription", AuditLog.target_id.in_(sub_ids)),
                ),
            )
            .order_by(AuditLog.id.desc())
            .limit(100),
        )
    can_manage = has_permission(viewer, "users.manage") and _outranks(viewer, u)
    return AdminUserDetail(
        id=u.id,
        lock_version=u.lock_version,
        email=u.email,
        full_name=u.full_name,
        language=p.language if p else None,
        email_verified=u.email_verified_at is not None,
        auth_methods=[m for m, on in (("email", bool(u.password_hash)),
                                      ("google", any(i.provider == "google" for i in u.oauth_identities))) if on],
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
        goals=[
            g.title  # entity, not column: titles are localized
            for g in db.scalars(
                select(GoalDefinition)
                .join(UserGoal, UserGoal.goal_id == GoalDefinition.id)
                .where(UserGoal.user_id == u.id)
                .order_by(GoalDefinition.sort_order)
            )
        ],
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
        entitlements=[
            {k: v for k, v in e.as_dict().items() if k not in ("used", "remaining")}
            for e in ent_service.entitlements_for(db, u, with_usage=False).values()
        ],
        audit_events=audit_rows,
        activity=activity_rows,
        change_history=history_rows,
        can_manage=can_manage and viewer.id != u.id,
        can_assign_roles=has_permission(viewer, "roles.assign") and viewer.id != u.id and _outranks(viewer, u),
        can_delete=has_permission(viewer, "users.delete")
        and viewer.id != u.id
        and u.status == AccountStatus.DEACTIVATED,
    )


def _audit_out(db: Session, stmt) -> list[AuditLogOut]:
    rows = list(db.scalars(stmt))
    actor_ids = {r.actor_id for r in rows if r.actor_id is not None}
    emails = dict(db.execute(select(User.id, User.email).where(User.id.in_(actor_ids))).all()) if actor_ids else {}
    out = []
    for r in rows:
        item = AuditLogOut.model_validate(r)
        item.actor_email = emails.get(r.actor_id)
        out.append(item)
    return out


def _outranks(viewer: User, target: User) -> bool:
    try:
        assert_can_act_on(viewer, target)
        return True
    except AppError:
        return False


def _check_grantable(actor: User, role) -> None:
    """Initial roles of a new account follow the same rank rules as granting a role to an existing one."""
    if role.key == DEFAULT_ROLE:
        return
    if not has_permission(actor, "roles.assign"):
        raise AuthorizationError("You don't have permission to grant roles.", "INSUFFICIENT_RANK")
    if role.key == SUPER_ADMIN and not is_super_admin(actor):
        raise AuthorizationError("Only a super administrator can grant super administrator.", "INSUFFICIENT_RANK")
    if not is_super_admin(actor) and role.rank >= user_rank(actor):
        raise AuthorizationError("You can only grant roles ranked below your own.", "INSUFFICIENT_RANK")


INVITE_MESSAGES = {
    "sent": "The account was created and an invitation to set a password was emailed to {email}.",
    "logged": "The account was created. Email is in development mode: the password-setup link was written to the "
    "server log, not emailed.",
    "unavailable": "The account was created, but email delivery is not configured, so no invitation was sent. "
    "Configure SMTP and use “Send password reset” to invite the person.",
    "failed": "The account was created, but the invitation email could not be delivered. Try “Send password reset”.",
    "not_requested": "The account was created. No invitation was sent.",
}


@router.post(
    "/users",
    response_model=AdminUserCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account (no password: the person sets one through an emailed link)",
    responses={409: {"description": "EMAIL_TAKEN — an account with this email exists (repeat requests too)"}},
)
def create_user(body: AdminUserCreate, actor: Manager, db: DB) -> AdminUserCreated:
    if db.scalar(select(User.id).where(User.email == body.email)) is not None:
        raise ConflictError("An account with this email already exists.", "EMAIL_TAKEN")
    keys = sorted({DEFAULT_ROLE, *body.roles})
    roles = {r.key: r for r in db.scalars(select(Role).where(Role.key.in_(keys)))}
    missing = [k for k in keys if k not in roles]
    if missing:
        raise NotFoundError("Role not found", "ROLE_NOT_FOUND", {"roles": missing})
    for k in keys:
        _check_grantable(actor, roles[k])
    now = utcnow()
    st = AccountStatus(body.status)
    u = User(email=body.email, password_hash="", full_name=body.full_name, status=st,
             status_changed_at=now if st != AccountStatus.ACTIVE else None,
             status_reason=body.reason if st != AccountStatus.ACTIVE else None)
    u.profile = UserProfile(language=body.language)
    db.add(u)
    try:
        db.flush()
    except IntegrityError as e:  # concurrent create with the same email: the unique index decides
        db.rollback()
        raise ConflictError("An account with this email already exists.", "EMAIL_TAKEN") from e
    for k in keys:
        give_role(db, u, k, granted_by=actor)
    invitation = "not_requested"
    if body.send_invitation and st == AccountStatus.ACTIVE:
        if not email_service.is_available():
            invitation = "unavailable"
        else:
            result = accounts.start_password_reset(db, u, requested_by_id=actor.id)
            invitation = "sent" if result.delivered else ("logged" if result.backend == "console" else "failed")
    audit(db, actor.id, "admin.user_created", "user", u.id, reason=body.reason, roles=keys, status=st.value,
          language=body.language, invitation=invitation,
          changes={"full_name": {"from": None, "to": u.full_name}, "email": {"from": None, "to": u.email},
                   "roles": {"from": [], "to": keys}, "status": {"from": None, "to": st.value},
                   "language": {"from": None, "to": body.language}})
    db.commit()
    db.refresh(u)
    return AdminUserCreated(user=_detail(db, actor, u), invitation=invitation,
                            message=INVITE_MESSAGES[invitation].format(email=u.email))


@router.get("/users/{user_id}", response_model=AdminUserDetail, summary="Full account details")
def get_user(user_id: int, viewer: DetailViewer, db: DB) -> AdminUserDetail:
    out = _detail(db, viewer, _get_user(db, user_id))
    db.commit()
    return out


PROFILE_FIELDS = ("full_name", "email", "email_verified", "language")
STATUS_FIELDS = ("status", "status_reason")


def _profile_snapshot(u: User) -> dict:
    return {
        "full_name": u.full_name,
        "email": u.email,
        "email_verified": u.email_verified_at is not None,
        "language": u.profile.language if u.profile else None,
    }


def _bump(u: User) -> None:
    """Make the account row part of the transaction so lock_version moves even when only a related row changed
    (profile language, roles); the UPDATE also fails with 409 if someone else saved the account meanwhile."""
    u.updated_at = utcnow()


@router.patch(
    "/users/{user_id}",
    response_model=AdminUserDetail,
    summary="Edit name, email or interface language (reason required; send expected_version)",
    responses={409: {"description": "EMAIL_TAKEN, or VERSION_CONFLICT when the account changed since it was loaded"}},
)
def update_user(user_id: int, body: AdminUserUpdate, actor: Manager, db: DB) -> AdminUserDetail:
    u = _get_user(db, user_id)
    assert_can_act_on(actor, u)
    check_version(u, body.expected_version)
    before = _profile_snapshot(u)
    if body.full_name and body.full_name != u.full_name:
        u.full_name = body.full_name
    old_email = None
    if body.email and body.email != u.email:
        # Staff change their own email through the normal account flow, not with admin powers.
        assert_not_self(actor, u, "change the email of")
        accounts.assert_not_demo(u)
        if db.scalar(select(User.id).where(User.email == body.email, User.id != u.id)):
            raise ConflictError("Another account already uses this email.", "EMAIL_TAKEN")
        old_email = u.email
        u.email = body.email
        u.email_verified_at = None  # the new address has not been verified
    if body.language and body.language != (u.profile.language if u.profile else None):
        if u.profile is None:
            u.profile = UserProfile()
        u.profile.language = body.language
    diff = changes(before, _profile_snapshot(u))
    if not diff:
        raise ValidationError("Nothing to change.", "NO_CHANGES")
    _bump(u)
    extra: dict = {}
    if old_email is not None:
        # The sign-in identifier changed: end every session and cancel links that were sent to the old address.
        extra["revoked_sessions"] = accounts.revoke_all_sessions(db, u.id, "email changed by staff")
        extra["pending_links_invalidated"] = accounts.invalidate_pending_tokens(db, u.id)
    audit(db, actor.id, "admin.user_updated", "user", u.id, reason=body.reason, fields=sorted(diff), changes=diff,
          **extra)
    try:
        db.commit()
    except IntegrityError as e:  # a concurrent request took the email between the check and the commit
        db.rollback()
        raise ConflictError("Another account already uses this email.", "EMAIL_TAKEN") from e
    if old_email is not None and email_service.is_available():
        from app.services import email_templates

        subject, text = email_templates.render("email_changed", email_templates.email_language(u),
                                               name=u.full_name, new_email=u.email)
        result = email_service.send(old_email, subject, text)
        audit(db, actor.id, "admin.email_change_notified", "user", u.id, backend=result.backend,
              delivered=result.delivered)
        db.commit()
    return _detail(db, actor, u)


def _set_status(
    db: Session, actor: User, u: User, to: AccountStatus, reason: str, action: str, expected: int | None = None
) -> int:
    assert_not_self(actor, u, "change the status of")
    assert_can_act_on(actor, u)
    check_version(u, expected)
    if u.status == to:
        raise ConflictError(f"This account is already {to.value}.", "STATUS_UNCHANGED")
    if to != AccountStatus.ACTIVE:
        assert_keeps_a_super_admin(db, u, deactivating=True)
    prev = u.status
    before = snapshot(u, STATUS_FIELDS)
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
        changes=changes(before, snapshot(u, STATUS_FIELDS)),
    )
    db.commit()
    return revoked


@router.post("/users/{user_id}/suspend", response_model=ActionResult, summary="Suspend (signs the user out)")
def suspend(user_id: int, body: VersionedReasonIn, actor: Manager, db: DB) -> ActionResult:
    n = _set_status(db, actor, _get_user(db, user_id), AccountStatus.SUSPENDED, body.reason, "admin.user_suspended",
                    body.expected_version)
    return ActionResult(message="Account suspended. The user has been signed out.", revoked_sessions=n)


@router.post(
    "/users/{user_id}/deactivate",
    response_model=ActionResult,
    summary="Deactivate (data kept; permanent deletion is a separate step)",
)
def deactivate(user_id: int, body: VersionedReasonIn, actor: Manager, db: DB) -> ActionResult:
    n = _set_status(db, actor, _get_user(db, user_id), AccountStatus.DEACTIVATED, body.reason, "admin.user_deactivated",
                    body.expected_version)
    return ActionResult(message="Account deactivated. The user has been signed out.", revoked_sessions=n)


@router.post("/users/{user_id}/reactivate", response_model=ActionResult, summary="Reactivate a suspended account")
def reactivate(user_id: int, body: VersionedReasonIn, actor: Manager, db: DB) -> ActionResult:
    _set_status(
        db, actor, _get_user(db, user_id), AccountStatus.ACTIVE, body.reason, "admin.user_reactivated",
        body.expected_version,
    )
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


@router.post(
    "/users/{user_id}/resend-verification",
    response_model=ActionResult,
    summary="Send the email confirmation link again",
    responses={503: {"description": "No email delivery is configured"}},
)
def resend_verification(user_id: int, body: ReasonIn, actor: Supporter, db: DB) -> ActionResult:
    u = _get_user(db, user_id)
    assert_can_act_on(actor, u)
    if u.email_verified_at is not None:
        raise ConflictError("This email address is already confirmed.", "ALREADY_VERIFIED")
    if u.status != AccountStatus.ACTIVE:
        raise ConflictError("Reactivate the account before sending a confirmation link.", "ACCOUNT_INACTIVE")
    if not email_service.is_available():
        raise EmailUnavailable(
            "Email delivery is not configured, so no confirmation link can be sent. Configure SMTP first."
        )
    result = accounts.start_email_verification(db, u)
    audit(db, actor.id, "admin.verification_sent", "user", u.id, reason=body.reason, backend=result.backend,
          delivered=result.delivered)
    db.commit()
    if result.delivered:
        msg = f"A confirmation link was emailed to {u.email}."
    elif result.backend == "console":
        msg = "Email is in development mode: the confirmation link was written to the server log, not emailed."
    else:
        msg = "The confirmation email could not be delivered. Try again later."
    return ActionResult(message=msg, delivered=result.delivered, backend=result.backend)


@router.post("/users/{user_id}/roles", response_model=AdminUserDetail, summary="Grant a role")
def assign_role(user_id: int, body: RoleAssignIn, actor: RoleAssigner, db: DB) -> AdminUserDetail:
    u = _get_user(db, user_id)
    role = db.scalar(select(Role).where(Role.key == body.role_key))
    if role is None:
        raise NotFoundError("Role not found", "ROLE_NOT_FOUND")
    assert_can_assign_role(actor, u, role)
    check_version(u, body.expected_version)
    if body.role_key in u.role_keys:
        raise ConflictError("The user already has this role.", "ROLE_ALREADY_ASSIGNED")
    before = u.role_keys
    u.role_links.append(UserRole(role_id=role.id, role=role, granted_by_id=actor.id))
    _bump(u)
    audit(db, actor.id, "admin.role_granted", "user", u.id, reason=body.reason, role=role.key,
          changes={"roles": {"from": before, "to": sorted([*before, role.key])}})
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
    expected_version: Annotated[int | None, Query(ge=1)] = None,
) -> AdminUserDetail:
    u = _get_user(db, user_id)
    role = db.scalar(select(Role).where(Role.key == role_key))
    if role is None:
        raise NotFoundError("Role not found", "ROLE_NOT_FOUND")
    assert_can_assign_role(actor, u, role)
    link = next((x for x in u.role_links if x.role_id == role.id), None)
    if link is None:
        raise ConflictError("The user does not have this role.", "ROLE_NOT_ASSIGNED")
    check_version(u, expected_version)
    assert_keeps_a_super_admin(db, u, removing_role=role)
    before = u.role_keys
    u.role_links.remove(link)
    _bump(u)
    audit(db, actor.id, "admin.role_revoked", "user", u.id, reason=" ".join(reason.split()), role=role.key,
          changes={"roles": {"from": before, "to": [k for k in before if k != role.key]}})
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
