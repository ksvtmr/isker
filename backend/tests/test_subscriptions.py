"""Plans, subscriptions lifecycle, entitlement enforcement and payment webhooks."""

import json
import time
from datetime import timedelta

import pytest

from app.core.config import get_settings
from app.core.database import utcnow
from app.models import LearningResource, PaymentWebhookEvent, SubscriptionEvent, User, UserSubscription
from app.models.enums import Difficulty, SubscriptionStatus
from app.services import payments
from tests.conftest import answer_all, login, make_user, register


def _admin(client, db):
    make_user(db, "admin@example.com", ("user", "admin"))
    login(client, "admin@example.com")


def _ents(client) -> dict:
    return {e["key"]: e for e in client.get("/api/entitlements/me").json()}


def test_public_plans_and_default_free_entitlements(client):
    plans = client.get("/api/plans").json()
    assert [p["key"] for p in plans] == ["free", "pro", "premium"]
    assert plans[0]["is_default"] and plans[0]["price_cents"] == 0
    register(client)
    e = _ents(client)
    assert e["assessment.full"]["limit"] == 2 and e["assessment.full"]["used"] == 0
    assert e["learning.advanced_resources"]["enabled"] is False
    me = client.get("/api/subscription/me").json()
    assert me["plan"]["key"] == "free" and me["subscription"] is None
    assert me["payments"]["checkout_available"] is False


