"""Admin dashboard analytics, roles & permissions, audit log and configuration status."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.api.deps import DB, AdminAccess, require_permission
from app.core.config import get_settings
from app.core.database import as_utc, utcnow
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models import (
    AIEvaluation,
    AssessmentAttempt,
    AuditLog,
    LearningActivity,
    Permission,
    PracticeSubmission,
    Role,
    RolePermission,
    SubscriptionPlan,
    User,
    UserLearningProgress,
    UserRole,
    UserSubscription,
)
from app.models.enums import (
    AccountStatus,
    ActivityStatus,
    AIEvalStatus,
    AttemptScope,
    AttemptStatus,
    AuditOutcome,
    PracticeStatus,
    ProgressStatus,
    SubscriptionSource,
    SubscriptionStatus,
)
from app.schemas.admin_users import AuditLogOut
from app.schemas.common import ERROR_RESPONSES, Page
from app.services import email as email_service
from app.services import payments
from app.services import subscriptions as subs
from app.services.audit import audit
from app.services.permissions import PERMISSIONS, SUPER_ADMIN, has_permission, is_super_admin, user_rank

router = APIRouter(prefix="/api/admin", tags=["admin-system"], responses=ERROR_RESPONSES)

Analyst = Annotated[User, Depends(require_permission("admin.access", "analytics.view"))]
RoleViewer = Annotated[User, Depends(require_permission("admin.access", "roles.view"))]
RoleManager = Annotated[User, Depends(require_permission("admin.access", "roles.manage"))]
Auditor = Annotated[User, Depends(require_permission("admin.access", "audit.view"))]
SettingsViewer = Annotated[User, Depends(require_permission("admin.access", "settings.view"))]

SECURITY_ACTIONS = ("auth.login_failed", "auth.login_blocked", "access.denied", "auth.password_change_failed",
                    "auth.sessions_revoked", "admin.user_suspended", "admin.sessions_revoked",
                    "admin.role_granted", "admin.role_revoked", "admin.user_deleted")


# --- Admin home: who am I here --------------------------------------------------------------------

class AdminMe(BaseModel):
    permissions: list[str]
    roles: list[str]
    rank: int


@router.get("/me", response_model=AdminMe, summary="The caller's admin permissions (drives the admin navigation)")
def admin_me(user: AdminAccess) -> AdminMe:
    from app.services.permissions import user_permissions

    return AdminMe(permissions=sorted(user_permissions(user)), roles=user.role_keys, rank=user_rank(user))


# --- Analytics ------------------------------------------------------------------------------------

def _count(db, stmt) -> int:
    return db.scalar(stmt) or 0


@router.get("/analytics/overview", summary="Dashboard metrics computed from the database")
def overview(viewer: Analyst, db: DB, days: Annotated[int, Query(ge=7, le=365)] = 30) -> dict:
    subs.expire_due(db)
    db.commit()
    now = utcnow()
    since = now - timedelta(days=days)
    week = now - timedelta(days=7)

    users_total = _count(db, select(func.count(User.id)))
    by_status = dict(db.execute(select(User.status, func.count(User.id)).group_by(User.status)).all())
    reg_rows = db.scalars(select(User.created_at).where(User.created_at >= since))
    reg = Counter(as_utc(d).date().isoformat() for d in reg_rows if d)
    start = (now - timedelta(days=days - 1)).date()
    registrations = [{"date": (start + timedelta(days=i)).isoformat(),
                      "count": reg.get((start + timedelta(days=i)).isoformat(), 0)} for i in range(days)]

    full = AssessmentAttempt.scope == AttemptScope.FULL
    att = dict(db.execute(select(AssessmentAttempt.status, func.count(AssessmentAttempt.id)).where(full)
                          .group_by(AssessmentAttempt.status)).all())
    started = sum(att.values())
    completed = att.get(AttemptStatus.COMPLETED, 0)
    avg = db.scalar(select(func.avg(AssessmentAttempt.overall_score))
                    .where(AssessmentAttempt.status == AttemptStatus.COMPLETED))

    sub_status = dict(db.execute(select(UserSubscription.status, func.count(UserSubscription.id))
                                 .group_by(UserSubscription.status)).all())
    # Paying = a current subscription on a priced plan that came from a verified payment. Plans granted by staff
    # (source admin/trial/system), even on a priced plan, are counted under granted_free_of_charge.
    paid_users = _count(db, select(func.count(func.distinct(UserSubscription.user_id)))
                        .join(SubscriptionPlan, SubscriptionPlan.id == UserSubscription.plan_id)
                        .where(UserSubscription.status.in_(subs.ENTITLED), SubscriptionPlan.price_cents > 0,
                               UserSubscription.source == SubscriptionSource.PAYMENT))
    entitled_users = _count(db, select(func.count(func.distinct(UserSubscription.user_id)))
                            .where(UserSubscription.status.in_(subs.ENTITLED)))
    by_plan = [{"plan": p.key, "name": p.name, "count": c} for p, c in db.execute(
        select(SubscriptionPlan, func.count(UserSubscription.id))
        .join(UserSubscription, UserSubscription.plan_id == SubscriptionPlan.id)
        .where(UserSubscription.status.in_(subs.ENTITLED)).group_by(SubscriptionPlan.id))]

    lp = dict(db.execute(select(UserLearningProgress.status, func.count(UserLearningProgress.id))
                         .group_by(UserLearningProgress.status)).all())
    out: dict = {
        "generated_at": now.isoformat(),
        "window_days": days,
        "users": {
            "total": users_total,
            "active": by_status.get(AccountStatus.ACTIVE, 0),
            "suspended": by_status.get(AccountStatus.SUSPENDED, 0),
            "deactivated": by_status.get(AccountStatus.DEACTIVATED, 0),
            "verified": _count(db, select(func.count(User.id)).where(User.email_verified_at.is_not(None))),
            "onboarded": _count(db, select(func.count(User.id)).where(User.onboarding_completed.is_(True))),
            "new_in_window": sum(reg.values()),
            "new_last_7_days": _count(db, select(func.count(User.id)).where(User.created_at >= week)),
            "active_last_7_days": _count(db, select(func.count(User.id)).where(User.last_seen_at >= week)),
            "active_in_window": _count(db, select(func.count(User.id)).where(User.last_seen_at >= since)),
        },
        "registrations": registrations,
        "assessments": {
            "started": started,
            "completed": completed,
            "in_progress": att.get(AttemptStatus.IN_PROGRESS, 0),
            "abandoned": att.get(AttemptStatus.ABANDONED, 0),
            "completed_in_window": _count(db, select(func.count(AssessmentAttempt.id)).where(
                AssessmentAttempt.status == AttemptStatus.COMPLETED, AssessmentAttempt.completed_at >= since)),
            "completion_rate": round(completed / started * 100, 1) if started else None,
            "reassessments_completed": _count(db, select(func.count(AssessmentAttempt.id)).where(
                AssessmentAttempt.scope != AttemptScope.FULL, AssessmentAttempt.status == AttemptStatus.COMPLETED)),
            "average_overall": round(float(avg), 1) if avg is not None else None,
        },
        "subscriptions": {
            "free_users": max(0, users_total - entitled_users),
            "paid_users": paid_users,
            "granted_free_of_charge": max(0, entitled_users - paid_users),
            "by_status": {s.value: sub_status.get(s, 0) for s in SubscriptionStatus},
            "by_plan": by_plan,
            "expiring_in_7_days": _count(db, select(func.count(UserSubscription.id)).where(
                UserSubscription.status.in_(subs.CURRENT), UserSubscription.expires_at.is_not(None),
                UserSubscription.expires_at <= now + timedelta(days=7))),
        },
        "learning": {
            "resources_completed": lp.get(ProgressStatus.COMPLETED, 0),
            "resources_in_progress": lp.get(ProgressStatus.IN_PROGRESS, 0),
            "resources_completed_in_window": _count(db, select(func.count(UserLearningProgress.id)).where(
                UserLearningProgress.status == ProgressStatus.COMPLETED, UserLearningProgress.completed_at >= since)),
            "tasks_completed": _count(db, select(func.count(PracticeSubmission.id))
                                      .where(PracticeSubmission.status == PracticeStatus.COMPLETED)),
            "plan_activities_completed": _count(db, select(func.count(LearningActivity.id))
                                                .where(LearningActivity.status == ActivityStatus.DONE)),
            "learners_active_in_window": _count(db, select(func.count(func.distinct(UserLearningProgress.user_id)))
                                                .where(UserLearningProgress.last_accessed_at >= since)),
        },
        "ai": {
            "evaluations": _count(db, select(func.count(AIEvaluation.id))),
            "fallbacks": _count(db, select(func.count(AIEvaluation.id))
                                .where(AIEvaluation.status == AIEvalStatus.FALLBACK)),
        },
        "recent_admin_actions": None,
        "security_events": None,
        "security_summary": None,
    }
    if has_permission(viewer, "audit.view"):
        out["recent_admin_actions"] = [_audit_out(db, r).model_dump(mode="json") for r in db.scalars(
            select(AuditLog).where(AuditLog.action.like("admin.%")).order_by(AuditLog.id.desc()).limit(10))]
        out["security_events"] = [_audit_out(db, r).model_dump(mode="json") for r in db.scalars(
            select(AuditLog).where(or_(AuditLog.action.in_(SECURITY_ACTIONS),
                                       AuditLog.outcome != AuditOutcome.SUCCESS))
            .order_by(AuditLog.id.desc()).limit(10))]
        out["security_summary"] = {
            "failed_logins_7_days": _count(db, select(func.count(AuditLog.id)).where(
                AuditLog.action == "auth.login_failed", AuditLog.created_at >= week)),
            "access_denied_7_days": _count(db, select(func.count(AuditLog.id)).where(
                AuditLog.action == "access.denied", AuditLog.created_at >= week)),
        }
    return out


# --- Roles & permissions --------------------------------------------------------------------------

class PermissionOut(BaseModel):
    key: str
    description: str


class RoleOut(BaseModel):
    id: int
    key: str
    name: str
    description: str | None
    rank: int
    is_system: bool
    permissions: list[str]
    user_count: int
    editable: bool


class RoleIn(BaseModel):
    key: str = Field(min_length=2, max_length=48, pattern=r"^[a-z0-9_]+$")
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    rank: int = Field(ge=0, le=29)
    permissions: list[str] = Field(default_factory=list)
    reason: str = Field(min_length=3, max_length=500)


class RolePermissionsIn(BaseModel):
    permissions: list[str]
    reason: str = Field(min_length=3, max_length=500)


def _role_out(db, r: Role, viewer) -> RoleOut:
    n = _count(db, select(func.count(UserRole.id)).where(UserRole.role_id == r.id))
    perms = sorted(PERMISSIONS) if r.key == SUPER_ADMIN else sorted(r.permission_keys)
    return RoleOut(id=r.id, key=r.key, name=r.name, description=r.description, rank=r.rank, is_system=r.is_system,
                   permissions=perms, user_count=n,
                   editable=r.key != SUPER_ADMIN and has_permission(viewer, "roles.manage"))


@router.get("/permissions", response_model=list[PermissionOut], summary="Permission catalogue")
def list_permissions(_: RoleViewer) -> list[PermissionOut]:
    return [PermissionOut(key=k, description=v) for k, v in PERMISSIONS.items()]


@router.get("/roles", response_model=list[RoleOut], summary="Roles with their permissions and member counts")
def list_roles(viewer: RoleViewer, db: DB) -> list[RoleOut]:
    return [_role_out(db, r, viewer) for r in db.scalars(select(Role).order_by(Role.rank, Role.key))]


def _validate_perms(keys: list[str]) -> list[str]:
    unknown = sorted(set(keys) - set(PERMISSIONS))
    if unknown:
        raise ValidationError("Unknown permission.", "UNKNOWN_PERMISSION", {"permissions": unknown})
    if "users.delete" in keys or "roles.manage" in keys:
        raise ValidationError("users.delete and roles.manage are reserved for super administrators.",
                              "RESERVED_PERMISSION")
    return sorted(set(keys))


@router.post("/roles", response_model=RoleOut, status_code=status.HTTP_201_CREATED, summary="Create a custom role")
def create_role(body: RoleIn, actor: RoleManager, db: DB) -> RoleOut:
    if db.scalar(select(Role.id).where(Role.key == body.key)):
        raise ConflictError("A role with this key exists.", "ROLE_KEY_TAKEN")
    keys = _validate_perms(body.permissions)
    r = Role(key=body.key, name=body.name, description=body.description, rank=body.rank, is_system=False)
    db.add(r)
    db.flush()
    for p in db.scalars(select(Permission).where(Permission.key.in_(keys))):
        db.add(RolePermission(role_id=r.id, permission_id=p.id))
    audit(db, actor.id, "admin.role_created", "role", r.id, reason=body.reason, key=r.key, permissions=keys)
    db.commit()
    db.refresh(r)
    return _role_out(db, r, actor)


@router.put("/roles/{role_id}/permissions", response_model=RoleOut, summary="Replace a role's permissions")
def set_role_permissions(role_id: int, body: RolePermissionsIn, actor: RoleManager, db: DB) -> RoleOut:
    r = db.get(Role, role_id)
    if r is None:
        raise NotFoundError("Role not found", "ROLE_NOT_FOUND")
    if r.key == SUPER_ADMIN:
        raise ConflictError("The super administrator role always has every permission.", "ROLE_IMMUTABLE")
    if not is_super_admin(actor):  # pragma: no cover - roles.manage is reserved for super admins
        raise ConflictError("Only super administrators can change role permissions.", "ROLE_IMMUTABLE")
    keys = _validate_perms(body.permissions)
    before = sorted(r.permission_keys)
    for link in list(r.permission_links):
        db.delete(link)
    db.flush()
    for p in db.scalars(select(Permission).where(Permission.key.in_(keys))):
        db.add(RolePermission(role_id=r.id, permission_id=p.id))
    audit(db, actor.id, "admin.role_permissions_changed", "role", r.id, reason=body.reason, role=r.key,
          added=sorted(set(keys) - set(before)), removed=sorted(set(before) - set(keys)))
    db.commit()
    db.expire(r)
    return _role_out(db, r, actor)


# --- Audit log ------------------------------------------------------------------------------------

def _audit_out(db, row: AuditLog, emails: dict[int, str] | None = None) -> AuditLogOut:
    out = AuditLogOut.model_validate(row)
    if row.actor_id is not None:
        out.actor_email = emails.get(row.actor_id) if emails is not None else db.scalar(
            select(User.email).where(User.id == row.actor_id))
    return out


def _day(d: date) -> datetime:
    return datetime.combine(d, time.min).replace(tzinfo=utcnow().tzinfo)


@router.get("/audit-logs", response_model=Page[AuditLogOut], summary="Append-only audit log with filters")
def audit_logs(
    _: Auditor,
    db: DB,
    action: Annotated[str | None, Query(max_length=64, description="Exact action or prefix ending with '.'")] = None,
    actor_id: int | None = None,
    target_type: Annotated[str | None, Query(max_length=48)] = None,
    target_id: int | None = None,
    outcome: AuditOutcome | None = None,
    security_only: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> Page:
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%") if action.endswith(".") else AuditLog.action == action)
    if actor_id is not None:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if target_type:
        stmt = stmt.where(AuditLog.target_type == target_type)
    if target_id is not None:
        stmt = stmt.where(AuditLog.target_id == target_id)
    if outcome:
        stmt = stmt.where(AuditLog.outcome == outcome)
    if security_only:
        stmt = stmt.where(or_(AuditLog.action.in_(SECURITY_ACTIONS), AuditLog.outcome != AuditOutcome.SUCCESS))
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= _day(date_from))
    if date_to:
        stmt = stmt.where(AuditLog.created_at < _day(date_to) + timedelta(days=1))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.scalars(stmt.order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size)))
    ids = {r.actor_id for r in rows if r.actor_id is not None}
    emails = dict(db.execute(select(User.id, User.email).where(User.id.in_(ids))).all()) if ids else {}
    return Page[AuditLogOut](items=[_audit_out(db, r, emails) for r in rows], total=total, page=page,
                             page_size=page_size)


# --- Settings (read-only status; secrets are never returned) --------------------------------------

@router.get("/settings", summary="Configuration status (no secrets)")
def settings_status(_: SettingsViewer) -> dict:
    s = get_settings()
    return {
        "environment": s.environment,
        "app_base_url": s.app_base_url,
        "cors_origins": s.cors_origins,
        "security": {
            "secure_cookies": s.secure_cookies,
            "csrf_protection": True,
            "rate_limiting": s.rate_limit_enabled,
            "max_request_bytes": s.max_request_bytes,
            "session_hours": s.session_hours,
            "remember_me_days": s.remember_me_days,
            "google_sign_in": s.google_enabled,
        },
        "email": {
            "backend": email_service.backend_name(),
            "delivers_email": email_service.backend_name() == "smtp",
            "verification_required": s.require_email_verification,
        },
        "ai": {"provider": s.resolved_ai_provider,
               "model": s.ai_model,
               "configured": not s.use_mock_ai},
        "payments": payments.status(),
        "terms_version": s.terms_version,
    }
