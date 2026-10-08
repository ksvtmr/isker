from tests.conftest import register


def test_register_sets_cookie_and_returns_user(client):
    data = register(client)
    assert data["user"]["email"] == "learner@example.com"
    assert data["user"]["onboarding_completed"] is False
    assert "isker_session" in client.cookies
    assert client.get("/api/auth/me").json()["full_name"] == "Dana Learner"


def test_password_is_hashed(client, db):
    from app.models import User

    register(client)
    u = db.query(User).one()
    assert u.password_hash != "Secret123" and u.password_hash.startswith("$2")


def test_duplicate_email_conflict(client):
    register(client)
    r = client.post(
        "/api/auth/register", json={"email": "LEARNER@example.com", "password": "Secret123", "full_name": "Other"}
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "EMAIL_TAKEN"


def test_weak_password_validation_envelope(client):
    r = client.post("/api/auth/register", json={"email": "a@b.co", "password": "short", "full_name": "A B"})
    assert r.status_code == 422
    body = r.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    assert any(d["field"] == "password" for d in body["details"])


def test_login_wrong_password(client):
    register(client)
    client.cookies.clear()
    r = client.post("/api/auth/login", json={"email": "learner@example.com", "password": "Wrong1234"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_and_bearer_token(client):
    register(client)
    client.cookies.clear()
    r = client.post("/api/auth/login", json={"email": "learner@example.com", "password": "Secret123"})
    token = r.json()["access_token"]
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_logout_revokes_token(client):
    token = register(client)["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/auth/logout", headers=h).status_code == 200
    r = client.get("/api/auth/me", headers=h)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "SESSION_REVOKED"


def test_protected_endpoints_require_auth(client):
    for path in ("/api/dashboard", "/api/profile", "/api/plan", "/api/progress", "/api/assessments"):
        r = client.get(path)
        assert r.status_code == 401, path
        assert r.json()["error"]["code"] == "NOT_AUTHENTICATED"


def test_admin_requires_admin_role(client):
    register(client)
    r = client.get("/api/admin/stats")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"


def test_login_works_for_reserved_domain_accounts(client, db):
    from app.core.security import hash_password
    from app.models import User

    db.add(User(email="demo@isker.local", password_hash=hash_password("IskerDemo2026"), full_name="Demo"))
    db.commit()
    r = client.post("/api/auth/login", json={"email": "Demo@Isker.local", "password": "IskerDemo2026"})
    assert r.status_code == 200, r.text


def test_cors_origins_parsed_from_comma_separated_env(monkeypatch):
    from app.core.config import Settings

    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:8080, http://example.com")
    assert Settings().cors_origins == ["http://localhost:8080", "http://example.com"]
