from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import select

from app.api.deps import DB, Auth, CurrentUser
from app.core.config import get_settings
from app.core.context import client_ip_var
from app.core.database import utcnow
from app.core.errors import AuthenticationError, ConflictError, NotFoundError
from app.core.ratelimit import enforce
from app.core.security import create_access_token, hash_password, new_csrf_token, verify_password
from app.core.security import decode_token as _decode
from app.models import User, UserProfile, UserSession
from app.models.enums import AccountStatus
from app.schemas.auth import (
    AuthOut,
    ChangePasswordIn,
    EmailIn,
    LoginIn,
    PasswordConfirmIn,
    RegisterIn,
    ResetPasswordIn,
    SessionOut,
    TokenIn,
    UserOut,
)
from app.schemas.common import ERROR_RESPONSES, Message
from app.services import accounts
from app.services import email as email_service
from app.services.audit import audit, audit_now
from app.services.permissions import DEFAULT_ROLE, give_role, user_permissions

router = APIRouter(prefix="/api/auth", tags=["auth"], responses=ERROR_RESPONSES)

GENERIC_RESET = Message(message="If an account exists for this email, we've sent a password reset link.")


def user_out(user: User) -> UserOut:
    return UserOut(id=user.id, email=user.email, full_name=user.full_name, status=user.status, roles=user.role_keys,
                   permissions=sorted(user_permissions(user)), onboarding_completed=user.onboarding_completed,
                   email_verified=user.email_verified_at is not None, created_at=user.created_at)


def _set_cookies(response: Response, token: str, expires: datetime) -> None:
    s = get_settings()
    response.set_cookie(s.auth_cookie_name, token, httponly=True, secure=s.secure_cookies, samesite="lax",
                        expires=expires, path="/")
    # Double-submit CSRF token: readable by the SPA, which echoes it in X-CSRF-Token.
    response.set_cookie(s.csrf_cookie_name, new_csrf_token(), httponly=False, secure=s.secure_cookies,
                        samesite="lax", expires=expires, path="/")


def _clear_cookies(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(s.auth_cookie_name, path="/")
    response.delete_cookie(s.csrf_cookie_name, path="/")


def _issue(db, response: Response, user: User, verification: str) -> AuthOut:
    sess = accounts.create_session(db, user)
    token = create_access_token(user.id, sess.id, sess.expires_at)
    _set_cookies(response, token, sess.expires_at)
    return AuthOut(user=user_out(user), access_token=token, expires_at=sess.expires_at,
                   email_verification=verification)


def _verification_state(result: email_service.DeliveryResult | None) -> str:
    if result is None:
        return "unavailable"
    return "sent" if result.delivered else ("logged" if result.backend == "console" else "unavailable")


@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED,
             summary="Create an account (terms required) and start a session")
def register(body: RegisterIn, response: Response, db: DB) -> AuthOut:
    enforce("register_ip", client_ip_var.get())
    if db.scalar(select(User.id).where(User.email == body.email)) is not None:
        raise ConflictError("An account with this email already exists. Sign in or reset your password.",
                            "EMAIL_TAKEN")
    s = get_settings()
    now = utcnow()
    user = User(email=body.email, password_hash=hash_password(body.password), full_name=body.full_name,
                last_login_at=now, terms_accepted_at=now, terms_version=s.terms_version)
    user.profile = UserProfile()
    db.add(user)
    db.flush()
    give_role(db, user, DEFAULT_ROLE)
    result = accounts.start_email_verification(db, user) if email_service.is_available() else None
    audit(db, user.id, "auth.register", "user", user.id, email_verification=_verification_state(result))
    out = _issue(db, response, user, _verification_state(result))
    db.commit()
    return out


