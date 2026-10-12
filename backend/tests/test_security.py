"""Auth lifecycle and HTTP hardening: CSRF, sessions, password reset, verification, rate limits, headers, sizes."""

import re

import pytest

from app.core.config import get_settings
from app.models import AuditLog, PasswordResetToken, User
from tests.conftest import login, make_user, register


@pytest.fixture
def outbox(monkeypatch):
    """Capture emails (the console backend never claims delivery)."""
    sent: list[dict] = []
    from app.services import email as email_service

    def fake_send(to, subject, text):
        sent.append({"to": to, "subject": subject, "text": text})
        return email_service.DeliveryResult("console", False)

    monkeypatch.setattr(email_service, "send", fake_send)
    return sent


def _token(mail: dict) -> str:
    return re.search(r"token=([A-Za-z0-9_\-]+)", mail["text"]).group(1)


# --- Registration -------------------------------------------------------------------------------------

def test_registration_requires_terms(client):
    r = client.post("/api/auth/register", json={"email": "t@example.com", "password": "Secret123",
                                                "full_name": "Terms Person", "accept_terms": False})
    assert r.status_code == 422
    assert any(d["field"] == "accept_terms" for d in r.json()["error"]["details"])


def test_registration_records_terms_and_default_role(client, db):
    data = register(client)
    assert data["user"]["roles"] == ["user"] and data["user"]["permissions"] == []
    u = db.query(User).one()
    assert u.terms_accepted_at is not None and u.terms_version == get_settings().terms_version


def test_register_reports_honest_verification_state(client, outbox):
    data = register(client)
    # Console backend: the link is logged, not emailed — the API must say so.
    assert data["email_verification"] == "logged"
    assert outbox and "verify-email?token=" in outbox[0]["text"]


def test_tokens_and_hashes_never_returned(client):
    data = register(client)
    text = str(data)
    # `has_password` is a boolean flag; no password, hash or hash-like value may appear.
    assert "Secret123" not in text and "$2" not in text and "password_hash" not in text
    assert set(data["user"]) & {"password", "password_hash"} == set()


# --- CSRF ---------------------------------------------------------------------------------------------

