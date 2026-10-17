"""“Continue with Google”: start, callback, link and unlink. See app/services/google_oidc.py for the security model."""

from __future__ import annotations

from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.cookies import set_auth_cookies
from app.api.deps import DB, Auth, CurrentUser
from app.api.routes.auth import user_out
from app.core.config import get_settings
from app.core.context import language_var
from app.core.database import utcnow
from app.core.errors import AppError, ConflictError
from app.core.ratelimit import enforce
from app.core.security import create_access_token
from app.models import OAuthIdentity, User, UserProfile
from app.models.enums import AccountStatus
from app.schemas.auth import UserOut
from app.schemas.common import ERROR_RESPONSES
from app.services import accounts, maintenance
from app.services import google_oidc as google
from app.services.audit import audit, audit_now
from app.services.permissions import DEFAULT_ROLE, give_role, has_permission

router = APIRouter(prefix="/api/auth", tags=["auth"], responses=ERROR_RESPONSES)
PROVIDER = "google"


def _state_cookie(response, state: str) -> None:
    s = get_settings()
    response.set_cookie(google.STATE_COOKIE, state, httponly=True, secure=s.secure_cookies, samesite="lax",
                        max_age=int(google.STATE_TTL.total_seconds()), path="/api/auth/google")


def _fail(code: str, path: str = "/login") -> RedirectResponse:
    resp = RedirectResponse(f"{path}?{urlencode({'oauth_error': code})}", status_code=302)
    resp.delete_cookie(google.STATE_COOKIE, path="/api/auth/google")
    return resp


@router.get("/providers", summary="Which sign-in methods this server offers")
def providers() -> dict:
    return {"password": True, "google": get_settings().google_enabled}


@router.get("/google/start", summary="Start “Continue with Google” (redirects to Google)",
            responses={302: {"description": "Redirect to Google, or back to /login with oauth_error"}})
def google_start(db: DB, next: Annotated[str | None, Query(max_length=255)] = None,  # noqa: A002
                 remember: bool = False) -> RedirectResponse:
    from app.core.context import client_ip_var

    if not get_settings().google_enabled:
        return _fail("GOOGLE_NOT_CONFIGURED")
    # Each start stores an OAuthState row: rate-limit per IP and purge expired rows now and then.
    try:
        enforce("oauth_ip", client_ip_var.get())
    except AppError as e:
        return _fail(e.code)
    maintenance.maybe_purge()
    url, state = google.start(db, mode="login", user_id=None, next_path=google.safe_next(next), remember=remember,
                              language=language_var.get())
    db.commit()
    resp = RedirectResponse(url, status_code=302)
    _state_cookie(resp, state)
    return resp


@router.post("/google/link", summary="Start linking Google to the signed-in account (returns the Google URL)")
def google_link_start(auth: Auth, db: DB) -> JSONResponse:
    google.require_configured()
    accounts.assert_not_demo(auth.user)
    if any(i.provider == PROVIDER for i in auth.user.oauth_identities):
        raise ConflictError("Google is already linked to this account.", "OAUTH_ALREADY_LINKED")
    url, state = google.start(db, mode="link", user_id=auth.user.id, next_path="/settings",
                              remember=auth.session.remember, language=language_var.get())
    db.commit()
    resp = JSONResponse({"url": url})
    _state_cookie(resp, state)
    return resp


@router.delete("/google", response_model=UserOut, summary="Unlink Google (only if the account keeps a password)")
def google_unlink(user: CurrentUser, db: DB) -> UserOut:
    accounts.assert_not_demo(user)
    ident = next((i for i in user.oauth_identities if i.provider == PROVIDER), None)
    if ident is None:
        raise ConflictError("Google is not linked to this account.", "OAUTH_NOT_LINKED")
    if not user.password_hash:
        raise ConflictError("Set a password before removing your only sign-in method.", "CANNOT_UNLINK_LAST_METHOD")
    user.oauth_identities.remove(ident)
    audit(db, user.id, "auth.oauth_unlinked", "user", user.id, provider=PROVIDER)
    db.commit()
    db.refresh(user)
    return user_out(user)


def _home(user: User, next_path: str | None) -> str:
    if next_path:
        return next_path
    if has_permission(user, "admin.access"):
        return "/admin"
    return "/dashboard" if user.onboarding_completed else "/onboarding"


@router.get("/google/callback", include_in_schema=True, summary="Google redirects here after consent",
            responses={302: {"description": "Signed in (or linked) and redirected into the app"}})
