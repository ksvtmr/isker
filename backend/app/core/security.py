"""Password hashing (bcrypt), JWT access tokens bound to server-side sessions, CSRF tokens."""

from __future__ import annotations

import hmac
import secrets
from datetime import UTC, datetime

import bcrypt
import jwt

from app.core.config import get_settings

# Used to equalise login timing for unknown emails (prevents account enumeration by response time).
_DUMMY_HASH = bcrypt.hashpw(b"isker-timing-equaliser", bcrypt.gensalt(rounds=12)).decode()


def hash_password(password: str) -> str:
    # bcrypt only considers the first 72 bytes; validation limits passwords to 128 chars.
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return bcrypt.checkpw(password.encode()[:72], (password_hash or _DUMMY_HASH).encode()) and bool(password_hash)
    except ValueError:
        return False


def create_access_token(user_id: int, session_id: str, expires_at: datetime) -> str:
    s = get_settings()
    return jwt.encode({"sub": str(user_id), "jti": session_id, "exp": expires_at, "iat": datetime.now(UTC)},
                      s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_token(token: str) -> dict:
    s = get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm], options={"require": ["exp", "sub", "jti"]})


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def csrf_matches(cookie_value: str | None, header_value: str | None) -> bool:
    if not cookie_value or not header_value:
        return False
    return hmac.compare_digest(cookie_value.encode(), header_value.encode())
