"""Sessions, email verification and password reset."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.context import client_ip_var, user_agent_var
from app.core.database import as_utc, utcnow
from app.core.errors import ValidationError
from app.models import EmailVerificationToken, PasswordResetToken, User, UserSession
from app.services import email as email_service


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- Sessions -------------------------------------------------------------------------------------


def create_session(db: Session, user: User) -> UserSession:
    s = get_settings()
    sess = UserSession(
        id=uuid.uuid4().hex,
        user_id=user.id,
        expires_at=utcnow() + timedelta(minutes=s.jwt_expires_minutes),
        user_agent=user_agent_var.get(),
        ip_address=client_ip_var.get(),
    )
    db.add(sess)
    db.flush()
    return sess


def session_is_valid(sess: UserSession | None) -> bool:
    return sess is not None and sess.revoked_at is None and as_utc(sess.expires_at) > utcnow()


def revoke_session(db: Session, sess: UserSession, reason: str) -> None:
    if sess.revoked_at is None:
        sess.revoked_at, sess.revoked_reason = utcnow(), reason


def revoke_all_sessions(db: Session, user_id: int, reason: str, except_id: str | None = None) -> int:
    q = update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    if except_id:
        q = q.where(UserSession.id != except_id)
    result = db.execute(q.values(revoked_at=utcnow(), revoked_reason=reason))
    return int(getattr(result, "rowcount", 0) or 0)


def active_sessions(db: Session, user_id: int) -> list[UserSession]:
    return [
        s
        for s in db.scalars(
            select(UserSession)
            .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
            .order_by(UserSession.last_seen_at.desc())
        )
        if session_is_valid(s)
    ]


# --- Email verification ---------------------------------------------------------------------------


def start_email_verification(db: Session, user: User) -> email_service.DeliveryResult:
    s = get_settings()
    db.execute(
        update(EmailVerificationToken)
        .where(EmailVerificationToken.user_id == user.id, EmailVerificationToken.used_at.is_(None))
        .values(used_at=utcnow())
    )
    raw = secrets.token_urlsafe(32)
    db.add(
        EmailVerificationToken(
            user_id=user.id,
            token_hash=_hash(raw),
            email=user.email,
            expires_at=utcnow() + timedelta(hours=s.verification_token_hours),
        )
    )
    db.flush()
    link = f"{s.app_base_url.rstrip('/')}/verify-email?token={raw}"
    return email_service.send(
        user.email,
        "Confirm your email for Isker",
        f"Hi {user.full_name},\n\nConfirm your email address to secure your Isker account:\n{link}\n\n"
        f"The link expires in {s.verification_token_hours} hours. If you didn't create an account, "
        "ignore this message.",
    )


def verify_email(db: Session, raw: str) -> User:
    tok = db.scalar(select(EmailVerificationToken).where(EmailVerificationToken.token_hash == _hash(raw)))
    if tok is None or tok.used_at is not None or as_utc(tok.expires_at) <= utcnow():
        raise ValidationError("This verification link is invalid or has expired. Request a new one.", "INVALID_TOKEN")
    user = db.get(User, tok.user_id)
    if user is None or user.email != tok.email:
        raise ValidationError("This verification link is no longer valid.", "INVALID_TOKEN")
    tok.used_at = utcnow()
    user.email_verified_at = user.email_verified_at or utcnow()
    return user


# --- Password reset -------------------------------------------------------------------------------


def start_password_reset(db: Session, user: User, requested_by_id: int | None = None) -> email_service.DeliveryResult:
    s = get_settings()
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=utcnow())
    )
    raw = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=_hash(raw),
            requested_by_id=requested_by_id,
            expires_at=utcnow() + timedelta(minutes=s.reset_token_minutes),
        )
    )
    db.flush()
    link = f"{s.app_base_url.rstrip('/')}/reset-password?token={raw}"
    return email_service.send(
        user.email,
        "Reset your Isker password",
        f"Hi {user.full_name},\n\nUse this link to choose a new password:\n{link}\n\n"
        f"The link expires in {s.reset_token_minutes} minutes and works once. If you didn't ask "
        "for this, you can ignore this message — your password stays the same.",
    )


def consume_reset_token(db: Session, raw: str) -> User:
    tok = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == _hash(raw)))
    if tok is None or tok.used_at is not None or as_utc(tok.expires_at) <= utcnow():
        raise ValidationError("This reset link is invalid or has expired. Request a new one.", "INVALID_TOKEN")
    user = db.get(User, tok.user_id)
    if user is None:
        raise ValidationError("This reset link is no longer valid.", "INVALID_TOKEN")
    tok.used_at = utcnow()
    return user


def touch_last_seen(db: Session, user: User, sess: UserSession | None, now: datetime) -> bool:
    """Update last-seen at most every 5 minutes (keeps writes low). Returns True if something changed."""
    stale = user.last_seen_at is None or (now - as_utc(user.last_seen_at)) > timedelta(minutes=5)
    if stale:
        user.last_seen_at = now
        if sess is not None:
            sess.last_seen_at = now
    return stale