def google_callback(request: Request, db: DB, code: str | None = None, state: str | None = None,
                    error: str | None = None) -> RedirectResponse:
    from app.core.context import client_ip_var

    enforce("oauth_ip", client_ip_var.get())
    cookie_state = request.cookies.get(google.STATE_COOKIE)
    if error:
        # The user cancelled on Google's screen (or Google refused). Consume the state if it is ours.
        try:
            google.consume_state(db, state, cookie_state)
            db.commit()
        except AppError:
            db.rollback()
        return _fail("OAUTH_CANCELLED")
    try:
        req = google.consume_state(db, state, cookie_state)
        db.commit()  # single use even if the rest fails
        if not code:
            raise google.OAuthError("Missing code.")
        tokens = google.exchange_code(code, req.code_verifier)
        id_token = tokens.get("id_token")
        if not isinstance(id_token, str):
            raise google.OAuthError("No ID token.")
        ident = google.verify_id_token(id_token, req.nonce)
    except AppError as e:
        db.rollback()
        # Never log tokens or codes: only the error code.
        audit_now(None, "auth.oauth_failed", None, None, outcome="failure", reason=e.code, provider=PROVIDER)
        return _fail(e.code)

    existing = db.scalar(select(OAuthIdentity).where(OAuthIdentity.provider == PROVIDER,
                                                     OAuthIdentity.subject == ident.subject))
    if req.mode == "link":
        user = db.get(User, req.user_id) if req.user_id else None
        if user is None or user.status != AccountStatus.ACTIVE:
            return _fail("OAUTH_FAILED", "/settings")
        if accounts.is_demo_account(user):
            return _fail("DEMO_ACCOUNT_READ_ONLY", "/settings")
        if existing is not None and existing.user_id != user.id:
            audit(db, user.id, "auth.oauth_link_conflict", "user", user.id, outcome="denied", provider=PROVIDER)
            db.commit()
            return _fail("OAUTH_ALREADY_LINKED", "/settings")
        if existing is None:
            db.add(OAuthIdentity(user_id=user.id, provider=PROVIDER, subject=ident.subject, email=ident.email,
                                 last_used_at=utcnow()))
        audit(db, user.id, "auth.oauth_linked", "user", user.id, provider=PROVIDER)
        try:
            db.commit()
        except IntegrityError:
            # A concurrent callback linked this Google account (or another one to this user) first.
            db.rollback()
            audit_now(user.id, "auth.oauth_link_conflict", "user", user.id, outcome="denied", provider=PROVIDER)
            return _fail("OAUTH_ALREADY_LINKED", "/settings")
        return RedirectResponse("/settings?google=linked", status_code=302)

    created = False
    if existing is not None:
        user = db.get(User, existing.user_id)
        existing.last_used_at = utcnow()
    else:
        if not ident.email or not ident.email_verified:
            audit_now(None, "auth.oauth_failed", None, None, outcome="denied", reason="email not verified",
                      provider=PROVIDER)
            return _fail("OAUTH_EMAIL_UNVERIFIED")
        if db.scalar(select(User.id).where(User.email == ident.email)) is not None:
            # Same email, different sign-in method: the owner must sign in and link Google from Settings.
            audit_now(None, "auth.oauth_failed", None, None, outcome="denied", reason="email belongs to an account",
                      provider=PROVIDER)
            return _fail("OAUTH_ACCOUNT_EXISTS")
        now = utcnow()
        name = " ".join((ident.name or ident.email.split("@")[0]).split())[:120] or "Isker user"
        user = User(email=ident.email, password_hash="", full_name=name if len(name) >= 2 else "Isker user",
                    email_verified_at=now, terms_accepted_at=now, terms_version=get_settings().terms_version,
                    last_login_at=now)
        user.profile = UserProfile(language=req.language)
        db.add(user)
        try:
            db.flush()
            give_role(db, user, DEFAULT_ROLE)  # never an elevated role
            db.add(OAuthIdentity(user_id=user.id, provider=PROVIDER, subject=ident.subject, email=ident.email,
                                 last_used_at=now))
            db.flush()
        except IntegrityError:
            # A concurrent callback created the same account: use it instead of creating a duplicate.
            db.rollback()
            existing = db.scalar(select(OAuthIdentity).where(OAuthIdentity.provider == PROVIDER,
                                                             OAuthIdentity.subject == ident.subject))
            if existing is None:
                return _fail("OAUTH_FAILED")
            user = db.get(User, existing.user_id)
        else:
            created = True
    if user is None:
        return _fail("OAUTH_FAILED")
    if user.status != AccountStatus.ACTIVE:
        code = "ACCOUNT_SUSPENDED" if user.status == AccountStatus.SUSPENDED else "ACCOUNT_DEACTIVATED"
        audit(db, user.id, "auth.login_blocked", "user", user.id, outcome="denied", reason=user.status.value)
        db.commit()
        return _fail(code)
    accounts.record_login(db, user)
    sess = accounts.create_session(db, user, remember=req.remember, method=PROVIDER)
    audit(db, user.id, "auth.register" if created else "auth.login", "user", user.id, method=PROVIDER,
          remember=req.remember)
    db.commit()
    resp = RedirectResponse(_home(user, req.next_path), status_code=302)
    set_auth_cookies(resp, create_access_token(user.id, sess.id, sess.expires_at, sess.token_version), sess)
    resp.delete_cookie(google.STATE_COOKIE, path="/api/auth/google")
    return resp

