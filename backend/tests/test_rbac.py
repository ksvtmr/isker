"""Role-based access control: deny by default, vertical and horizontal escalation, last super admin."""

import pytest

from app.models import AuditLog, User
from app.models.enums import AccountStatus
from tests.conftest import login, make_user, register

ADMIN_GETS = ["/api/admin/stats", "/api/admin/users", "/api/admin/roles", "/api/admin/plans",
              "/api/admin/subscriptions", "/api/admin/audit-logs", "/api/admin/analytics/overview",
              "/api/admin/settings", "/api/admin/questions", "/api/admin/ai/prompts", "/api/admin/me"]


def test_ordinary_user_cannot_reach_any_admin_endpoint(client, db):
    register(client)
    for path in ADMIN_GETS:
        r = client.get(path)
        assert r.status_code == 403, path
    # denials are audited
    assert db.query(AuditLog).filter(AuditLog.action == "access.denied").count() == len(ADMIN_GETS)


def test_anonymous_gets_401_on_admin(client):
    for path in ADMIN_GETS:
        assert client.get(path).status_code == 401, path


def test_user_cannot_self_escalate_via_profile_or_register(client, db):
    r = client.post("/api/auth/register", json={"email": "x@example.com", "password": "Secret123",
                                                "full_name": "Sneaky", "accept_terms": True,
                                                "roles": ["super_admin"], "role": "admin"})
    assert r.status_code == 201 and r.json()["user"]["roles"] == ["user"]
    client.put("/api/profile", json={"full_name": "Sneaky", "roles": ["admin"]})
    assert client.get("/api/auth/me").json()["roles"] == ["user"]


def test_user_cannot_assign_roles(client, db):
    target = make_user(db, "target@example.com")
    register(client)
    r = client.post(f"/api/admin/users/{target.id}/roles", json={"role_key": "admin", "reason": "please"})
    assert r.status_code == 403


@pytest.mark.parametrize("role,allowed,denied", [
    ("support", ["/api/admin/users", "/api/admin/subscriptions", "/api/admin/plans"],
     ["/api/admin/roles", "/api/admin/audit-logs", "/api/admin/questions", "/api/admin/analytics/overview"]),
    ("content_manager", ["/api/admin/questions", "/api/admin/resources", "/api/admin/ai/prompts"],
     ["/api/admin/users", "/api/admin/subscriptions", "/api/admin/audit-logs", "/api/admin/roles"]),
    ("admin", ["/api/admin/users", "/api/admin/roles", "/api/admin/audit-logs", "/api/admin/analytics/overview",
               "/api/admin/settings", "/api/admin/questions"], []),
])
def test_role_permission_matrix(client, db, role, allowed, denied):
    make_user(db, f"{role}@example.com", ("user", role))
    login(client, f"{role}@example.com")
    for p in allowed:
        assert client.get(p).status_code == 200, (role, p)
    for p in denied:
        assert client.get(p).status_code == 403, (role, p)


def test_admin_cannot_grant_admin_or_super_admin(client, db):
    make_user(db, "admin@example.com", ("user", "admin"))
    target = make_user(db, "t@example.com")
    login(client, "admin@example.com")
    for key in ("admin", "super_admin"):
        r = client.post(f"/api/admin/users/{target.id}/roles", json={"role_key": key, "reason": "promotion"})
        assert r.status_code == 403 and r.json()["error"]["code"] == "INSUFFICIENT_RANK", key
    r = client.post(f"/api/admin/users/{target.id}/roles", json={"role_key": "support", "reason": "joins support"})
    assert r.status_code == 200 and "support" in r.json()["roles"]


