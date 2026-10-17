"""Sessions, email verification and password reset."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.core.config import get_settings
from app.core.context import client_ip_var, user_agent_var
from app.core.database import as_utc, utcnow
from app.core.errors import AuthorizationError, ValidationError
from app.models import EmailVerificationToken, PasswordResetToken, User, UserSession
from app.services import email as email_service
from app.services import email_templates


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- Public demo account ----------------------------------------------------------------------------


def is_demo_account(user: User) -> bool:
    """The seeded public demo account (DEMO_EMAIL; its password is published in the README / render.yaml).

    It is identified by the configured DEMO_EMAIL while the demo is enabled (SEED_DEMO) and DEMO_READ_ONLY is on.
    """
    s = get_settings()
    return bool(s.seed_demo and s.demo_read_only and s.demo_email and user.email == s.demo_email.strip().lower())


def assert_not_demo(user: User) -> None:
    """Anyone can sign in to the demo account, so its credentials and status can't be changed through it."""
    if is_demo_account(user):
        raise AuthorizationError("The demo account is shared and can't be changed. Create your own account to do this.",
                                 "DEMO_ACCOUNT_READ_ONLY")


# --- Sessions -------------------------------------------------------------------------------------


def session_lifetime(remember: bool) -> timedelta:
    s = get_settings()
    return timedelta(days=s.remember_me_days) if remember else timedelta(hours=s.session_hours)


def create_session(db: Session, user: User, *, remember: bool = False, method: str = "password") -> UserSession:
    sess = UserSession(
        id=secrets.token_hex(32),
        user_id=user.id,
        expires_at=utcnow() + session_lifetime(remember),
        user_agent=user_agent_var.get(),
        ip_address=client_ip_var.get(),
        remember=remember,
        token_version=0,
        auth_method=method,
    )
    db.add(sess)
    db.flush()
    return sess


ROTATION_GRACE_SECONDS = 60


def check_token_version(db: Session, sess: UserSession, version: int) -> bool:
    """True if the presented token version is acceptable.

    The current version is always accepted; the previous one only for a short grace period after a rotation
    (parallel requests in flight). Anything older means a superseded token was replayed: the session is revoked.
    """
    if version == sess.token_version:
        return True
    rotated = as_utc(sess.rotated_at) if sess.rotated_at else None
    if version == sess.token_version - 1 and rotated and (utcnow() - rotated).total_seconds() < ROTATION_GRACE_SECONDS:
        return True
    revoke_session(db, sess, "token_reuse")
    return False


def needs_rotation(sess: UserSession, issued_at: datetime) -> bool:
    age = utcnow() - as_utc(issued_at)
    return age > timedelta(minutes=get_settings().token_rotate_minutes) and sess.revoked_at is None


def rotate(sess: UserSession) -> None:
    sess.token_version += 1
    sess.rotated_at = utcnow()


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
    subject, text = email_templates.render("verify_email", email_templates.email_language(user), name=user.full_name,
                                           link=link, hours=s.verification_token_hours)
    return email_service.send(user.email, subject, text)


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
    subject, text = email_templates.render("reset_password", email_templates.email_language(user), name=user.full_name,
                                           link=link, minutes=s.reset_token_minutes)
    return email_service.send(user.email, subject, text)


def invalidate_pending_tokens(db: Session, user_id: int) -> int:
    """Mark every unused password-reset and email-verification token of the user as used (e.g. after an email
    change: links sent to the old address must stop working). Returns the number of tokens invalidated."""
    n = 0
    for model in (PasswordResetToken, EmailVerificationToken):
        result = db.execute(update(model).where(model.user_id == user_id, model.used_at.is_(None))
                            .values(used_at=utcnow()).execution_options(synchronize_session=False))
        n += int(getattr(result, "rowcount", 0) or 0)
    return n


def consume_reset_token(db: Session, raw: str) -> User:
    tok = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == _hash(raw)))
    if tok is None or tok.used_at is not None or as_utc(tok.expires_at) <= utcnow():
        raise ValidationError("This reset link is invalid or has expired. Request a new one.", "INVALID_TOKEN")
    user = db.get(User, tok.user_id)
    if user is None:
        raise ValidationError("This reset link is no longer valid.", "INVALID_TOKEN")
    tok.used_at = utcnow()
    return user


def _write_activity(db: Session, user: User, **values: datetime) -> None:
    """Activity timestamps bypass optimistic locking: a plain UPDATE that neither checks nor bumps lock_version."""
    db.execute(update(User).where(User.id == user.id).values(**values).execution_options(synchronize_session=False))
    for k, v in values.items():
        set_committed_value(user, k, v)


def record_login(db: Session, user: User) -> None:
    _write_activity(db, user, last_login_at=utcnow())


def touch_last_seen(db: Session, user: User, sess: UserSession | None, now: datetime) -> bool:
    """Update last-seen at most every 5 minutes (keeps writes low). Returns True if something changed."""
    stale = user.last_seen_at is None or (now - as_utc(user.last_seen_at)) > timedelta(minutes=5)
    if stale:
        _write_activity(db, user, last_seen_at=now)
        if sess is not None:
            sess.last_seen_at = now
    return stale
