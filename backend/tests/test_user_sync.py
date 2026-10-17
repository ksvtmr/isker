"""Admin panel ↔ learner platform sync for users, roles and subscriptions (spec scenarios 1–7, 11–14, 16).

Two browser clients share one database: `client` is the administrator, `learner` is the learner's own browser.
"""

from __future__ import annotations

import pytest

from app.main import app
from app.models import AuditLog, PasswordResetToken, User
from app.models.enums import AccountStatus
from tests.conftest import EN, BrowserClient, login, make_user, register


@pytest.fixture
def learner() -> BrowserClient:
    return BrowserClient(app, headers=EN)


def _admin(client, db, role="admin", email=None):
    email = email or f"{role}@example.com"
    u = make_user(db, email, ("user", role))
    login(client, email)
    return u


def _uid(db, email: str) -> int:
    db.expire_all()
    return db.query(User).filter(User.email == email).one().id


def _detail(client, uid: int) -> dict:
    r = client.get(f"/api/admin/users/{uid}")
    assert r.status_code == 200, r.text
    return r.json()


# 1. Registration appears in the admin list immediately -------------------------------------------------------

def test_registered_user_appears_in_admin_list_with_metadata(client, learner, db):
    r = learner.post("/api/auth/register", json={"email": "new@example.com", "password": "Secret123",
                                                 "full_name": "New Person", "accept_terms": True, "language": "kk"})
    assert r.status_code == 201
    _admin(client, db)
    page = client.get("/api/admin/users", params={"q": "new@example.com"}).json()
    assert page["total"] == 1
    row = page["items"][0]
    assert row["full_name"] == "New Person" and row["language"] == "kk" and row["roles"] == ["user"]
    assert row["status"] == "active" and row["created_at"]
    assert client.get("/api/admin/users", params={"language": "kk"}).json()["total"] == 1
    assert client.get("/api/admin/users", params={"language": "ru"}).json()["total"] == 0
    d = _detail(client, row["id"])
    assert d["lock_version"] >= 1 and d["language"] == "kk" and d["auth_methods"] == ["email"]
    assert d["email_verified"] is False
    # A repeated registration with the same email is refused: no duplicate account.
    again = learner.post("/api/auth/register", json={"email": "new@example.com", "password": "Secret123",
                                                     "full_name": "New Person", "accept_terms": True})
    assert again.status_code == 409 and again.json()["error"]["code"] == "EMAIL_TAKEN"
    assert db.query(User).filter(User.email == "new@example.com").count() == 1


# 2. Admin-created user ----------------------------------------------------------------------------------------