def test_nobody_changes_their_own_roles(client, db):
    me = make_user(db, "root@example.com", ("user", "super_admin"))
    make_user(db, "root2@example.com", ("user", "super_admin"))
    login(client, "root@example.com")
    r = client.post(f"/api/admin/users/{me.id}/roles", json={"role_key": "support", "reason": "self"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "SELF_ACTION_FORBIDDEN"
    r = client.delete(f"/api/admin/users/{me.id}/roles/super_admin", params={"reason": "self demote"})
    assert r.status_code == 403


def test_admin_cannot_act_on_peer_or_higher(client, db):
    make_user(db, "admin@example.com", ("user", "admin"))
    peer = make_user(db, "peer@example.com", ("user", "admin"))
    boss = make_user(db, "boss@example.com", ("user", "super_admin"))
    login(client, "admin@example.com")
    for target in (peer, boss):
        r = client.post(f"/api/admin/users/{target.id}/suspend", json={"reason": "coup attempt"})
        assert r.status_code == 403, target.email
        r = client.post(f"/api/admin/users/{target.id}/revoke-sessions", json={"reason": "coup attempt"})
        assert r.status_code == 403
        r = client.patch(f"/api/admin/users/{target.id}", json={"email": "mine@example.com", "reason": "takeover"})
        assert r.status_code == 403


def test_support_cannot_suspend_or_edit(client, db):
    make_user(db, "support@example.com", ("user", "support"))
    learner = make_user(db, "l@example.com")
    login(client, "support@example.com")
    assert client.get(f"/api/admin/users/{learner.id}").status_code == 200
    assert client.post(f"/api/admin/users/{learner.id}/suspend", json={"reason": "nope"}).status_code == 403
    assert client.patch(f"/api/admin/users/{learner.id}", json={"full_name": "X Y", "reason": "nope"}
                        ).status_code == 403
    assert client.post(f"/api/admin/users/{learner.id}/revoke-sessions", json={"reason": "lost laptop"}
                       ).status_code == 200


def test_last_super_admin_is_protected(client, db):
    root = make_user(db, "root@example.com", ("user", "super_admin"))
    other = make_user(db, "other@example.com", ("user", "super_admin"))
    login(client, "root@example.com")
    # demote the other super admin: allowed while two exist
    r = client.delete(f"/api/admin/users/{other.id}/roles/super_admin", params={"reason": "rotation"})
    assert r.status_code == 200
    # the remaining super admin can't close their own account
    r = client.post("/api/auth/deactivate", json={"password": "Secret123"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "LAST_SUPER_ADMIN"
    db.refresh(root)
    assert root.status == AccountStatus.ACTIVE


def test_super_admin_role_permissions_are_immutable(client, db):
    make_user(db, "root@example.com", ("user", "super_admin"))
    login(client, "root@example.com")
    roles = {r["key"]: r for r in client.get("/api/admin/roles").json()}
    r = client.put(f"/api/admin/roles/{roles['super_admin']['id']}/permissions",
                   json={"permissions": [], "reason": "lockout"})
    assert r.status_code == 409
    r = client.put(f"/api/admin/roles/{roles['support']['id']}/permissions",
                   json={"permissions": ["admin.access", "users.view", "users.delete"], "reason": "too much"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "RESERVED_PERMISSION"
    r = client.put(f"/api/admin/roles/{roles['support']['id']}/permissions",
                   json={"permissions": ["admin.access", "users.view"], "reason": "narrow support"})
    assert r.status_code == 200 and r.json()["permissions"] == ["admin.access", "users.view"]


def test_admin_cannot_manage_role_definitions(client, db):
    make_user(db, "admin@example.com", ("user", "admin"))
    login(client, "admin@example.com")
    roles = {r["key"]: r for r in client.get("/api/admin/roles").json()}
    assert all(not r["editable"] for r in roles.values())
    r = client.put(f"/api/admin/roles/{roles['admin']['id']}/permissions",
                   json={"permissions": list(roles["admin"]["permissions"]) + ["users.delete"], "reason": "more"})
    assert r.status_code == 403


def test_horizontal_access_to_other_users_data_is_blocked(client, db):
    register(client, "a@example.com")
    attempt = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
    client.cookies.clear()
    register(client, "b@example.com")
    assert client.get(f"/api/assessments/attempts/{attempt}").status_code == 404
    a_id = db.query(User).filter(User.email == "a@example.com").one().id
    assert client.get(f"/api/admin/users/{a_id}").status_code == 403
