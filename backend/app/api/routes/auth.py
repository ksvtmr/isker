from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import delete, select

from app.api.deps import DB, CurrentUser, bearer, get_token_claims
from app.core.config import get_settings
from app.core.database import utcnow
from app.core.errors import AuthenticationError, ConflictError
from app.core.security import create_access_token, hash_password, verify_password
from app.models import RevokedToken, User, UserProfile
from app.schemas.auth import AuthOut, ChangePasswordIn, LoginIn, RegisterIn, UserOut
from app.schemas.common import ERROR_RESPONSES, Message
from app.services.audit import audit

router = APIRouter(prefix="/api/auth", tags=["auth"], responses=ERROR_RESPONSES)


def _set_cookie(response: Response, token: str, expires: datetime) -> None:
    s = get_settings()
    response.set_cookie(
        s.auth_cookie_name,
        token,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        expires=expires,
        path="/",
    )


def _issue(response: Response, user: User) -> AuthOut:
    token, _, exp = create_access_token(user.id, user.role.value)
    _set_cookie(response, token, exp)
    return AuthOut(user=UserOut.model_validate(user), access_token=token, expires_at=exp)


@router.post(
    "/register",
    response_model=AuthOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account and start a session",
)
def register(body: RegisterIn, response: Response, db: DB) -> AuthOut:
    if db.scalar(select(User.id).where(User.email == body.email)) is not None:
        raise ConflictError("An account with this email already exists.", "EMAIL_TAKEN")
    user = User(
        email=body.email, password_hash=hash_password(body.password), full_name=body.full_name, last_login_at=utcnow()
    )
    user.profile = UserProfile()
    db.add(user)
    db.flush()
    audit(db, user.id, "auth.register", "user", user.id)
    db.commit()
    return _issue(response, user)


@router.post("/login", response_model=AuthOut, summary="Sign in with email and password")
def login(body: LoginIn, response: Response, db: DB) -> AuthOut:
    user = db.scalar(select(User).where(User.email == body.email))
    if user is None or not verify_password(body.password, user.password_hash):
        audit(db, user.id if user else None, "auth.login_failed")
        db.commit()
        raise AuthenticationError("Email or password is incorrect.", "INVALID_CREDENTIALS")
    if not user.is_active:
        raise AuthenticationError("Your account is not available.", "ACCOUNT_INACTIVE")
    user.last_login_at = utcnow()
    audit(db, user.id, "auth.login", "user", user.id)
    db.commit()
    return _issue(response, user)


@router.post("/logout", response_model=Message, summary="Sign out and revoke the current token")
def logout(
    request: Request,
    response: Response,
    db: DB,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> Message:
    s = get_settings()
    try:
        claims = get_token_claims(request, creds, db)
    except AuthenticationError:
        claims = None
    if claims and claims.get("jti"):
        db.execute(delete(RevokedToken).where(RevokedToken.expires_at < datetime.now(UTC)))
        if db.get(RevokedToken, claims["jti"]) is None:
            db.add(RevokedToken(jti=claims["jti"], expires_at=datetime.fromtimestamp(claims["exp"], UTC)))
        audit(db, int(claims["sub"]), "auth.logout")
        db.commit()
    response.delete_cookie(s.auth_cookie_name, path="/")
    return Message(message="Signed out")


@router.get("/me", response_model=UserOut, summary="Current user")
def me(user: CurrentUser) -> User:
    return user


@router.post("/password", response_model=Message, summary="Change password")
def change_password(body: ChangePasswordIn, user: CurrentUser, db: DB) -> Message:
    if not verify_password(body.current_password, user.password_hash):
        raise AuthenticationError("Current password is incorrect.", "INVALID_CREDENTIALS")
    user.password_hash = hash_password(body.new_password)
    audit(db, user.id, "auth.password_changed", "user", user.id)
    db.commit()
    return Message(message="Password updated")