def test_admin_creates_user_with_invitation_and_no_password(client, learner, db):
    _admin(client, db)
    r = client.post("/api/admin/users", json={"full_name": "  Aru   Created ", "email": "Aru@Example.com",
                                              "language": "ru", "reason": "Pilot cohort"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["invitation"] == "logged" and "server log" in body["message"]  # honest: console email backend
    u = body["user"]
    assert u["email"] == "aru@example.com" and u["full_name"] == "Aru Created" and u["language"] == "ru"
    assert u["roles"] == ["user"] and u["status"] == "active" and u["auth_methods"] == []
    assert db.query(PasswordResetToken).filter(PasswordResetToken.user_id == u["id"]).count() == 1
    # Appears in the shared list; cannot sign in until a password is set through the link.
    assert client.get("/api/admin/users", params={"q": "aru@"}).json()["total"] == 1
    bad = learner.post("/api/auth/login", json={"email": "aru@example.com", "password": ""})
    assert bad.status_code in (401, 422)
    # Audit row with field values, never secrets.
    row = db.query(AuditLog).filter(AuditLog.action == "admin.user_created").one()
    assert row.details["changes"]["email"] == {"from": None, "to": "aru@example.com"}
    assert "token" not in str(row.details).lower() and "password" not in str(row.details).lower()
    # Idempotency: the same create again is a conflict, not a second account.
    dup = client.post("/api/admin/users", json={"full_name": "Aru Created", "email": "aru@example.com"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "EMAIL_TAKEN"
    assert db.query(User).filter(User.email == "aru@example.com").count() == 1


def test_admin_created_suspended_user_cannot_sign_in(client, learner, db):
    _admin(client, db)
    r = client.post("/api/admin/users", json={"full_name": "Held Back", "email": "held@example.com",
                                              "status": "suspended", "reason": "Awaiting contract"})
    assert r.status_code == 201 and r.json()["invitation"] == "not_requested"
    # Even with a password, a suspended account is refused at sign-in.
    from app.core.security import hash_password

    u = db.get(User, r.json()["user"]["id"])
    u.password_hash = hash_password("Secret123")
    db.commit()
    resp = learner.post("/api/auth/login", json={"email": "held@example.com", "password": "Secret123"})
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "ACCOUNT_SUSPENDED"


def test_create_user_roles_respect_authority(client, db):
    _admin(client, db)
    for role in ("admin", "super_admin"):
        r = client.post("/api/admin/users", json={"full_name": "Too High", "email": f"{role}x@example.com",
                                                  "roles": [role]})
        assert r.status_code == 403, role
    ok = client.post("/api/admin/users", json={"full_name": "Helper", "email": "helper@example.com",
                                               "roles": ["support"]})
    assert ok.status_code == 201 and ok.json()["user"]["roles"] == ["support", "user"]
    assert db.query(User).filter(User.email.in_(["adminx@example.com", "super_adminx@example.com"])).count() == 0
    # Support may not create accounts at all.
    _admin(client, db, "support")
    r = client.post("/api/admin/users", json={"full_name": "Nope", "email": "nope@example.com"})
    assert r.status_code == 403


def test_super_admin_can_create_admin(client, db):
    _admin(client, db, "super_admin")
    r = client.post("/api/admin/users", json={"full_name": "New Admin", "email": "na@example.com",
                                              "roles": ["admin"]})
    assert r.status_code == 201 and "admin" in r.json()["user"]["roles"]


# 3. Name change in admin reaches the learner's profile --------------------------------------------------------

def test_admin_name_and_language_edit_visible_to_learner(client, learner, db):
    register(learner, "dana@example.com")
    uid = _uid(db, "dana@example.com")
    _admin(client, db)
    v = _detail(client, uid)["lock_version"]
    r = client.patch(f"/api/admin/users/{uid}", json={"full_name": "Dana Renamed", "language": "ru",
                                                      "reason": "Name change request", "expected_version": v})
    assert r.status_code == 200, r.text
    assert r.json()["lock_version"] > v
    assert learner.get("/api/profile").json()["full_name"] == "Dana Renamed"
    me = learner.get("/api/auth/me").json()
    assert me["full_name"] == "Dana Renamed" and me["language"] == "ru"
    row = db.query(AuditLog).filter(AuditLog.action == "admin.user_updated").one()
    assert row.details["changes"]["full_name"] == {"from": "Dana Learner", "to": "Dana Renamed"}
    assert row.details["changes"]["language"] == {"from": "en", "to": "ru"} and row.reason == "Name change request"
    hist = _detail(client, uid)["change_history"]
    assert hist[0]["action"] == "admin.user_updated" and hist[0]["details"]["changes"]["full_name"]
    assert hist[0]["actor_email"] == "admin@example.com"


# 4 + 5. Blocking and unblocking ----------------------------------------------------------------------------------

PROTECTED = ["/api/auth/me", "/api/profile", "/api/entitlements/me", "/api/subscription/me", "/api/sync/state",
             "/api/assessments"]


@pytest.mark.parametrize("action,code", [("suspend", "ACCOUNT_SUSPENDED"), ("deactivate", "ACCOUNT_DEACTIVATED")])
def test_blocking_denies_every_protected_api_and_unblock_restores(client, learner, db, action, code):
    register(learner, "dana@example.com")
    uid = _uid(db, "dana@example.com")
    assert learner.get("/api/profile").status_code == 200
    _admin(client, db)
    r = client.post(f"/api/admin/users/{uid}/{action}", json={"reason": "Policy violation"})
    assert r.status_code == 200 and r.json()["revoked_sessions"] == 1
    for path in PROTECTED:
        resp = learner.get(path)
        assert resp.status_code == 401, path
        assert resp.json()["error"]["code"] == code, path
    assert learner.put("/api/profile", json={"full_name": "Sneaky"}).status_code == 401
    # Signing in again is refused too.
    resp = learner.post("/api/auth/login", json={"email": "dana@example.com", "password": "Secret123"})
    assert resp.status_code == 401 and resp.json()["error"]["code"] == code
    hist = _detail(client, uid)["change_history"]
    assert hist[0]["details"]["changes"]["status"] == {"from": "active", "to": AccountStatus(
        "suspended" if action == "suspend" else "deactivated").value}
    # Reactivation restores access according to roles and plan.
    assert client.post(f"/api/admin/users/{uid}/reactivate", json={"reason": "Appeal accepted"}).status_code == 200
    login(learner, "dana@example.com")
    assert learner.get("/api/profile").status_code == 200
    me = learner.get("/api/auth/me").json()
    assert me["roles"] == ["user"] and "admin.access" not in me["permissions"]


def test_status_change_is_versioned(client, db):
    target = make_user(db, "t@example.com")
    _admin(client, db)
    v = _detail(client, target.id)["lock_version"]
    r = client.post(f"/api/admin/users/{target.id}/suspend", json={"reason": "Spam", "expected_version": v - 1 or 99})
    assert r.status_code == 409 and r.json()["error"]["code"] == "VERSION_CONFLICT"


# 6. Role change takes effect on the next request ------------------------------------------------------------------

def test_role_change_applies_immediately_on_backend(client, learner, db):
    staff = make_user(db, "staffer@example.com")
    login(learner, "staffer@example.com")
    assert learner.get("/api/admin/users").status_code == 403
    _admin(client, db)
    v = _detail(client, staff.id)["lock_version"]
    r = client.post(f"/api/admin/users/{staff.id}/roles", json={"role_key": "support", "reason": "Joined support",
                                                                "expected_version": v})
    assert r.status_code == 200 and r.json()["lock_version"] > v
    # Same session, no re-login: permissions are read from the database on every request (the JWT has none).
    assert learner.get("/api/admin/users").status_code == 200
    assert "users.view" in learner.get("/api/auth/me").json()["permissions"]
    r = client.delete(f"/api/admin/users/{staff.id}/roles/support", params={"reason": "Left the team"})
    assert r.status_code == 200
    assert learner.get("/api/admin/users").status_code == 403
    row = db.query(AuditLog).filter(AuditLog.action == "admin.role_revoked").one()
    assert row.details["changes"]["roles"] == {"from": ["support", "user"], "to": ["user"]}


def test_jwt_carries_no_permissions(client, db):
    import jwt

    make_user(db, "x@example.com", ("user", "admin"))
    token = login(client, "x@example.com")["access_token"]
    claims = jwt.decode(token, options={"verify_signature": False})
    assert set(claims) <= {"sub", "jti", "ver", "exp", "iat"}


# 7. Plan change changes features and limits -------------------------------------------------------------------------

def test_plan_change_updates_entitlements(client, learner, db):
    register(learner, "dana@example.com")
    uid = _uid(db, "dana@example.com")
    ents = {e["key"]: e for e in learner.get("/api/entitlements/me").json()}
    assert ents["learning.advanced_resources"]["enabled"] is False and ents["assessment.full"]["limit"] == 2
    _admin(client, db)
    r = client.post(f"/api/admin/users/{uid}/subscriptions", json={"plan_key": "pro", "reason": "Scholarship"})
    assert r.status_code == 201
    ents = {e["key"]: e for e in learner.get("/api/entitlements/me").json()}
    assert ents["learning.advanced_resources"]["enabled"] is True and ents["assessment.full"]["limit"] is None
    d = _detail(client, uid)
    assert d["plan_key"] == "pro" and {e["key"] for e in d["entitlements"] if e["enabled"]} >= {
        "learning.advanced_resources"}
    assert any(h["action"] == "admin.subscription_assigned" for h in d["change_history"])
    # Revoking (cancelling now) returns the learner to the free plan's features.
    sub_id = r.json()["id"]
    assert client.post(f"/api/admin/subscriptions/{sub_id}/cancel",
                       json={"at_period_end": False, "reason": "Scholarship ended"}).status_code == 200
    ents = {e["key"]: e for e in learner.get("/api/entitlements/me").json()}
    assert ents["learning.advanced_resources"]["enabled"] is False


# 11. Reload keeps changes --------------------------------------------------------------------------------------------

def test_changes_survive_reload_and_relogin(client, learner, db):
    register(learner, "dana@example.com")
    uid = _uid(db, "dana@example.com")
    _admin(client, db)
    client.patch(f"/api/admin/users/{uid}", json={"full_name": "Persisted Name", "reason": "Check persistence"})
    client.post(f"/api/admin/users/{uid}/roles", json={"role_key": "support", "reason": "Promotion"})
    db.expire_all()
    # A fresh admin session sees the same state (it was stored, not cached in a client).
    login(client, "admin@example.com")
    d = _detail(client, uid)
    assert d["full_name"] == "Persisted Name" and "support" in d["roles"]
    login(learner, "dana@example.com")
    assert learner.get("/api/auth/me").json()["full_name"] == "Persisted Name"


# 12. Two admins editing the same user ---------------------------------------------------------------------------------

def test_two_admins_do_not_silently_overwrite_each_other(client, learner, db):
    target = make_user(db, "t@example.com", full_name="Original Name")
    _admin(client, db, email="a1@example.com")
    make_user(db, "a2@example.com", ("user", "admin"))
    login(learner, "a2@example.com")  # second administrator's browser
    v1 = _detail(client, target.id)["lock_version"]
    v2 = _detail(learner, target.id)["lock_version"]
    assert v1 == v2
    first = client.patch(f"/api/admin/users/{target.id}", json={"full_name": "First Edit", "reason": "Fix name",
                                                                "expected_version": v1})
    assert first.status_code == 200
    second = learner.patch(f"/api/admin/users/{target.id}", json={"full_name": "Second Edit", "reason": "Fix name",
                                                                  "expected_version": v2})
    assert second.status_code == 409 and second.json()["error"]["code"] == "VERSION_CONFLICT"
    assert second.json()["error"]["details"]["current_version"] == first.json()["lock_version"]
    db.expire_all()
    assert db.get(User, target.id).full_name == "First Edit"
    # After reloading, the second admin can apply the change knowingly.
    v = _detail(learner, target.id)["lock_version"]
    ok = learner.patch(f"/api/admin/users/{target.id}", json={"full_name": "Second Edit", "reason": "Fix name",
                                                              "expected_version": v})
    assert ok.status_code == 200


def test_learner_activity_does_not_make_admin_form_stale(client, learner, db):
    register(learner, "dana@example.com")
    uid = _uid(db, "dana@example.com")
    _admin(client, db)
    v = _detail(client, uid)["lock_version"]
    login(learner, "dana@example.com")  # sign-in and last-seen updates are not edits
    learner.get("/api/auth/me")
    r = client.patch(f"/api/admin/users/{uid}", json={"full_name": "Still Fine", "reason": "Fix name",
                                                      "expected_version": v})
    assert r.status_code == 200


# 13. No self-escalation ----------------------------------------------------------------------------------------------

def test_learner_cannot_escalate_through_any_api(client, db):
    register(client, "dana@example.com")
    uid = _uid(db, "dana@example.com")
    r = client.put("/api/profile", json={"full_name": "Dana", "roles": ["super_admin"], "permissions": ["*"],
                                         "status": "active", "plan_key": "pro", "lock_version": 99})
    assert r.status_code == 200
    me = client.get("/api/auth/me").json()
    assert me["roles"] == ["user"] and me["permissions"] == []
    assert client.post(f"/api/admin/users/{uid}/roles", json={"role_key": "super_admin",
                                                              "reason": "please"}).status_code == 403
    assert client.post(f"/api/admin/users/{uid}/subscriptions", json={"plan_key": "pro",
                                                                      "reason": "please"}).status_code == 403
    assert client.post("/api/admin/users", json={"full_name": "Me Again", "email": "x@example.com",
                                                 "roles": ["admin"]}).status_code == 403
    assert client.patch(f"/api/admin/users/{uid}", json={"full_name": "X", "reason": "please"}).status_code in (403,
                                                                                                                 422)
    assert client.get("/api/admin/users").status_code == 403
    assert client.get("/api/admin/audit-logs").status_code == 403
    db.expire_all()
    assert db.get(User, uid).role_keys == ["user"]


# 14. Staff without the right permission / rank ----------------------------------------------------------------------

def test_support_and_content_manager_cannot_do_admin_only_user_operations(client, db):
    target = make_user(db, "t@example.com")
    for role in ("support", "content_manager"):
        _admin(client, db, role)
        assert client.patch(f"/api/admin/users/{target.id}", json={"full_name": "Changed",
                                                                   "reason": "try"}).status_code == 403
        assert client.post(f"/api/admin/users/{target.id}/suspend", json={"reason": "try it"}).status_code == 403
        assert client.post(f"/api/admin/users/{target.id}/roles", json={"role_key": "support",
                                                                        "reason": "try"}).status_code == 403
        assert client.post("/api/admin/users", json={"full_name": "New One",
                                                     "email": f"n-{role}@example.com"}).status_code == 403
    # Support can use support tools (resend verification) but content managers cannot see users at all.
    _admin(client, db, "support", email="support2@example.com")
    r = client.post(f"/api/admin/users/{target.id}/resend-verification", json={"reason": "User asked"})
    assert r.status_code == 200 and r.json()["delivered"] is False and "server log" in r.json()["message"]
    _admin(client, db, "content_manager", email="cm2@example.com")
    assert client.get(f"/api/admin/users/{target.id}").status_code == 403


def test_admin_cannot_act_above_own_rank_and_last_super_admin_is_protected(client, db):
    boss = make_user(db, "boss@example.com", ("user", "super_admin"))
    peer = make_user(db, "peer@example.com", ("user", "admin"))
    _admin(client, db)
    assert client.post(f"/api/admin/users/{boss.id}/suspend", json={"reason": "coup"}).status_code == 403
    assert client.patch(f"/api/admin/users/{peer.id}", json={"full_name": "Renamed",
                                                             "reason": "nope"}).status_code == 403
    assert client.post(f"/api/admin/users/{peer.id}/roles", json={"role_key": "super_admin",
                                                                  "reason": "nope"}).status_code == 403
    # The only super admin cannot be demoted, even by a super admin acting on another account.
    other = make_user(db, "other@example.com", ("user", "super_admin"))
    login(client, "other@example.com")
    assert client.post(f"/api/admin/users/{boss.id}/deactivate", json={"reason": "cleanup"}).status_code == 200
    login(client, "other@example.com")
    r = client.delete(f"/api/admin/users/{other.id}/roles/super_admin", params={"reason": "self demotion"})
    assert r.status_code == 403  # cannot change own roles
    assert client.post(f"/api/admin/users/{other.id}/suspend", json={"reason": "self"}).status_code == 403


def test_resend_verification_rules(client, db):
    verified = make_user(db, "v@example.com")
    from app.core.database import utcnow

    verified.email_verified_at = utcnow()
    db.commit()
    _admin(client, db)
    r = client.post(f"/api/admin/users/{verified.id}/resend-verification", json={"reason": "User asked"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "ALREADY_VERIFIED"


# 16. Live refresh: sync state changes after admin edits ---------------------------------------------------------------

def test_sync_state_changes_after_admin_edits(client, learner, db):
    register(learner, "dana@example.com")
    uid = _uid(db, "dana@example.com")
    s0 = learner.get("/api/sync/state").json()
    assert set(s0) >= {"user_version", "access_version", "entitlements_version", "content_version"}
    assert learner.get("/api/sync/state").json()["user_version"] == s0["user_version"]  # stable when idle
    _admin(client, db)
    client.patch(f"/api/admin/users/{uid}", json={"full_name": "Live Name", "reason": "Rename"})
    s1 = learner.get("/api/sync/state").json()
    assert s1["user_version"] > s0["user_version"] and s1["access_version"] == s0["access_version"]
    client.post(f"/api/admin/users/{uid}/roles", json={"role_key": "support", "reason": "Promotion"})
    s2 = learner.get("/api/sync/state").json()
    assert s2["access_version"] != s1["access_version"]
    client.post(f"/api/admin/users/{uid}/subscriptions", json={"plan_key": "pro", "reason": "Grant"})
    s3 = learner.get("/api/sync/state").json()
    assert s3["entitlements_version"] != s2["entitlements_version"]
    # Blocked: the poll itself reports why, so the open tab can sign the person out with a clear message.
    client.post(f"/api/admin/users/{uid}/suspend", json={"reason": "Investigation"})
    r = learner.get("/api/sync/state")
    assert r.status_code == 401 and r.json()["error"]["code"] == "ACCOUNT_SUSPENDED"
    assert client.get("/api/sync/state").status_code == 200
    assert BrowserClient(app, headers=EN).get("/api/sync/state").status_code == 401
