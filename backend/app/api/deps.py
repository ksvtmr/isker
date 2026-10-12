"""Authentication and authorization dependencies.

- The JWT is accepted from the httpOnly session cookie (browser) or `Authorization: Bearer` (API clients).
- Every token is bound to a server-side session row; revoked or expired sessions are rejected.
- Cookie-authenticated unsafe requests must carry `X-CSRF-Token` equal to the `isker_csrf` cookie
  (double-submit). Bearer requests are not exposed to CSRF and are exempt.
- `require_permission("x")` is the only way routes check authorization (see services/permissions.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

import jwt
from fastapi import Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.api.cookies import set_session_cookie
from app.core.config import get_settings
from app.core.database import get_db, utcnow
from app.core.errors import AuthenticationError, AuthorizationError
from app.core.security import create_access_token, csrf_matches, decode_token
from app.models import User, UserSession
from app.models.enums import AccountStatus
from app.services.accounts import check_token_version, needs_rotation, rotate, session_is_valid, touch_last_seen
from app.services.audit import audit_now
from app.services.permissions import has_permission

bearer = HTTPBearer(auto_error=False, description="JWT from /api/auth/login (or the session cookie)")

DB = Annotated[Session, Depends(get_db)]
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


@dataclass
class AuthContext:
    user: User
    session: UserSession
    via_cookie: bool


def token_from_request(request: Request, creds: HTTPAuthorizationCredentials | None) -> tuple[str | None, bool]:
    if creds and creds.scheme.lower() == "bearer":
        return creds.credentials, False
    return request.cookies.get(get_settings().auth_cookie_name), True


def get_auth(
    request: Request, response: Response, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)], db: DB
) -> AuthContext:
    s = get_settings()
    token, via_cookie = token_from_request(request, creds)
    if not token:
        raise AuthenticationError("Please sign in to continue.")
    try:
        claims = decode_token(token)
    except jwt.ExpiredSignatureError as e:
        raise AuthenticationError("Your session has expired. Please sign in again.", "SESSION_EXPIRED") from e
    except jwt.PyJWTError as e:
        raise AuthenticationError("Invalid session. Please sign in again.", "INVALID_TOKEN") from e
    sess = db.get(UserSession, claims["jti"])
    if not session_is_valid(sess):
        raise AuthenticationError("Your session has ended. Please sign in again.", "SESSION_REVOKED")
    assert sess is not None
    version = int(claims.get("ver", 0))
    if via_cookie:
        if not check_token_version(db, sess, version):
            # A superseded token was replayed (e.g. a copied cookie): the whole session is revoked.
            db.commit()
            audit_now(sess.user_id, "auth.token_reuse_detected", "user", sess.user_id, outcome="denied")
            raise AuthenticationError("Your session has ended. Please sign in again.", "SESSION_REVOKED")
    elif version > sess.token_version:
        raise AuthenticationError("Invalid session.", "INVALID_TOKEN")
    try:
        user = db.get(User, int(claims["sub"]))
    except (TypeError, ValueError) as e:
        raise AuthenticationError("Invalid session.", "INVALID_TOKEN") from e
    if user is None or user.id != sess.user_id:
        raise AuthenticationError("Invalid session.", "INVALID_TOKEN")
    if user.status != AccountStatus.ACTIVE:
        raise AuthenticationError("This account is not active. Contact support if you think this is a mistake.",
                                  "ACCOUNT_INACTIVE")
    if via_cookie and request.method in UNSAFE and not request.url.path.endswith("/auth/logout"):
        if not csrf_matches(request.cookies.get(s.csrf_cookie_name), request.headers.get("x-csrf-token")):
            raise AuthorizationError("Security check failed. Reload the page and try again.", "CSRF_FAILED")
    changed = touch_last_seen(db, user, sess, utcnow())
    issued = datetime.fromtimestamp(int(claims.get("iat", 0)), UTC)
    if via_cookie and version == sess.token_version and needs_rotation(sess, issued):
        # Rotation: a fresh token (new `ver`) replaces the cookie; the old one stops working after a short grace.
        rotate(sess)
        set_session_cookie(response, create_access_token(user.id, sess.id, sess.expires_at, sess.token_version), sess)
        changed = True
    if changed:
        db.commit()
    return AuthContext(user=user, session=sess, via_cookie=via_cookie)


Auth = Annotated[AuthContext, Depends(get_auth)]


def get_current_user(auth: Auth) -> User:
    return auth.user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_permission(*permissions: str):
    """Dependency factory: the user must hold ALL listed permissions. Denials are audited."""

    def dep(request: Request, user: CurrentUser) -> User:
        missing = [p for p in permissions if not has_permission(user, p)]
        if missing:
            audit_now(user.id, "access.denied", outcome="denied", path=request.url.path, method=request.method,
                      missing=missing)
            raise AuthorizationError("You don't have permission to do this.", details={"missing": missing})
        return user

    return dep


AdminAccess = Annotated[User, Depends(require_permission("admin.access"))]