def test_cookie_requests_without_csrf_header_are_rejected(raw_client):
    r = raw_client.post("/api/auth/register", json={"email": "c@example.com", "password": "Secret123",
                                                    "full_name": "Csrf Person", "accept_terms": True})
    assert r.status_code == 201 and "isker_csrf" in raw_client.cookies
    r = raw_client.put("/api/profile", json={"full_name": "Changed Name"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "CSRF_FAILED"
    r = raw_client.put("/api/profile", json={"full_name": "Changed Name"}, headers={"X-CSRF-Token": "wrong"})
    assert r.status_code == 403
    ok = raw_client.put("/api/profile", json={"full_name": "Changed Name"},
                        headers={"X-CSRF-Token": raw_client.cookies["isker_csrf"]})
    assert ok.status_code == 200


def test_bearer_requests_do_not_need_csrf(raw_client):
    token = raw_client.post("/api/auth/register", json={"email": "b@example.com", "password": "Secret123",
                                                        "full_name": "Bearer Person", "accept_terms": True}
                            ).json()["access_token"]
    raw_client.cookies.clear()
    r = raw_client.put("/api/profile", json={"full_name": "Bearer Changed"},
                       headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


def test_session_cookie_flags(raw_client):
    r = raw_client.post("/api/auth/register", json={"email": "f@example.com", "password": "Secret123",
                                                    "full_name": "Flag Person", "accept_terms": True})
    cookies = r.headers.get_list("set-cookie")
    session = next(c for c in cookies if c.startswith("isker_session="))
    csrf = next(c for c in cookies if c.startswith("isker_csrf="))
    assert "HttpOnly" in session and "samesite=lax" in session.lower()
    assert "HttpOnly" not in csrf


# --- Sessions -----------------------------------------------------------------------------------------

def test_sessions_list_and_revoke_others(client):
    register(client)
    other = login(client, "learner@example.com")  # second session
    login(client, "learner@example.com")  # third; current
    sessions = client.get("/api/auth/sessions").json()
    assert len(sessions) == 3 and sum(s["current"] for s in sessions) == 1
    r = client.post("/api/auth/sessions/revoke-others")
    assert r.status_code == 200 and "2" in r.json()["message"]
    assert len(client.get("/api/auth/sessions").json()) == 1
    h = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get("/api/auth/me", headers=h).json()["error"]["code"] == "SESSION_REVOKED"


def test_cannot_revoke_someone_elses_session(client, db):
    make_user(db, "victim@example.com")
    victim = login(client, "victim@example.com")
    victim_sid = client.get("/api/auth/sessions").json()[0]["id"]
    client.cookies.clear()
    register(client, "attacker@example.com")
    r = client.delete(f"/api/auth/sessions/{victim_sid}")
    assert r.status_code == 404
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {victim['access_token']}"}).status_code == 200


def test_password_change_signs_out_other_sessions(client):
    register(client)
    other = login(client, "learner@example.com")
    login(client, "learner@example.com")
    r = client.post("/api/auth/password", json={"current_password": "Secret123", "new_password": "Better456"})
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 200  # this device stays signed in
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {other['access_token']}"}).status_code == 401


def test_suspended_user_session_stops_working(client, db):
    register(client)
    u = db.query(User).one()
    from app.models.enums import AccountStatus

    u.status = AccountStatus.SUSPENDED
    db.commit()
    r = client.get("/api/auth/me")
    assert r.status_code == 401 and r.json()["error"]["code"] == "ACCOUNT_INACTIVE"


# --- Password reset -----------------------------------------------------------------------------------

def test_forgot_password_does_not_reveal_accounts(client, outbox):
    register(client)
    client.cookies.clear()
    outbox.clear()
    a = client.post("/api/auth/forgot-password", json={"email": "learner@example.com"})
    b = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert a.status_code == b.status_code == 202
    assert a.json() == b.json()
    assert len(outbox) == 1 and outbox[0]["to"] == "learner@example.com"


def test_reset_password_flow_and_single_use(client, db, outbox):
    register(client)
    old = client.post("/api/auth/login", json={"email": "learner@example.com", "password": "Secret123"}).json()
    client.cookies.clear()
    outbox.clear()
    client.post("/api/auth/forgot-password", json={"email": "learner@example.com"})
    token = _token(outbox[0])
    assert db.query(PasswordResetToken).one().token_hash != token  # only a hash is stored
    r = client.post("/api/auth/reset-password", json={"token": token, "new_password": "Brand123new"})
    assert r.status_code == 200
    again = client.post("/api/auth/reset-password", json={"token": token, "new_password": "Other123new"})
    assert again.status_code == 400 or again.status_code == 422
    # all sessions were revoked; the new password works, the old one doesn't
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {old['access_token']}"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "learner@example.com",
                                                "password": "Secret123"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "learner@example.com",
                                                "password": "Brand123new"}).status_code == 200


def test_reset_with_garbage_token(client):
    r = client.post("/api/auth/reset-password", json={"token": "x" * 40, "new_password": "Brand123new"})
    assert r.status_code in (400, 422) and r.json()["error"]["code"] == "INVALID_TOKEN"


def test_forgot_password_without_email_backend_is_honest(client, monkeypatch):
    monkeypatch.setenv("EMAIL_BACKEND", "disabled")
    get_settings.cache_clear()
    try:
        r = client.post("/api/auth/forgot-password", json={"email": "anyone@example.com"})
        assert r.status_code == 202 and "not available" in r.json()["message"]
    finally:
        get_settings.cache_clear()


# --- Email verification -------------------------------------------------------------------------------

def test_verify_email(client, outbox):
    register(client)
    token = _token(outbox[0])
    assert client.get("/api/auth/me").json()["email_verified"] is False
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    assert client.get("/api/auth/me").json()["email_verified"] is True
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code in (400, 422)


# --- Rate limiting ------------------------------------------------------------------------------------

def test_login_is_rate_limited_per_email(client):
    register(client)
    client.cookies.clear()
    codes = [client.post("/api/auth/login", json={"email": "learner@example.com", "password": "Wrong9999"}
                         ).status_code for _ in range(9)]
    assert codes[:8] == [401] * 8 and codes[8] == 429
    r = client.post("/api/auth/login", json={"email": "learner@example.com", "password": "Secret123"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"
    assert int(r.headers["Retry-After"]) > 0


def test_failed_logins_are_audited_without_secrets(client, db):
    register(client)
    client.cookies.clear()
    client.post("/api/auth/login", json={"email": "learner@example.com", "password": "Wrong9999"})
    row = db.query(AuditLog).filter(AuditLog.action == "auth.login_failed").one()
    assert "Wrong9999" not in str(row.details) and row.request_id


# --- HTTP hardening -----------------------------------------------------------------------------------

def test_security_headers_and_request_id(client):
    r = client.get("/api/health")
    h = r.headers
    assert h["X-Content-Type-Options"] == "nosniff" and h["X-Frame-Options"] == "DENY"
    assert "default-src 'self'" in h["Content-Security-Policy"] and "frame-ancestors 'none'" in h[
        "Content-Security-Policy"]
    assert h["Cache-Control"] == "no-store" and h["Referrer-Policy"]
    assert len(h["X-Request-ID"]) >= 8


def test_request_body_size_limit(client):
    big = "x" * (get_settings().max_request_bytes + 10)
    r = client.post("/api/auth/login", content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_errors_do_not_leak_internals(client):
    r = client.post("/api/auth/login", content="{not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert "Traceback" not in r.text and "File \"" not in r.text


def test_production_rejects_wildcard_cors(monkeypatch):
    from pydantic import ValidationError

    from app.core.config import Settings

    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("JWT_SECRET", "a-production-secret-that-is-long-enough-123")
    monkeypatch.setenv("CORS_ORIGINS", "*")
    with pytest.raises(ValidationError):
        Settings()
