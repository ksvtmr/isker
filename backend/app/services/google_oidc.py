"""Google sign-in with OpenID Connect (authorization-code flow + PKCE), built on Authlib.

Security properties (see docs/authentication.md and docs/google-oauth-setup.md):
- `state` (CSRF): random, single use, expires in 10 minutes, stored hashed in `oauth_states` AND bound to the
  browser by an httpOnly cookie; the callback requires both to match.
- `nonce`: sent in the authorization request and required in the ID token (replay protection).
- PKCE (S256) protects the authorization code.
- The ID token is verified with Google's published keys: signature, issuer, audience (our client id), expiry,
  issued-at and nonce. Nothing the browser sends about the user (email, id) is trusted.
- Identity key = Google's stable `sub`. Email is only used to create a new account and only if Google says it is
  verified. An existing Isker account is never linked automatically because the email matches.
- Google never grants roles: new accounts get the default `user` role only.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, cast

import httpx
from authlib.integrations.httpx_client import OAuth2Client
from authlib.jose import JsonWebKey, jwt
from authlib.jose.errors import JoseError
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import as_utc, utcnow
from app.core.errors import AppError
from app.models import OAuthState

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
STATE_TTL = timedelta(minutes=10)
STATE_COOKIE = "isker_oauth_state"
GOOGLE_LOCALES = {"ru": "ru", "kk": "kk", "en": "en"}


class OAuthError(AppError):
    status_code = 400
    code = "OAUTH_FAILED"


class GoogleNotConfigured(AppError):
    status_code = 503
    code = "GOOGLE_NOT_CONFIGURED"


@dataclass
class GoogleIdentity:
    subject: str
    email: str | None
    email_verified: bool
    name: str | None


def _hash(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()


def require_configured() -> None:
    if not get_settings().google_enabled:
        raise GoogleNotConfigured("Google sign-in is not configured on this server.")


def _client() -> OAuth2Client:
    s = get_settings()
    return OAuth2Client(client_id=s.google_client_id, client_secret=s.google_client_secret,
                        redirect_uri=s.google_callback_url, scope="openid email profile",
                        code_challenge_method="S256", timeout=10)


def start(db: Session, *, mode: str, user_id: int | None, next_path: str | None, remember: bool,
          language: str) -> tuple[str, str]:
    """Create a single-use OAuth request. Returns (authorization_url, raw_state for the browser cookie)."""
    require_configured()
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)[:96]
    db.add(OAuthState(state_hash=_hash(state), nonce=nonce, code_verifier=verifier, mode=mode, user_id=user_id,
                      next_path=next_path, remember=remember, language=language, expires_at=utcnow() + STATE_TTL))
    url, _ = _client().create_authorization_url(
        AUTHORIZE_URL, state=state, nonce=nonce, code_verifier=verifier, prompt="select_account",
        hl=GOOGLE_LOCALES.get(language, "ru"),
    )
    return url, state


def consume_state(db: Session, state: str | None, cookie_state: str | None) -> OAuthState:
    """Validate state against the browser-bound cookie and the stored single-use record."""
    if not state or not cookie_state or not secrets.compare_digest(state, cookie_state):
        raise OAuthError("State mismatch.", "OAUTH_STATE_INVALID")
    now = utcnow()
    # Single use, atomically: only the request whose conditional UPDATE marks the row wins; a concurrent replay of
    # the same callback updates nothing (on PostgreSQL it waits for the winner and then sees used_at set).
    claimed = db.execute(
        update(OAuthState)
        .where(OAuthState.state_hash == _hash(state), OAuthState.used_at.is_(None), OAuthState.expires_at > now)
        .values(used_at=now)
        .execution_options(synchronize_session=False)
    )
    row = db.scalar(select(OAuthState).where(OAuthState.state_hash == _hash(state)))
    if cast(CursorResult, claimed).rowcount != 1 or row is None:
        raise OAuthError("Unknown, used or expired state.", "OAUTH_STATE_INVALID")
    db.refresh(row)
    if row.used_at is None or as_utc(row.expires_at) <= now:  # pragma: no cover - defensive
        raise OAuthError("Unknown, used or expired state.", "OAUTH_STATE_INVALID")
    return row


def exchange_code(code: str, code_verifier: str) -> dict[str, Any]:
    """Exchange the authorization code for tokens (server to server; the client secret never leaves the backend)."""
    try:
        return dict(_client().fetch_token(TOKEN_URL, code=code, code_verifier=code_verifier,
                                          grant_type="authorization_code"))
    except Exception as e:  # noqa: BLE001 - provider/network errors are reported generically, without tokens
        raise OAuthError(f"Token exchange failed ({type(e).__name__}).") from e


_jwks_cache: dict[str, Any] = {"keys": None, "at": 0.0}


def google_keys() -> Any:
    """Google's signing keys, cached for an hour."""
    if _jwks_cache["keys"] is None or time.time() - _jwks_cache["at"] > 3600:
        resp = httpx.get(JWKS_URL, timeout=10)
        resp.raise_for_status()
        _jwks_cache["keys"] = JsonWebKey.import_key_set(resp.json())
        _jwks_cache["at"] = time.time()
    return _jwks_cache["keys"]


def verify_id_token(id_token: str, nonce: str, keys: Any | None = None) -> GoogleIdentity:
    s = get_settings()
    try:
        claims = jwt.decode(id_token, keys if keys is not None else google_keys(), claims_options={
            "iss": {"essential": True, "values": ISSUERS},
            "aud": {"essential": True, "value": s.google_client_id},
            "sub": {"essential": True},
            "exp": {"essential": True},
            "iat": {"essential": True},
            "nonce": {"essential": True, "value": nonce},
        })
        claims.validate(leeway=60)
    except (JoseError, ValueError) as e:
        raise OAuthError(f"Invalid ID token ({type(e).__name__}).") from e
    email = claims.get("email")
    return GoogleIdentity(subject=str(claims["sub"]), email=email.lower() if isinstance(email, str) else None,
                          email_verified=claims.get("email_verified") is True, name=claims.get("name"))


def safe_next(path: str | None) -> str | None:
    """Only same-site relative paths are allowed as post-login destinations (no open redirects)."""
    if path and path.startswith("/") and not path.startswith("//") and "\\" not in path and len(path) <= 255:
        return path
    return None
