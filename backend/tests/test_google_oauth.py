"""“Continue with Google”: state/nonce/PKCE handling, ID-token verification, account creation and safe linking.

Google itself is replaced by a local RSA key: the token endpoint is mocked to return an ID token signed with it,
and the JWKS lookup returns its public half. Everything else (state cookie, stored state, signature, issuer,
audience, expiry and nonce checks) runs for real.
"""

from __future__ import annotations

import time
from urllib.parse import parse_qs, urlparse

import pytest
from authlib.jose import JsonWebKey, KeySet, jwt
from sqlalchemy import select

from app.core.config import get_settings
from app.models import OAuthIdentity, User, UserSession
from app.models.enums import AccountStatus
from app.services import google_oidc as google
from tests.conftest import login, make_user

CLIENT_ID = "test-client.apps.googleusercontent.com"
KEY = JsonWebKey.generate_key("RSA", 2048, is_private=True, options={"kid": "test-key"})
OTHER_KEY = JsonWebKey.generate_key("RSA", 2048, is_private=True, options={"kid": "test-key"})


@pytest.fixture(autouse=True)
def google_configured(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", CLIENT_ID)
    monkeypatch.setattr(s, "google_client_secret", "test-secret")
    monkeypatch.setattr(google, "google_keys", lambda: KeySet([JsonWebKey.import_key(KEY.as_dict(is_private=False))]))


def _id_token(nonce: str, *, sub="g-123", email="new@example.com", verified=True, aud=CLIENT_ID,
              iss="https://accounts.google.com", key=KEY, exp_in=600, name="New Person") -> str:
    now = int(time.time())
    claims = {"iss": iss, "aud": aud, "sub": sub, "email": email, "email_verified": verified, "name": name,
              "iat": now, "exp": now + exp_in, "nonce": nonce}
    return jwt.encode({"alg": "RS256", "kid": "test-key"}, claims, key).decode()


def _start(client, path="/api/auth/google/start?remember=true"):
    r = client.get(path, follow_redirects=False)
    assert r.status_code == 302, r.text
    q = parse_qs(urlparse(r.headers["location"]).query)
    return r, q["state"][0], q["nonce"][0], q


def _callback(client, monkeypatch, state, token_or_none, code="auth-code"):
    monkeypatch.setattr(google, "exchange_code", lambda c, v: {"id_token": token_or_none} if token_or_none else {})
    return client.get(f"/api/auth/google/callback?code={code}&state={state}", follow_redirects=False)


def _error(resp) -> str | None:
    q = parse_qs(urlparse(resp.headers["location"]).query)
    return q.get("oauth_error", [None])[0]


def test_providers_reports_google_only_when_configured(client, monkeypatch):
    assert client.get("/api/auth/providers").json() == {"password": True, "google": True}
    monkeypatch.setattr(get_settings(), "google_client_id", "")
    assert client.get("/api/auth/providers").json()["google"] is False
    r = client.get("/api/auth/google/start", follow_redirects=False)
    assert r.status_code == 302 and _error(r) == "GOOGLE_NOT_CONFIGURED"


def test_authorization_request_uses_state_nonce_and_pkce(client):
    r, state, nonce, q = _start(client)
    assert r.headers["location"].startswith(google.AUTHORIZE_URL)
    assert q["client_id"] == [CLIENT_ID] and q["code_challenge_method"] == ["S256"] and q["code_challenge"]
    assert "openid" in q["scope"][0] and len(state) > 30 and len(nonce) > 30
    cookie = next(h for h in r.headers.get_list("set-cookie") if h.startswith(google.STATE_COOKIE))
    assert "httponly" in cookie.lower() and "path=/api/auth/google" in cookie.lower()
    assert "test-secret" not in r.headers["location"]  # the client secret never reaches the browser


def test_new_verified_google_user_gets_an_account_with_the_user_role_only(client, db, monkeypatch):
    _, state, nonce, _ = _start(client)
    r = _callback(client, monkeypatch, state, _id_token(nonce))
    assert r.status_code == 302 and r.headers["location"] == "/onboarding"
    me = client.get("/api/auth/me").json()
    assert me["email"] == "new@example.com" and me["roles"] == ["user"]
    assert me["google_linked"] is True and me["has_password"] is False and me["email_verified"] is True
    assert not any(p.startswith("admin") for p in me["permissions"])
    sess = db.scalar(select(UserSession))
    assert sess.remember is True and sess.auth_method == "google"


def test_returning_google_user_signs_into_the_same_account(client, db, monkeypatch):
    _, state, nonce, _ = _start(client)
    _callback(client, monkeypatch, state, _id_token(nonce))
    client.cookies.clear()
    _, state, nonce, _ = _start(client)
    # Email changed at Google: the stable subject still identifies the same account.
    r = _callback(client, monkeypatch, state, _id_token(nonce, email="renamed@example.com"))
    assert r.status_code == 302 and _error(r) is None
    assert db.scalar(select(User).where(User.email == "new@example.com")) is not None
    assert len(db.scalars(select(User)).all()) == 1


def test_unverified_google_email_is_refused(client, db, monkeypatch):
    _, state, nonce, _ = _start(client)
    r = _callback(client, monkeypatch, state, _id_token(nonce, verified=False))
    assert _error(r) == "OAUTH_EMAIL_UNVERIFIED"
    assert db.scalar(select(User)) is None


def test_existing_email_is_not_linked_automatically(client, db, monkeypatch):
    make_user(db, "owner@example.com")
    _, state, nonce, _ = _start(client)
    r = _callback(client, monkeypatch, state, _id_token(nonce, email="owner@example.com"))
    assert _error(r) == "OAUTH_ACCOUNT_EXISTS"
    assert db.scalar(select(OAuthIdentity)) is None
    assert client.get("/api/auth/me").status_code == 401


def test_admin_cannot_be_reached_or_created_through_google(client, db, monkeypatch):
    make_user(db, "admin@example.com", roles=("user", "super_admin"))
    _, state, nonce, _ = _start(client)
    r = _callback(client, monkeypatch, state, _id_token(nonce, email="admin@example.com"))
    assert _error(r) == "OAUTH_ACCOUNT_EXISTS"


@pytest.mark.parametrize("bad", [
    {"aud": "someone-else"},
    {"iss": "https://evil.example.com"},
    {"key": OTHER_KEY},
    {"exp_in": -3600},
])
def test_invalid_id_tokens_are_rejected(client, db, monkeypatch, bad):
    _, state, nonce, _ = _start(client)
    r = _callback(client, monkeypatch, state, _id_token(nonce, **bad))
    assert _error(r) == "OAUTH_FAILED"
    assert db.scalar(select(User)) is None


def test_wrong_nonce_is_rejected(client, db, monkeypatch):
    _, state, _, _ = _start(client)
    r = _callback(client, monkeypatch, state, _id_token("not-the-nonce"))
    assert _error(r) == "OAUTH_FAILED"


def test_state_must_match_the_browser_cookie_and_is_single_use(client, raw_client, monkeypatch):
    _, state, nonce, _ = _start(client)
    # Another browser (no state cookie) cannot complete this login.
    r = _callback(raw_client, monkeypatch, state, _id_token(nonce))
    assert _error(r) == "OAUTH_STATE_INVALID"
    r = _callback(client, monkeypatch, "forged-state", _id_token(nonce))
    assert _error(r) == "OAUTH_STATE_INVALID"
    client.cookies.set(google.STATE_COOKIE, state, path="/api/auth/google")
    assert _error(_callback(client, monkeypatch, state, _id_token(nonce))) is None
    client.cookies.set(google.STATE_COOKIE, state, path="/api/auth/google")
    assert _error(_callback(client, monkeypatch, state, _id_token(nonce))) == "OAUTH_STATE_INVALID"


def test_cancel_on_google_screen(client, monkeypatch):
    _, state, _, _ = _start(client)
    r = client.get(f"/api/auth/google/callback?error=access_denied&state={state}", follow_redirects=False)
    assert _error(r) == "OAUTH_CANCELLED"


def test_external_next_paths_are_ignored():
    assert google.safe_next("https://evil.example.com") is None
    assert google.safe_next("//evil.example.com") is None
    assert google.safe_next("/\\evil") is None
    assert google.safe_next("/learning?x=1") == "/learning?x=1"


def test_signed_in_user_links_and_unlinks_google(client, db, monkeypatch):
    make_user(db, "owner@example.com")
    login(client, "owner@example.com")
    r = client.post("/api/auth/google/link")
    assert r.status_code == 200
    q = parse_qs(urlparse(r.json()["url"]).query)
    r = _callback(client, monkeypatch, q["state"][0], _id_token(q["nonce"][0], email="other@gmail.com"))
    assert r.headers["location"] == "/settings?google=linked"
    assert client.get("/api/auth/me").json()["google_linked"] is True
    assert client.post("/api/auth/google/link").json()["error"]["code"] == "OAUTH_ALREADY_LINKED"

    # Google now signs into this account (matched by subject, not by email).
    client.cookies.clear()
    _, state, nonce, _ = _start(client)
    _callback(client, monkeypatch, state, _id_token(nonce, email="other@gmail.com"))
    assert client.get("/api/auth/me").json()["email"] == "owner@example.com"

    r = client.delete("/api/auth/google")
    assert r.status_code == 200 and r.json()["google_linked"] is False


def test_google_identity_of_another_account_cannot_be_linked(client, db, monkeypatch):
    _, state, nonce, _ = _start(client)
    _callback(client, monkeypatch, state, _id_token(nonce, sub="shared-sub"))
    make_user(db, "second@example.com")
    login(client, "second@example.com")
    q = parse_qs(urlparse(client.post("/api/auth/google/link").json()["url"]).query)
    r = _callback(client, monkeypatch, q["state"][0], _id_token(q["nonce"][0], sub="shared-sub"))
    assert _error(r) == "OAUTH_ALREADY_LINKED"


def test_google_only_account_cannot_unlink_its_last_sign_in_method(client, monkeypatch):
    _, state, nonce, _ = _start(client)
    _callback(client, monkeypatch, state, _id_token(nonce))
    r = client.delete("/api/auth/google")
    assert r.status_code == 409 and r.json()["error"]["code"] == "CANNOT_UNLINK_LAST_METHOD"


def test_google_only_account_can_set_a_password_right_after_signing_in(client, monkeypatch):
    _, state, nonce, _ = _start(client)
    _callback(client, monkeypatch, state, _id_token(nonce))
    r = client.post("/api/auth/set-password", json={"new_password": "NewSecret123"})
    assert r.status_code == 200, r.text
    assert client.get("/api/auth/me").json()["has_password"] is True
    r = client.post("/api/auth/set-password", json={"new_password": "Another123"})
    assert r.json()["error"]["code"] == "PASSWORD_ALREADY_SET"


def test_google_login_is_refused_for_a_suspended_account(client, db, monkeypatch):
    _, state, nonce, _ = _start(client)
    _callback(client, monkeypatch, state, _id_token(nonce))
    u = db.scalar(select(User))
    u.status = AccountStatus.SUSPENDED
    db.commit()
    client.cookies.clear()
    _, state, nonce, _ = _start(client)
    assert _error(_callback(client, monkeypatch, state, _id_token(nonce))) == "ACCOUNT_SUSPENDED"


def test_failures_are_audited_without_tokens(client, db, monkeypatch):
    from app.models import AuditLog

    _, state, nonce, _ = _start(client)
    token = _id_token(nonce, aud="someone-else")
    _callback(client, monkeypatch, state, token)
    rows = db.scalars(select(AuditLog).where(AuditLog.action == "auth.oauth_failed")).all()
    assert rows and all(token not in str(r.details) and "auth-code" not in str(r.details) for r in rows)