def test_full_assessment_limit_is_enforced_on_free(client):
    register(client)
    for _ in range(2):
        a = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
        answer_all(client, a)
        assert client.post(f"/api/assessments/attempts/{a}/submit").status_code == 200
    r = client.post("/api/assessments/attempts", json={"scope": "full"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "UPGRADE_REQUIRED"
    assert r.json()["error"]["details"]["feature"] == "assessment.full"
    assert _ents(client)["assessment.full"]["remaining"] == 0


def test_resuming_does_not_consume_quota(client):
    register(client)
    first = client.post("/api/assessments/attempts", json={"scope": "full"}).json()
    again = client.post("/api/assessments/attempts", json={"scope": "full"}).json()
    assert again["resumed"] and again["attempt"]["id"] == first["attempt"]["id"]
    assert _ents(client)["assessment.full"]["used"] == 1


def test_advanced_resources_locked_on_free_and_unlocked_by_grant(client, db):
    register(client)
    adv = db.query(LearningResource).filter(LearningResource.difficulty == Difficulty.ADVANCED).first()
    assert adv is not None
    listing = client.get("/api/learning/resources", params={"page_size": 100}).json()["items"]
    assert next(i for i in listing if i["id"] == adv.id)["locked"] is True
    r = client.get(f"/api/learning/resources/{adv.id}")
    assert r.status_code == 403 and r.json()["error"]["code"] == "UPGRADE_REQUIRED"
    learner_id = db.query(User).filter(User.email == "learner@example.com").one().id
    client.cookies.clear()
    _admin(client, db)
    r = client.post(f"/api/admin/users/{learner_id}/subscriptions",
                    json={"plan_key": "pro", "days": 30, "reason": "Scholarship"})
    assert r.status_code == 201 and r.json()["status"] == "active" and r.json()["source"] == "admin"
    login(client, "learner@example.com")
    assert client.get(f"/api/learning/resources/{adv.id}").status_code == 200
    assert _ents(client)["assessment.full"]["limit"] is None


def test_practice_task_limit(client, db):
    register(client)
    tasks = client.get("/api/practice/tasks").json()
    for t in tasks[:3]:
        assert client.post(f"/api/practice/tasks/{t['id']}/start").status_code == 200
    # re-opening a started task is free
    assert client.post(f"/api/practice/tasks/{tasks[0]['id']}/start").status_code == 200
    r = client.post(f"/api/practice/tasks/{tasks[3]['id']}/start")
    assert r.status_code == 403 and r.json()["error"]["code"] == "UPGRADE_REQUIRED"


def test_history_depth_on_free(client, db):
    register(client)
    p = client.get("/api/progress").json()
    assert "progress.history" in p["locked_features"]


def test_time_limited_grant_expires_lazily(client, db):
    learner = make_user(db, "l@example.com")
    _admin(client, db)
    sub = client.post(f"/api/admin/users/{learner.id}/subscriptions",
                      json={"plan_key": "pro", "days": 7, "reason": "Trial for event"}).json()
    row = db.get(UserSubscription, sub["id"])
    row.expires_at = utcnow() - timedelta(minutes=1)
    db.commit()
    login(client, "l@example.com")
    me = client.get("/api/subscription/me").json()
    assert me["plan"]["key"] == "free" and me["subscription"] is None
    db.expire_all()
    assert db.get(UserSubscription, sub["id"]).status == SubscriptionStatus.EXPIRED
    assert db.query(SubscriptionEvent).filter(SubscriptionEvent.event_type == "expired").count() == 1


def test_extend_cancel_and_transitions(client, db):
    learner = make_user(db, "l@example.com")
    _admin(client, db)
    sub = client.post(f"/api/admin/users/{learner.id}/subscriptions",
                      json={"plan_key": "pro", "days": 10, "reason": "Pilot"}).json()
    r = client.post(f"/api/admin/subscriptions/{sub['id']}/extend", json={"days": 20, "reason": "Pilot extended"})
    assert r.status_code == 200
    r = client.post(f"/api/admin/subscriptions/{sub['id']}/status", json={"status": "past_due", "reason": "Card"})
    assert r.status_code == 200 and r.json()["status"] == "past_due"
    r = client.post(f"/api/admin/subscriptions/{sub['id']}/status", json={"status": "trialing", "reason": "x y"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "INVALID_TRANSITION"
    r = client.post(f"/api/admin/subscriptions/{sub['id']}/cancel", json={"at_period_end": True, "reason": "Asked"})
    assert r.status_code == 200 and r.json()["cancel_at_period_end"] is True
    r = client.post(f"/api/admin/subscriptions/{sub['id']}/cancel", json={"reason": "Now please"})
    assert r.json()["status"] == "canceled"
    assert client.post(f"/api/admin/subscriptions/{sub['id']}/extend",
                       json={"days": 5, "reason": "Late"}).status_code == 409
    events = client.get("/api/admin/subscription-events", params={"subscription_id": sub["id"]}).json()["items"]
    kinds = [e["event_type"] for e in events]
    for k in ("created", "extended", "status.past_due", "cancel_scheduled", "canceled"):
        assert k in kinds
    assert all(e["actor_id"] is not None and e["reason"] for e in events)


def test_assign_replaces_current_subscription(client, db):
    learner = make_user(db, "l@example.com")
    _admin(client, db)
    a = client.post(f"/api/admin/users/{learner.id}/subscriptions",
                    json={"plan_key": "pro", "reason": "first"}).json()
    b = client.post(f"/api/admin/users/{learner.id}/subscriptions",
                    json={"plan_key": "premium", "reason": "upgrade"}).json()
    db.expire_all()
    assert db.get(UserSubscription, a["id"]).status == SubscriptionStatus.CANCELED
    assert db.get(UserSubscription, b["id"]).status == SubscriptionStatus.ACTIVE
    r = client.post(f"/api/admin/users/{learner.id}/subscriptions", json={"plan_key": "free", "reason": "down"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "PLAN_IS_DEFAULT"


def test_support_can_view_but_not_change_subscriptions(client, db):
    learner = make_user(db, "l@example.com")
    make_user(db, "s@example.com", ("user", "support"))
    login(client, "s@example.com")
    assert client.get("/api/admin/subscriptions").status_code == 200
    r = client.post(f"/api/admin/users/{learner.id}/subscriptions", json={"plan_key": "pro", "reason": "friend"})
    assert r.status_code == 403


def test_user_cannot_grant_themselves_a_plan(client, db):
    register(client)
    me = client.get("/api/auth/me").json()
    r = client.post(f"/api/admin/users/{me['id']}/subscriptions", json={"plan_key": "pro", "reason": "free stuff"})
    assert r.status_code == 403
    assert client.get("/api/subscription/me").json()["plan"]["key"] == "free"


def test_plan_management_and_validation(client, db):
    _admin(client, db)
    plans = {p["key"]: p for p in client.get("/api/admin/plans").json()}
    r = client.patch(f"/api/admin/plans/{plans['free']['id']}", json={"is_active": False, "reason": "oops"})
    assert r.status_code == 409
    r = client.patch(f"/api/admin/plans/{plans['free']['id']}", json={
        "entitlements": [{"feature_key": "assessment.full", "enabled": True, "limit_value": 5},
                         {"feature_key": "plan.personalized", "enabled": True}], "reason": "more generous"})
    assert r.status_code == 200
    ents = {e["feature_key"]: e for e in r.json()["entitlements"]}
    assert ents["assessment.full"]["limit_value"] == 5 and ents["practice.tasks"]["enabled"] is False
    r = client.post("/api/admin/plans", json={"key": "team", "name": "Team", "price_cents": 2500,
                                              "entitlements": [{"feature_key": "made.up", "enabled": True}]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNKNOWN_FEATURE"
    r = client.post("/api/admin/plans", json={"key": "team", "name": "Team", "price_cents": -1})
    assert r.status_code == 422
    r = client.post("/api/admin/plans", json={"key": "team", "name": "Team", "price_cents": 2500,
                                              "entitlements": [{"feature_key": "export.data", "enabled": True}]})
    assert r.status_code == 201 and r.json()["subscriber_count"] == 0


def test_data_export(client):
    register(client)
    r = client.get("/api/export/me")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["account"]["email"] == "learner@example.com"
    assert "password" not in json.dumps(data) and "password_hash" not in json.dumps(data)


# --- Payment webhooks ---------------------------------------------------------------------------------

@pytest.fixture
def payments_on(monkeypatch):
    monkeypatch.setenv("PAYMENT_PROVIDER", "testpay")
    monkeypatch.setenv("PAYMENT_WEBHOOK_SECRET", "whsec_test_123")
    get_settings.cache_clear()
    yield "whsec_test_123"
    get_settings.cache_clear()


def _post(client, body: dict, secret: str, ts: int | None = None, sig: str | None = None):
    raw = json.dumps(body).encode()
    header = sig or payments.sign(secret, raw, ts or int(time.time()))
    return client.post("/api/billing/webhooks/testpay", content=raw,
                       headers={"Content-Type": "application/json", "X-Isker-Signature": header})


def test_webhooks_refused_when_not_configured(client):
    r = client.post("/api/billing/webhooks/testpay", json={"id": "evt_1", "type": "subscription.activated"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "PAYMENTS_NOT_CONFIGURED"


def test_webhook_signature_is_verified(client, db, payments_on):
    learner = make_user(db, "l@example.com")
    body = {"id": "evt_1", "type": "subscription.activated",
            "data": {"user_id": learner.id, "plan_key": "pro", "reference": "sub_1"}}
    assert _post(client, body, "wrong-secret").status_code == 401
    assert _post(client, body, payments_on, ts=int(time.time()) - 3600).status_code == 401  # replay window
    assert _post(client, body, payments_on, sig="t=1,v1=deadbeef").status_code == 401
    assert db.query(UserSubscription).count() == 0  # nothing granted without a valid signature


def test_webhook_activation_is_idempotent(client, db, payments_on):
    learner = make_user(db, "l@example.com")
    body = {"id": "evt_1", "type": "subscription.activated",
            "data": {"user_id": learner.id, "plan_key": "pro", "reference": "sub_1",
                     "expires_at": (utcnow() + timedelta(days=30)).isoformat()}}
    r1 = _post(client, body, payments_on)
    r2 = _post(client, body, payments_on)
    assert r1.json() == {"status": "processed", "duplicate": False}
    assert r2.json()["duplicate"] is True
    assert db.query(UserSubscription).count() == 1
    assert db.query(PaymentWebhookEvent).count() == 1
    sub = db.query(UserSubscription).one()
    assert sub.source.value == "payment" and sub.provider == "testpay"
    # renewal and cancellation via later events
    r = _post(client, {"id": "evt_2", "type": "subscription.past_due", "data": {"reference": "sub_1"}}, payments_on)
    assert r.json()["status"] == "processed"
    r = _post(client, {"id": "evt_3", "type": "subscription.renewed",
                       "data": {"reference": "sub_1", "expires_at": (utcnow() + timedelta(days=60)).isoformat()}},
              payments_on)
    db.expire_all()
    assert db.query(UserSubscription).one().status == SubscriptionStatus.ACTIVE
    r = _post(client, {"id": "evt_4", "type": "something.else", "data": {}}, payments_on)
    assert r.json()["status"] == "ignored"
