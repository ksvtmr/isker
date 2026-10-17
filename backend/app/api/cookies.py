"""Session and CSRF cookies.

- `isker_session`: httpOnly, SameSite=Lax, Secure in production. Without "Remember me" it has no expiry (removed when
  the browser closes); with "Remember me" it lasts as long as the server-side session.
- `isker_csrf`: readable by the SPA, echoed in X-CSRF-Token (double-submit). Same lifetime as the session cookie.
"""

from __future__ import annotations

from fastapi import Response

from app.core.config import get_settings
from app.core.database import as_utc
from app.core.security import new_csrf_token
from app.models import UserSession


def _expires(sess: UserSession):
    return as_utc(sess.expires_at) if sess.remember else None


def set_session_cookie(response: Response, token: str, sess: UserSession) -> None:
    s = get_settings()
    response.set_cookie(s.auth_cookie_name, token, httponly=True, secure=s.secure_cookies, samesite="lax", path="/",
                        expires=_expires(sess))


def set_auth_cookies(response: Response, token: str, sess: UserSession) -> None:
    s = get_settings()
    set_session_cookie(response, token, sess)
    response.set_cookie(s.csrf_cookie_name, new_csrf_token(), httponly=False, secure=s.secure_cookies, samesite="lax",
                        path="/", expires=_expires(sess))


def clear_auth_cookies(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(s.auth_cookie_name, path="/")
    response.delete_cookie(s.csrf_cookie_name, path="/")
