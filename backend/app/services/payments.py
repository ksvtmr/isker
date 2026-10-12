"""Payment provider abstraction.

No commercial payment provider is integrated in this repository. Paid plans can be granted by an administrator
(source = admin) and the system is ready to receive provider webhooks through a provider-neutral, signed format:

    POST /api/billing/webhooks/{provider}
    Header  X-Isker-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
    Body    {"id": "evt_123", "type": "subscription.activated",
             "data": {"user_id": 1, "plan_key": "pro", "reference": "sub_abc", "expires_at": "2026-12-01T00:00:00Z"}}

Rules
- The provider must equal PAYMENT_PROVIDER and PAYMENT_WEBHOOK_SECRET must be set; otherwise webhooks are refused
  (503 PAYMENTS_NOT_CONFIGURED). Nothing is ever marked as paid without a verified event.
- Signatures are verified in constant time with a 5-minute timestamp tolerance (replay protection).
- Each (provider, event id) is processed once; repeats return the stored outcome (idempotency).
- No card data is accepted or stored: events carry only references to the provider's own objects.
An adapter for a specific provider (e.g. Stripe) maps its native events to this format.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, AuthenticationError, ValidationError
from app.models import PaymentWebhookEvent, SubscriptionPlan, User, UserSubscription
from app.models.enums import SubscriptionSource, SubscriptionStatus
from app.services import subscriptions as subs
from app.services.audit import audit

TOLERANCE_SECONDS = 300
SUPPORTED = {"subscription.activated", "subscription.renewed", "subscription.past_due", "subscription.canceled",
             "subscription.expired"}


class PaymentsNotConfigured(AppError):
    status_code = 503
    code = "PAYMENTS_NOT_CONFIGURED"


def is_configured() -> bool:
    s = get_settings()
    return bool(s.payment_provider and s.payment_webhook_secret)


def status() -> dict:
    s = get_settings()
    return {"provider": s.payment_provider or None, "configured": is_configured(),
            "checkout_available": False,
            "note": "No payment provider is integrated. Paid plans are granted by administrators; signed provider "
                    "webhooks are accepted once PAYMENT_PROVIDER and PAYMENT_WEBHOOK_SECRET are set."}


def sign(secret: str, body: bytes, timestamp: int) -> str:
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={mac}"


def verify_signature(provider: str, body: bytes, header: str | None, now: float | None = None) -> None:
    s = get_settings()
    if not is_configured() or provider != s.payment_provider:
        raise PaymentsNotConfigured("Payment webhooks are not configured for this provider.")
    if not header:
        raise AuthenticationError("Missing webhook signature.", "INVALID_SIGNATURE")
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    try:
        ts = int(parts.get("t", ""))
    except ValueError as e:
        raise AuthenticationError("Malformed webhook signature.", "INVALID_SIGNATURE") from e
    if abs((now or time.time()) - ts) > TOLERANCE_SECONDS:
        raise AuthenticationError("Webhook timestamp is outside the allowed window.", "INVALID_SIGNATURE")
    expected = sign(s.payment_webhook_secret, body, ts).split("v1=", 1)[1]
    if not hmac.compare_digest(expected, parts.get("v1", "")):
        raise AuthenticationError("Webhook signature does not match.", "INVALID_SIGNATURE")


def _by_reference(db: Session, provider: str, ref: str) -> UserSubscription | None:
    return db.scalar(select(UserSubscription).where(UserSubscription.provider == provider,
                                                    UserSubscription.provider_reference == ref)
                     .order_by(UserSubscription.id.desc()))


def _parse_dt(v: object) -> datetime | None:
    if v in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError as e:
        raise ValidationError("Invalid expires_at in webhook payload.", "INVALID_PAYLOAD") from e


def _apply(db: Session, provider: str, etype: str, data: dict) -> str:
    ref = str(data.get("reference") or "")
    if not ref:
        raise ValidationError("Webhook payload has no subscription reference.", "INVALID_PAYLOAD")
    src = SubscriptionSource.PAYMENT
    if etype == "subscription.activated":
        user = db.get(User, int(data.get("user_id") or 0))
        plan = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.key == str(data.get("plan_key") or "")))
        if user is None or plan is None:
            raise ValidationError("Unknown user or plan in webhook payload.", "INVALID_PAYLOAD")
        existing = _by_reference(db, provider, ref)
        if existing is not None and existing.status in subs.CURRENT:
            return "ignored"
        new = subs.assign(db, user_id=user.id, plan=plan, actor_id=None, source=src,
                          reason=f"Payment provider {provider}", expires_at=_parse_dt(data.get("expires_at")),
                          provider=provider, provider_reference=ref)
        audit(db, None, "subscription.activated_by_payment", "subscription", new.id, user_id=user.id,
              plan=plan.key, provider=provider)
        return "processed"
    sub = _by_reference(db, provider, ref)
    if sub is None:
        raise ValidationError("No subscription matches this reference.", "UNKNOWN_REFERENCE")
    subs.apply_expiry(db, sub)
    if etype == "subscription.renewed":
        new_end = _parse_dt(data.get("expires_at"))
        if new_end is None:
            raise ValidationError("Renewal events need expires_at.", "INVALID_PAYLOAD")
        if sub.status == SubscriptionStatus.PAST_DUE:
            subs.transition(db, sub, SubscriptionStatus.ACTIVE, actor_id=None, source=src.value,
                            reason="Payment succeeded")
        prev = sub.expires_at
        sub.expires_at = new_end
        subs.record(db, sub, "renewed", actor_id=None, source=src.value, from_status=sub.status.value,
                    previous_expires_at=prev.isoformat() if prev else None, expires_at=new_end.isoformat())
    elif etype == "subscription.past_due":
        subs.transition(db, sub, SubscriptionStatus.PAST_DUE, actor_id=None, source=src.value,
                        reason="Payment failed")
    elif etype == "subscription.canceled":
        subs.cancel(db, sub, at_period_end=bool(data.get("at_period_end")) and sub.expires_at is not None,
                    actor_id=None, reason="Canceled at the payment provider", source=src)
    elif etype == "subscription.expired":
        subs.transition(db, sub, SubscriptionStatus.EXPIRED, actor_id=None, source=src.value,
                        reason="Expired at the payment provider")
    audit(db, None, f"{etype}_by_payment", "subscription", sub.id, user_id=sub.user_id, provider=provider)
    return "processed"


def handle_webhook(db: Session, provider: str, payload: dict) -> tuple[str, bool]:
    """Process a verified event once. Returns (status, duplicate)."""
    event_id, etype = str(payload.get("id") or ""), str(payload.get("type") or "")
    if not event_id or len(event_id) > 128 or not etype:
        raise ValidationError("Webhook payload needs id and type.", "INVALID_PAYLOAD")
    seen = db.scalar(select(PaymentWebhookEvent).where(PaymentWebhookEvent.provider == provider,
                                                       PaymentWebhookEvent.event_id == event_id))
    if seen is not None:
        return seen.status, True
    if etype not in SUPPORTED:
        result = "ignored"
    else:
        data = payload.get("data")
        if not isinstance(data, dict):
            raise ValidationError("Webhook payload needs a data object.", "INVALID_PAYLOAD")
        result = _apply(db, provider, etype, data)
    db.add(PaymentWebhookEvent(provider=provider, event_id=event_id, event_type=etype[:64], status=result))
    try:
        db.commit()
    except IntegrityError:  # a concurrent delivery of the same event won the race
        db.rollback()
        return "processed", True
    return result, False