@router.post("/login", response_model=AuthOut, summary="Sign in with email and password")
def login(body: LoginIn, response: Response, db: DB) -> AuthOut:
    enforce("login_ip", client_ip_var.get())
    enforce("login_email", body.email)
    user = db.scalar(select(User).where(User.email == body.email))
    # Always run bcrypt (dummy hash for unknown emails) so timing doesn't reveal which emails exist.
    ok = verify_password(body.password, user.password_hash if user else None)
    if user is None or not ok:
        audit_now(user.id if user else None, "auth.login_failed", "user", user.id if user else None,
                  reason="unknown email" if user is None else "wrong password")
        raise AuthenticationError("Email or password is incorrect.", "INVALID_CREDENTIALS")
    if user.status == AccountStatus.SUSPENDED:
        audit_now(user.id, "auth.login_blocked", "user", user.id, outcome="denied", reason="suspended")
        raise AuthenticationError("This account is suspended. Contact support if you think this is a mistake.",
                                  "ACCOUNT_SUSPENDED")
    if user.status == AccountStatus.DEACTIVATED:
        audit_now(user.id, "auth.login_blocked", "user", user.id, outcome="denied", reason="deactivated")
        raise AuthenticationError("This account has been closed. Contact support to restore it.",
                                  "ACCOUNT_DEACTIVATED")
    if get_settings().require_email_verification and user.email_verified_at is None:
        raise AuthenticationError("Confirm your email address before signing in. Check your inbox for the link.",
                                  "EMAIL_NOT_VERIFIED")
    user.last_login_at = utcnow()
    audit(db, user.id, "auth.login", "user", user.id)
    out = _issue(db, response, user, "verified" if user.email_verified_at else "not_verified")
    db.commit()
    return out


@router.post("/logout", response_model=Message, summary="Sign out and revoke this session")
def logout(request: Request, response: Response, db: DB) -> Message:
    token = request.cookies.get(get_settings().auth_cookie_name)
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:]
    if token:
        try:
            claims = _decode(token)
            sess = db.get(UserSession, claims["jti"])
            if sess is not None and sess.revoked_at is None:
                accounts.revoke_session(db, sess, "logout")
                audit(db, sess.user_id, "auth.logout", "user", sess.user_id)
                db.commit()
        except Exception:  # noqa: BLE001 - logout must always succeed and clear cookies
            db.rollback()
    _clear_cookies(response)
    return Message(message="Signed out")


@router.get("/me", response_model=UserOut, summary="Current user, roles and permissions")
def me(user: CurrentUser) -> UserOut:
    return user_out(user)


@router.post("/password", response_model=Message, summary="Change password (signs out other sessions)")
def change_password(body: ChangePasswordIn, auth: Auth, db: DB) -> Message:
    enforce("password_change_user", str(auth.user.id))
    if not verify_password(body.current_password, auth.user.password_hash):
        audit_now(auth.user.id, "auth.password_change_failed", "user", auth.user.id)
        raise AuthenticationError("Current password is incorrect.", "INVALID_CREDENTIALS")
    auth.user.password_hash = hash_password(body.new_password)
    n = accounts.revoke_all_sessions(db, auth.user.id, "password_changed", except_id=auth.session.id)
    audit(db, auth.user.id, "auth.password_changed", "user", auth.user.id, other_sessions_revoked=n)
    db.commit()
    return Message(message="Password updated. Other devices have been signed out.")


@router.post("/forgot-password", response_model=Message, status_code=status.HTTP_202_ACCEPTED,
             summary="Request a password reset link (same response whether or not the email exists)")
def forgot_password(body: EmailIn, db: DB) -> Message:
    enforce("forgot_ip", client_ip_var.get())
    enforce("forgot_email", body.email)
    user = db.scalar(select(User).where(User.email == body.email))
    if user is not None and user.status == AccountStatus.ACTIVE and email_service.is_available():
        result = accounts.start_password_reset(db, user)
        audit(db, user.id, "auth.password_reset_requested", "user", user.id, delivery=_verification_state(result))
        db.commit()
    elif user is not None:
        audit_now(user.id, "auth.password_reset_requested", "user", user.id, outcome="failure",
                  reason="email unavailable" if user.status == AccountStatus.ACTIVE else f"account {user.status.value}")
    if not email_service.is_available():
        # Honest answer that doesn't depend on whether the account exists.
        return Message(message="Password reset by email is not available on this server. Contact support.")
    return GENERIC_RESET


