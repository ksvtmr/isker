from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.enums import BillingInterval, SubscriptionSource, SubscriptionStatus
from app.schemas.common import ORM


class EntitlementOut(BaseModel):
    key: str
    label: str
    description: str
    kind: str
    enabled: bool
    limit: int | None
    used: int | None
    remaining: int | None
    window_days: int | None


class PlanEntitlementOut(ORM):
    feature_key: str
    enabled: bool
    limit_value: int | None


class PlanOut(ORM):
    id: int
    key: str
    name: str
    description: str | None
    price_cents: int
    currency: str
    billing_interval: BillingInterval
    trial_days: int
    is_active: bool
    is_default: bool
    sort_order: int
    entitlements: list[PlanEntitlementOut]


class PlanAdminOut(PlanOut):
    subscriber_count: int = 0
    lock_version: int
    translations: dict | None = None


class PlanEntitlementIn(BaseModel):
    feature_key: str = Field(max_length=64)
    enabled: bool = True
    limit_value: int | None = Field(default=None, ge=0, le=100_000)


class PlanIn(BaseModel):
    key: str = Field(min_length=2, max_length=48, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=1000)
    price_cents: int = Field(ge=0, le=10_000_000)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    billing_interval: BillingInterval = BillingInterval.MONTH
    trial_days: int = Field(default=0, ge=0, le=365)
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=1000)
    entitlements: list[PlanEntitlementIn] = Field(default_factory=list)
    translations: dict[str, dict] | None = None


class PlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=1000)
    price_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    billing_interval: BillingInterval | None = None
    trial_days: int | None = Field(default=None, ge=0, le=365)
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1000)
    entitlements: list[PlanEntitlementIn] | None = None
    # {"ru": {"name": "…", "description": "…"}, "kk": {…}}
    translations: dict[str, dict] | None = None
    # The lock_version the editor loaded; a stale value is refused with 409 VERSION_CONFLICT.
    expected_version: int | None = Field(default=None, ge=1)
    reason: str = Field(min_length=3, max_length=500)


class SubscriptionOut(ORM):
    id: int
    user_id: int
    plan: PlanOut
    status: SubscriptionStatus
    source: SubscriptionSource
    started_at: datetime
    expires_at: datetime | None
    cancel_at_period_end: bool
    canceled_at: datetime | None
    ended_at: datetime | None
    created_by_id: int | None
    provider: str | None
    note: str | None


class SubscriptionAdminOut(SubscriptionOut):
    user_email: str | None = None
    user_name: str | None = None


class SubscriptionEventOut(ORM):
    id: int
    subscription_id: int
    user_id: int
    event_type: str
    from_status: str | None
    to_status: str | None
    plan_id: int | None
    actor_id: int | None
    source: str
    reason: str | None
    details: dict | None
    created_at: datetime


class MySubscriptionOut(BaseModel):
    plan: PlanOut
    subscription: SubscriptionOut | None
    entitlements: list[EntitlementOut]
    history: list[SubscriptionEventOut]
    payments: dict


class _Reason(BaseModel):
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 3:
            raise ValueError("Please give a reason (at least 3 characters).")
        return v


class AssignSubscriptionIn(_Reason):
    plan_key: str = Field(max_length=48)
    days: int | None = Field(default=None, ge=1, le=3660, description="Time-limited grant; omit for no end date")
    expires_at: datetime | None = None
    status: SubscriptionStatus = SubscriptionStatus.ACTIVE


class ExtendSubscriptionIn(_Reason):
    days: int | None = Field(default=None, ge=1, le=3660)
    until: datetime | None = None


class CancelSubscriptionIn(_Reason):
    at_period_end: bool = False


class SubscriptionStatusIn(_Reason):
    status: SubscriptionStatus
