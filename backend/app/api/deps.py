"""Authentication middleware-style dependencies.

The JWT is accepted from the httpOnly session cookie (browser) or `Authorization: Bearer` (API clients).
"""

from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AuthenticationError, AuthorizationError
from app.core.security import decode_token
from app.models import RevokedToken, User
from app.models.enums import UserRole

bearer = HTTPBearer(auto_error=False, description="JWT from /api/auth/login (or the session cookie)")

DB = Annotated[Session, Depends(get_db)]


def token_from_request(request: Request, creds: HTTPAuthorizationCredentials | None) -> str | None:
    if creds and creds.scheme.lower() == "bearer":
        return creds.credentials
    return request.cookies.get(get_settings().auth_cookie_name)


def get_token_claims(
    request: Request, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)], db: DB
) -> dict:
    token = token_from_request(request, creds)
    if not token:
        raise AuthenticationError("Please sign in to continue.")
    try:
        claims = decode_token(token)
    except jwt.ExpiredSignatureError as e:
        raise AuthenticationError("Your session has expired. Please sign in again.", "SESSION_EXPIRED") from e
    except jwt.PyJWTError as e:
        raise AuthenticationError("Invalid session. Please sign in again.", "INVALID_TOKEN") from e
    if claims.get("jti") and db.get(RevokedToken, claims["jti"]) is not None:
        raise AuthenticationError("You have signed out. Please sign in again.", "SESSION_REVOKED")
    return claims


def get_current_user(claims: Annotated[dict, Depends(get_token_claims)], db: DB) -> User:
    try:
        user = db.get(User, int(claims["sub"]))
    except (TypeError, ValueError) as e:
        raise AuthenticationError("Invalid session.", "INVALID_TOKEN") from e
    if user is None or not user.is_active:
        raise AuthenticationError("Your account is not available.", "ACCOUNT_INACTIVE")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role != UserRole.ADMIN:
        raise AuthorizationError("Administrator access is required.")
    return user


AdminUser = Annotated[User, Depends(require_admin)]
