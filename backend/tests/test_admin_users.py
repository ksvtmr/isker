"""Admin user management, analytics, audit log and settings."""

from datetime import timedelta

from app.core.database import utcnow
from app.models import AuditLog, User
from app.models.enums import AccountStatus
from tests.conftest import login, make_user, register


def _as_admin(client, db, role="admin"):
    me = make_user(db, f"{role}@example.com", ("user", role))
    login(client, f"{role}@example.com")
    return me


def test_list_users_search_filter_sort_paginate(client, db):
    for i in range(7):
        make_user(db, f"user{i}@example.com", full_name=f"Learner {i}")
    make_user(db, "suspended@example.com", status=AccountStatus.SUSPENDED)
    make_user(db, "old@example.com", last_seen_at=utcnow() - timedelta(days=90))
    _as_admin(client, db)
    page = client.get("/api/admin/users", params={"page_size": 3, "sort": "email", "order": "asc"}).json()
    assert page["total"] == 10 and len(page["items"]) == 3
    assert [u["email"] for u in page["items"]] == sorted(u["email"] for u in page["items"])
    assert client.get("/api/admin/users", params={"q": "Learner 3"}).json()["total"] == 1
    assert client.get("/api/admin/users", params={"status": "suspended"}).json()["total"] == 1
    assert client.get("/api/admin/users", params={"role": "admin"}).json()["total"] == 1
    inactive = client.get("/api/admin/users", params={"inactive_for_days": 30}).json()
    assert "old@example.com" in [u["email"] for u in inactive["items"]]
    free = client.get("/api/admin/users", params={"plan": "free"}).json()
    assert free["total"] == 10 and free["items"][0]["plan_key"] == "free"
    assert client.get("/api/admin/users", params={"plan": "nope"}).status_code == 422
    assert client.get("/api/admin/users", params={"sort": "password_hash"}).status_code == 422


def test_user_detail_contains_journey_and_no_secrets(client, db):
    register(client, "learner@example.com")
    client.post("/api/assessments/attempts", json={"scope": "full"})
    learner = db.query(User).filter(User.email == "learner@example.com").one()
    _as_admin(client, db)
    d = client.get(f"/api/admin/users/{learner.id}").json()
    assert d["email"] == "learner@example.com" and d["plan_key"] == "free"
    assert len(d["attempts"]) == 1 and d["sessions"] and d["audit_events"] is not None
    assert d["can_manage"] and d["can_assign_roles"] and not d["can_delete"]
    text = str(d)
    assert "password" not in text and "$2b$" not in text and "token" not in text.lower()
    assert client.get("/api/admin/users/999999").status_code == 404


def test_support_sees_details_without_audit(client, db):
    learner = make_user(db, "l@example.com")
    _as_admin(client, db, "support")
    d = client.get(f"/api/admin/users/{learner.id}").json()
    assert d["audit_events"] is None and not d["can_manage"]


def test_suspend_requires_reason_revokes_sessions_and_reactivate(client, db):
    learner = make_user(db, "l@example.com")
    learner_login = login(client, "l@example.com")
    _as_admin(client, db)
    assert client.post(f"/api/admin/users/{learner.id}/suspend", json={"reason": " "}).status_code == 422
    assert client.post(f"/api/admin/users/{learner.id}/suspend", json={}).status_code == 422
    r = client.post(f"/api/admin/users/{learner.id}/suspend", json={"reason": "Abusive messages"})
    assert r.status_code == 200 and r.json()["revoked_sessions"] == 1
    h = {"Authorization": f"Bearer {learner_login['access_token']}"}
    assert client.get("/api/auth/me", headers=h).status_code == 401
    row = db.query(AuditLog).filter(AuditLog.action == "admin.user_suspended").one()
    assert row.reason == "Abusive messages" and row.target_id == learner.id
    assert client.post(f"/api/admin/users/{learner.id}/suspend", json={"reason": "again"}).status_code == 409
    r = client.post(f"/api/admin/users/{learner.id}/reactivate", json={"reason": "Appeal accepted"})
    assert r.status_code == 200
    db.refresh(learner)
    assert learner.status == AccountStatus.ACTIVE


