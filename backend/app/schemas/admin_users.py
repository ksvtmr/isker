from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.enums import AccountStatus, AttemptScope, AttemptStatus, AuditOutcome, SubscriptionStatus
from app.schemas.billing import SubscriptionEventOut, SubscriptionOut
from app.schemas.common import ORM


class AdminUserRow(BaseModel):
    id: int
    email: str
    full_name: str
    status: AccountStatus
    roles: list[str]
    plan_key: str
    plan_name: str
    subscription_status: SubscriptionStatus | None
    email_verified: bool
    onboarding_completed: bool
    created_at: datetime
    last_login_at: datetime | None
    last_seen_at: datetime | None
    completed_attempts: int
    latest_overall: int | None


class AdminSessionOut(ORM):
    id: str
    created_at: datetime
    last_seen_at: datetime | None
    expires_at: datetime
    user_agent: str | None


class AdminAttemptOut(ORM):
    id: int
    scope: AttemptScope
    status: AttemptStatus
    started_at: datetime
    completed_at: datetime | None
    overall_score: int | None
    sequence: int


class AdminCompetencyScoreOut(BaseModel):
    code: str
    name: str
    score: int
    level: str | None
    measured_at: datetime


class AuditLogOut(ORM):
    id: int
    actor_id: int | None
    actor_email: str | None = None
    action: str
    target_type: str | None
    target_id: int | None
    outcome: AuditOutcome
    reason: str | None
    request_id: str | None
    ip_address: str | None
    details: dict | None
    created_at: datetime


class AdminUserDetail(BaseModel):
    id: int
    email: str
    full_name: str
    status: AccountStatus
    status_reason: str | None
    status_changed_at: datetime | None
    deletion_requested_at: datetime | None
    roles: list[str]
    permissions: list[str]
    email_verified_at: datetime | None
    terms_accepted_at: datetime | None
    terms_version: str | None
    onboarding_completed: bool
    created_at: datetime
    last_login_at: datetime | None
    last_seen_at: datetime | None
    profile: dict | None
    goals: list[str]
    attempts: list[AdminAttemptOut]
    competencies: list[AdminCompetencyScoreOut]
    learning: dict
    practice: dict
    plan_key: str
    plan_name: str
    subscription: SubscriptionOut | None
    subscription_history: list[SubscriptionEventOut]
    sessions: list[AdminSessionOut]
    audit_events: list[AuditLogOut] | None = Field(description="Null when the viewer lacks audit.view")
    can_manage: bool
    can_assign_roles: bool
    can_delete: bool


def _reason(v: str) -> str:
    v = " ".join(v.split())
    if len(v) < 3:
        raise ValueError("Please give a reason (at least 3 characters).")
    return v


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def _r(cls, v: str) -> str:
        return _reason(v)


class AdminUserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: str | None = Field(default=None, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def _r(cls, v: str) -> str:
        return _reason(v)

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str | None) -> str | None:
        return v.strip().lower() if v else v

    @field_validator("full_name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return " ".join(v.split()) if v else v


class RoleAssignIn(ReasonIn):
    role_key: str = Field(max_length=48)


class DeleteUserIn(ReasonIn):
    confirm_email: str = Field(max_length=255)


class ActionResult(BaseModel):
    message: str
    delivered: bool | None = None
    backend: str | None = None
    revoked_sessions: int | None = None
