"""“Remember me”, session lifetime, token rotation and reuse detection."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import as_utc, utcnow
from app.core.security import create_access_token
from app.models import AuditLog, UserSession
from tests.conftest import make_user


def _login(client, remember: bool):
    client.cookies.clear()
    return client.post("/api/auth/login", json={"email": "r@example.com", "password": "Secret123",
                                                "remember_me": remember})


def _session_cookie_header(resp) -> str:
    name = get_settings().auth_cookie_name
    return next(h for h in resp.headers.get_list("set-cookie") if h.startswith(f"{name}="))


def test_without_remember_me_the_cookie_ends_with_the_browser_and_the_session_is_short(client, db):
    make_user(db, "r@example.com")
    r = _login(client, remember=False)
    assert r.status_code == 200
    header = _session_cookie_header(r).lower()
    assert "expires=" not in header and "max-age" not in header
    assert "httponly" in header and "samesite=lax" in header
    sess = db.scalar(select(UserSession))
    assert sess.remember is False
    hours = (as_utc(sess.expires_at) - utcnow()).total_seconds() / 3600
    assert get_settings().session_hours - 1 < hours <= get_settings().session_hours


def test_remember_me_issues_a_persistent_cookie_and_a_30_day_session(client, db):
    make_user(db, "r@example.com")
    r = _login(client, remember=True)
    assert r.status_code == 200
    assert "expires=" in _session_cookie_header(r).lower()
    sess = db.scalar(select(UserSession))
    assert sess.remember is True
    days = (as_utc(sess.expires_at) - utcnow()).total_seconds() / 86400
    assert get_settings().remember_me_days - 1 < days <= get_settings().remember_me_days
    # The password is never stored in a cookie, and the token is not readable by scripts.
    assert "Secret123" not in str(r.headers) and "httponly" in _session_cookie_header(r).lower()


def test_expired_session_is_rejected(client, db):
    make_user(db, "r@example.com")
    _login(client, remember=True)
    sess = db.scalar(select(UserSession))
    sess.expires_at = utcnow() - timedelta(minutes=1)
    db.commit()
    assert client.get("/api/auth/me").status_code == 401


def test_logout_revokes_a_remembered_session(client, db):
    make_user(db, "r@example.com")
    _login(client, remember=True)
    token = client.cookies.get(get_settings().auth_cookie_name)
    assert client.post("/api/auth/logout").status_code == 200
    client.cookies.clear()
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_cookie_token_is_rotated_and_an_old_token_is_detected_as_reuse(client, db, monkeypatch):
    make_user(db, "r@example.com")
    _login(client, remember=True)
    name = get_settings().auth_cookie_name
    first = client.cookies.get(name)
    monkeypatch.setattr(get_settings(), "token_rotate_minutes", -1)  # every request rotates
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    second = client.cookies.get(name)
    assert second and second != first
    db.expire_all()
    assert db.scalar(select(UserSession)).token_version == 1

    # Rotate once more: version 0 is now two versions old → reuse → the whole session is revoked.
    assert client.get("/api/auth/me").status_code == 200
    client.cookies.set(name, first)
    r = client.get("/api/auth/me")
    assert r.status_code == 401 and r.json()["error"]["code"] == "SESSION_REVOKED"
    db.expire_all()
    sess = db.scalar(select(UserSession))
    assert sess.revoked_at is not None
    assert db.scalar(select(AuditLog).where(AuditLog.action == "auth.token_reuse_detected")) is not None


def test_previous_token_is_accepted_during_the_grace_period(client, db, monkeypatch):
    make_user(db, "r@example.com")
    _login(client, remember=False)
    name = get_settings().auth_cookie_name
    first = client.cookies.get(name)
    monkeypatch.setattr(get_settings(), "token_rotate_minutes", -1)
    assert client.get("/api/auth/me").status_code == 200
    monkeypatch.setattr(get_settings(), "token_rotate_minutes", 60)
    client.cookies.set(name, first)  # a parallel request still carrying the previous token
    assert client.get("/api/auth/me").status_code == 200


def test_bearer_token_with_a_future_version_is_rejected(client, db):
    u = make_user(db, "r@example.com")
    _login(client, remember=False)
    sess = db.scalar(select(UserSession))
    forged = create_access_token(u.id, sess.id, sess.expires_at, version=5)
    client.cookies.clear()
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
