"""Plans, entitlements, subscriptions and the payment-webhook idempotency log.

Payment card data is never stored here. A payment provider (when configured) owns billing details; Isker keeps
only the provider's opaque reference and the resulting subscription state.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.content_i18n import Translatable
from app.core.database import Base, TimestampMixin, utcnow
from app.models.enums import BillingInterval, SubscriptionSource, SubscriptionStatus, db_enum


class SubscriptionPlan(Translatable, TimestampMixin, Base):
    __tablename__ = "subscription_plans"
    __translatable__ = ("name", "description")
    __table_args__ = (CheckConstraint("price_cents >= 0", name="price_non_negative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(48), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(Text)
    price_cents: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    billing_interval: Mapped[BillingInterval] = mapped_column(
        db_enum(BillingInterval, "billing_interval"), default=BillingInterval.MONTH
    )
    trial_days: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # The plan every user without a current subscription falls back to. Exactly one should be default.
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    entitlements: Mapped[list[PlanEntitlement]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="PlanEntitlement.feature_key"
    )


class PlanEntitlement(Base):
    """A feature switch or limit for a plan. `limit_value = NULL` with `enabled` means unlimited."""

    __tablename__ = "plan_entitlements"
    __table_args__ = (
        UniqueConstraint("plan_id", "feature_key"),
        CheckConstraint("limit_value IS NULL OR limit_value >= 0", name="limit_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("subscription_plans.id", ondelete="CASCADE"), index=True)
    feature_key: Mapped[str] = mapped_column(String(64))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    limit_value: Mapped[int | None] = mapped_column(Integer)


class UserSubscription(TimestampMixin, Base):
    __tablename__ = "user_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("subscription_plans.id", ondelete="RESTRICT"), index=True)
    status: Mapped[SubscriptionStatus] = mapped_column(db_enum(SubscriptionStatus, "subscription_status"), index=True)
    source: Mapped[SubscriptionSource] = mapped_column(db_enum(SubscriptionSource, "subscription_source"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    provider: Mapped[str | None] = mapped_column(String(32))
    provider_reference: Mapped[str | None] = mapped_column(String(128), index=True)
    note: Mapped[str | None] = mapped_column(String(500))

    plan: Mapped[SubscriptionPlan] = relationship(lazy="joined")


class SubscriptionEvent(Base):
    """Immutable history of every subscription change (who, what, why, from where)."""

    __tablename__ = "subscription_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    subscription_id: Mapped[int] = mapped_column(ForeignKey("user_subscriptions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(48))
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str | None] = mapped_column(String(32))
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("subscription_plans.id", ondelete="SET NULL"))
    actor_id: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str | None] = mapped_column(String(500))
    details: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class PaymentWebhookEvent(Base):
    """Idempotency log for provider webhooks: a provider event id is processed at most once."""

    __tablename__ = "payment_webhook_events"
    __table_args__ = (UniqueConstraint("provider", "event_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(32))
    event_id: Mapped[str] = mapped_column(String(128))
    event_type: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))  # processed | ignored | failed
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    error: Mapped[str | None] = mapped_column(String(500))