def test_admin_cannot_suspend_self(client, db):
    me = _as_admin(client, db)
    r = client.post(f"/api/admin/users/{me.id}/suspend", json={"reason": "oops"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "SELF_ACTION_FORBIDDEN"


def test_edit_user_email_conflict_and_reverification(client, db):
    learner = make_user(db, "l@example.com", email_verified_at=utcnow())
    make_user(db, "taken@example.com")
    _as_admin(client, db)
    r = client.patch(f"/api/admin/users/{learner.id}", json={"email": "taken@example.com", "reason": "typo fix"})
    assert r.status_code == 409
    r = client.patch(f"/api/admin/users/{learner.id}", json={"email": "New@Example.com", "reason": "typo fix"})
    assert r.status_code == 200 and r.json()["email"] == "new@example.com"
    assert r.json()["email_verified_at"] is None


def test_admin_password_reset_is_honest_about_dev_email(client, db):
    learner = make_user(db, "l@example.com")
    _as_admin(client, db)
    r = client.post(f"/api/admin/users/{learner.id}/password-reset", json={"reason": "user asked by phone"})
    assert r.status_code == 200
    assert r.json()["delivered"] is False and "server log" in r.json()["message"]


def test_deletion_workflow(client, db):
    learner = make_user(db, "l@example.com")
    learner_id = learner.id
    _as_admin(client, db, "super_admin")
    # must be deactivated first
    r = client.request("DELETE", f"/api/admin/users/{learner.id}",
                       json={"confirm_email": "l@example.com", "reason": "GDPR request"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "NOT_DEACTIVATED"
    client.post(f"/api/admin/users/{learner.id}/deactivate", json={"reason": "GDPR request"})
    r = client.request("DELETE", f"/api/admin/users/{learner.id}",
                       json={"confirm_email": "wrong@example.com", "reason": "GDPR request"})
    assert r.status_code == 422
    r = client.request("DELETE", f"/api/admin/users/{learner.id}",
                       json={"confirm_email": "l@example.com", "reason": "GDPR request"})
    assert r.status_code == 200
    db.expunge_all()
    assert db.query(User).filter(User.id == learner_id).first() is None
    # audit history survives the deletion, without the deleted person's email
    rows = db.query(AuditLog).filter(AuditLog.target_id == learner_id, AuditLog.target_type == "user").all()
    assert any(r.action == "admin.user_deleted" for r in rows)
    assert all("l@example.com" not in str(r.details) for r in rows)


def test_plain_admin_cannot_delete(client, db):
    learner = make_user(db, "l@example.com", status=AccountStatus.DEACTIVATED)
    _as_admin(client, db)
    r = client.request("DELETE", f"/api/admin/users/{learner.id}",
                       json={"confirm_email": "l@example.com", "reason": "cleanup"})
    assert r.status_code == 403


def test_analytics_overview_from_real_data(client, db):
    register(client, "a@example.com")
    client.post("/api/assessments/attempts", json={"scope": "full"})
    client.cookies.clear()
    _as_admin(client, db)
    o = client.get("/api/admin/analytics/overview").json()
    assert o["users"]["total"] == 2 and o["users"]["new_in_window"] == 2
    assert o["assessments"]["started"] == 1 and o["assessments"]["completed"] == 0
    assert o["assessments"]["completion_rate"] == 0.0
    assert len(o["registrations"]) == 30 and sum(d["count"] for d in o["registrations"]) == 2
    assert o["subscriptions"]["free_users"] == 2 and o["subscriptions"]["paid_users"] == 0
    assert isinstance(o["recent_admin_actions"], list) and isinstance(o["security_events"], list)


def test_analytics_empty_state(client, db):
    _as_admin(client, db)
    o = client.get("/api/admin/analytics/overview").json()
    assert o["assessments"]["completion_rate"] is None and o["assessments"]["average_overall"] is None


def test_audit_log_filters_and_is_restricted(client, db):
    learner = make_user(db, "l@example.com")
    _as_admin(client, db)
    client.post(f"/api/admin/users/{learner.id}/suspend", json={"reason": "spam"})
    page = client.get("/api/admin/audit-logs", params={"action": "admin."}).json()
    assert page["total"] >= 1 and all(i["action"].startswith("admin.") for i in page["items"])
    assert page["items"][0]["actor_email"] == "admin@example.com"
    by_target = client.get("/api/admin/audit-logs", params={"target_type": "user", "target_id": learner.id}).json()
    assert any(i["action"] == "admin.user_suspended" for i in by_target["items"])
    sec = client.get("/api/admin/audit-logs", params={"security_only": True}).json()
    assert any(i["action"] == "admin.user_suspended" for i in sec["items"])


def test_settings_never_expose_secrets(client, db):
    _as_admin(client, db)
    s = client.get("/api/admin/settings").json()
    text = str(s).lower()
    assert "jwt_secret" not in text and "test-secret" not in text and "smtp_password" not in text
    assert s["email"]["backend"] in ("console", "smtp", "disabled") and "payments" in s