@router.post("/reset-password", response_model=Message, summary="Set a new password with a reset token")
def reset_password(body: ResetPasswordIn, db: DB) -> Message:
    enforce("reset_ip", client_ip_var.get())
    user = accounts.consume_reset_token(db, body.token)
    user.password_hash = hash_password(body.new_password)
    n = accounts.revoke_all_sessions(db, user.id, "password_reset")
    audit(db, user.id, "auth.password_reset", "user", user.id, sessions_revoked=n)
    db.commit()
    return Message(message="Your password has been changed. Sign in with your new password.")


@router.post("/verify-email", response_model=Message, summary="Confirm an email address with a token")
def verify_email(body: TokenIn, db: DB) -> Message:
    enforce("verify_ip", client_ip_var.get())
    user = accounts.verify_email(db, body.token)
    audit(db, user.id, "auth.email_verified", "user", user.id)
    db.commit()
    return Message(message="Email confirmed. Thank you!")


@router.post("/resend-verification", response_model=Message, summary="Send the verification email again")
def resend_verification(user: CurrentUser, db: DB) -> Message:
    enforce("resend_user", str(user.id))
    if user.email_verified_at is not None:
        return Message(message="Your email is already confirmed.")
    if not email_service.is_available():
        raise ConflictError("Email delivery is not configured on this server.", "EMAIL_UNAVAILABLE")
    result = accounts.start_email_verification(db, user)
    audit(db, user.id, "auth.verification_resent", "user", user.id, delivery=_verification_state(result))
    db.commit()
    if result.delivered:
        return Message(message=f"We've sent a new confirmation link to {user.email}.")
    if result.backend == "console":
        return Message(message="Development mode: the confirmation link was written to the server log.")
    raise ConflictError("We couldn't send the email. Please try again later.", "EMAIL_DELIVERY_FAILED")


@router.get("/sessions", response_model=list[SessionOut], summary="Your active sessions (devices)")
def list_sessions(auth: Auth, db: DB) -> list[SessionOut]:
    return [SessionOut(id=s.id, created_at=s.created_at, last_seen_at=s.last_seen_at, expires_at=s.expires_at,
                       user_agent=s.user_agent, ip_address=s.ip_address, current=s.id == auth.session.id)
            for s in accounts.active_sessions(db, auth.user.id)]


@router.delete("/sessions/{session_id}", response_model=Message, summary="Sign out one of your sessions")
def revoke_session(session_id: str, auth: Auth, db: DB) -> Message:
    sess = db.get(UserSession, session_id)
    if sess is None or sess.user_id != auth.user.id:  # never reveal other users' sessions
        raise NotFoundError("Session not found", "SESSION_NOT_FOUND")
    accounts.revoke_session(db, sess, "user_revoked")
    audit(db, auth.user.id, "auth.session_revoked", "user", auth.user.id)
    db.commit()
    return Message(message="Session signed out")


@router.post("/sessions/revoke-others", response_model=Message, summary="Sign out all other sessions")
def revoke_others(auth: Auth, db: DB) -> Message:
    n = accounts.revoke_all_sessions(db, auth.user.id, "user_revoked_others", except_id=auth.session.id)
    audit(db, auth.user.id, "auth.sessions_revoked", "user", auth.user.id, count=n)
    db.commit()
    return Message(message=f"Signed out {n} other session{'s' if n != 1 else ''}.")


@router.post("/deactivate", response_model=Message, summary="Close your account (reversible by support)")
def deactivate(body: PasswordConfirmIn, auth: Auth, response: Response, db: DB) -> Message:
    from app.services.permissions import assert_keeps_a_super_admin

    if not verify_password(body.password, auth.user.password_hash):
        raise AuthenticationError("Password is incorrect.", "INVALID_CREDENTIALS")
    assert_keeps_a_super_admin(db, auth.user, deactivating=True)
    now = utcnow()
    auth.user.status, auth.user.status_changed_at = AccountStatus.DEACTIVATED, now
    auth.user.status_reason, auth.user.deletion_requested_at = "Closed by the account owner", now
    accounts.revoke_all_sessions(db, auth.user.id, "account_closed")
    audit(db, auth.user.id, "user.self_deactivated", "user", auth.user.id)
    db.commit()
    _clear_cookies(response)
    return Message(message="Your account has been closed and you have been signed out.")
