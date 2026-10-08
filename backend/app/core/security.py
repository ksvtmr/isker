"""Password hashing (bcrypt) and JWT access tokens."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.core.config import get_settings


def hash_password(password: str) -> str:
    # bcrypt only considers the first 72 bytes; validation limits passwords to 128 chars.
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode()[:72], password_hash.encode())
    except ValueError:
        return False


def create_access_token(user_id: int, role: str) -> tuple[str, str, datetime]:
    s = get_settings()
    jti = uuid.uuid4().hex
    exp = datetime.now(UTC) + timedelta(minutes=s.jwt_expires_minutes)
    token = jwt.encode(
        {"sub": str(user_id), "role": role, "jti": jti, "exp": exp, "iat": datetime.now(UTC)},
        s.jwt_secret,
        algorithm=s.jwt_algorithm,
    )
    return token, jti, exp


def decode_token(token: str) -> dict:
    s = get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm], options={"require": ["exp", "sub"]})
