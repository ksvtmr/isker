"""Regression tests for the data-integrity, security and API-correctness audit findings (D1–D11, F2–F12)."""

from __future__ import annotations

import json
import time
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal, utcnow
from app.core.errors import ConflictError
from app.models import (
    AssessmentAttempt,
    AuditLog,
    Competency,
    CompetencyScore,
    EmailVerificationToken,
    LearningResource,
    OAuthIdentity,
    OAuthState,
    PasswordResetToken,
    PaymentWebhookEvent,
    PlanEntitlement,
    SubscriptionEvent,
    SubscriptionPlan,
    User,
    UserProfile,
    UserSession,
    UserSubscription,
)
from app.models.enums import AttemptScope, AttemptStatus, SubscriptionSource, SubscriptionStatus
from app.services import assessments as assessment_service
from app.services import maintenance, payments
from app.services import subscriptions as subs
from tests.conftest import answer_all, login, make_user, register

# --- helpers --------------------------------------------------------------------------------------------------


@pytest.fixture
def payments_on(monkeypatch):
    monkeypatch.setenv("PAYMENT_PROVIDER", "testpay")
    monkeypatch.setenv("PAYMENT_WEBHOOK_SECRET", "whsec_test_123")
    get_settings.cache_clear()
    yield "whsec_test_123"
    get_settings.cache_clear()


def _hook(client, secret: str, body: dict):
    raw = json.dumps(body).encode()
    return client.post("/api/billing/webhooks/testpay", content=raw,
                       headers={"Content-Type": "application/json",
                                "X-Isker-Signature": payments.sign(secret, raw, int(time.time()))})


def _plan(db: Session, key: str) -> SubscriptionPlan:
    return db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.key == key))


def _admin(client, db, email="admin@example.com", roles=("user", "admin")) -> User:
    u = make_user(db, email, roles)
    login(client, email)
    return u


# --- D1: payment webhooks ---------------------------------------------------------------------------------------


def test_renewal_after_lazy_expiry_reactivates_the_paid_subscription(client, db, payments_on):
    learner = make_user(db, "l@example.com")
    r = _hook(client, payments_on, {"id": "evt_1", "type": "subscription.activated",
                                    "data": {"user_id": learner.id, "plan_key": "pro", "reference": "sub_1",
                                             "expires_at": (utcnow() + timedelta(days=30)).isoformat()}})
    assert r.json()["status"] == "processed"
    sub = db.scalar(select(UserSubscription))
    sub.expires_at = utcnow() - timedelta(minutes=5)  # the period ended before the renewal webhook arrived
    db.commit()
    assert subs.expire_due(db) == 1  # lazy expiry on some read
    db.commit()
    assert sub.status == SubscriptionStatus.EXPIRED

    r = _hook(client, payments_on, {"id": "evt_2", "type": "subscription.renewed",
                                    "data": {"reference": "sub_1",
                                             "expires_at": (utcnow() + timedelta(days=30)).isoformat()}})
    assert r.status_code == 200 and r.json()["status"] == "processed"
    db.expire_all()
    sub = db.get(UserSubscription, sub.id)
    assert sub.status == SubscriptionStatus.ACTIVE and sub.ended_at is None
    assert subs.current_subscription(db, learner.id).id == sub.id
    events = [e.event_type for e in db.scalars(select(SubscriptionEvent).where(SubscriptionEvent.subscription_id
                                                                                == sub.id))]
    assert "reactivated" in events and "renewed" in events


def test_late_renewal_does_not_displace_a_newer_subscription(client, db, payments_on):
    learner = make_user(db, "l@example.com")
    _hook(client, payments_on, {"id": "evt_1", "type": "subscription.activated",
                                "data": {"user_id": learner.id, "plan_key": "pro", "reference": "sub_1",
                                         "expires_at": (utcnow() + timedelta(days=30)).isoformat()}})
    old = db.scalar(select(UserSubscription))
    old.expires_at = utcnow() - timedelta(minutes=5)
    db.commit()
    subs.expire_due(db)
    subs.assign(db, user_id=learner.id, plan=_plan(db, "premium"), actor_id=None, source=SubscriptionSource.ADMIN,
                reason="Scholarship")
    db.commit()
    r = _hook(client, payments_on, {"id": "evt_2", "type": "subscription.renewed",
                                    "data": {"reference": "sub_1",
                                             "expires_at": (utcnow() + timedelta(days=30)).isoformat()}})
    assert r.json()["status"] == "ignored"
    db.expire_all()
    assert db.get(UserSubscription, old.id).status == SubscriptionStatus.EXPIRED
    assert subs.current_subscription(db, learner.id).plan.key == "premium"


def test_non_numeric_user_id_is_422_and_recorded_as_failed_then_retry_succeeds(client, db, payments_on):
    learner = make_user(db, "l@example.com")
    bad = {"id": "evt_9", "type": "subscription.activated",
           "data": {"user_id": "abc", "plan_key": "pro", "reference": "sub_9"}}
    r = _hook(client, payments_on, bad)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_PAYLOAD"
    row = db.scalar(select(PaymentWebhookEvent))
    assert row.status == "failed" and "INVALID_PAYLOAD" in row.error
    assert db.scalar(select(UserSubscription)) is None  # nothing from the failed attempt was kept
    # The provider retries the same event (fixed): failed events are re-processed, not short-circuited.
    good = {**bad, "data": {**bad["data"], "user_id": learner.id}}
    r = _hook(client, payments_on, good)
    assert r.json() == {"status": "processed", "duplicate": False}
    db.expire_all()
    rows = list(db.scalars(select(PaymentWebhookEvent)))
    assert len(rows) == 1 and rows[0].status == "processed" and rows[0].error is None
    # …and from now on it is a normal duplicate.
    assert _hook(client, payments_on, good).json() == {"status": "processed", "duplicate": True}


# --- D2/D3: assessment attempts ---------------------------------------------------------------------------------


def _started_attempt(client) -> int:
    register(client)
    return client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]


def test_second_concurrent_submit_gets_409_instead_of_500(client):
    att_id = _started_attempt(client)
    answer_all(client, att_id)
    stale_db = SessionLocal()
    try:
        user = stale_db.scalar(select(User).where(User.email == "learner@example.com"))
        stale = assessment_service.get_attempt(stale_db, user, att_id)  # loaded while still in progress
        assert stale.status == AttemptStatus.IN_PROGRESS
        assert client.post(f"/api/assessments/attempts/{att_id}/submit").status_code == 200
        with pytest.raises(ConflictError) as e:
            assessment_service.submit(stale_db, user, stale)
        assert e.value.code == "ATTEMPT_NOT_IN_PROGRESS"
        stale_db.rollback()
    finally:
        stale_db.close()
    scores = SessionLocal()
    try:
        assert scores.query(CompetencyScore).filter(CompetencyScore.attempt_id == att_id).count() > 0
    finally:
        scores.close()


def test_api_double_submit_returns_409(client):
    att_id = _started_attempt(client)
    answer_all(client, att_id)
    assert client.post(f"/api/assessments/attempts/{att_id}/submit").status_code == 200
    r = client.post(f"/api/assessments/attempts/{att_id}/submit")
    assert r.status_code == 409 and r.json()["error"]["code"] == "ATTEMPT_NOT_IN_PROGRESS"


def test_only_one_in_progress_attempt_per_user_is_allowed_by_the_database(client, db):
    att_id = _started_attempt(client)
    first = db.get(AssessmentAttempt, att_id)
    db.add(AssessmentAttempt(user_id=first.user_id, assessment_id=first.assessment_id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_concurrent_start_resumes_the_attempt_that_won(client, db, monkeypatch):
    att_id = _started_attempt(client)
    user = db.scalar(select(User).where(User.email == "learner@example.com"))
    real = assessment_service.in_progress_attempt
    calls = {"n": 0}

    def racing(db_, user_id):  # the first lookup misses the attempt another request just created
        calls["n"] += 1
        return None if calls["n"] == 1 else real(db_, user_id)

    monkeypatch.setattr(assessment_service, "in_progress_attempt", racing)
    att, resumed = assessment_service.start_attempt(db, user, AttemptScope.FULL, None)
    db.commit()
    assert resumed and att.id == att_id
    assert db.query(AssessmentAttempt).filter(AssessmentAttempt.user_id == user.id).count() == 1


# --- D4: check-then-insert races --------------------------------------------------------------------------------


def test_concurrent_registration_with_the_same_email_is_409(client, monkeypatch):
    register(client, email="dup@example.com")
    client.cookies.clear()
    real = Session.scalar

    def miss_email_check(self, stmt, *a, **kw):  # the other request's row is not yet visible to the pre-check
        sql = str(stmt)
        if sql.startswith("SELECT users.id") and "users.email" in sql:
            return None
        return real(self, stmt, *a, **kw)

    monkeypatch.setattr(Session, "scalar", miss_email_check)
    r = client.post("/api/auth/register", json={"email": "dup@example.com", "password": "Secret123",
                                                "full_name": "Second Person", "accept_terms": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "EMAIL_TAKEN"


def test_lazy_profile_creation_tolerates_a_concurrent_creator(db):
    from app.api.routes import profile as profile_routes

    u = User(email="np@example.com", password_hash="", full_name="No Profile")
    db.add(u)
    db.commit()
    assert u.profile is None  # loaded as missing by this request
    other = SessionLocal()
    other.add(UserProfile(user_id=u.id, education="made by the other request"))
    other.commit()
    other.close()
    p = profile_routes._profile(db, u)
    db.commit()
    assert p.education == "made by the other request"
    assert db.query(UserProfile).filter(UserProfile.user_id == u.id).count() == 1


# --- D6: plan.personalized ---------------------------------------------------------------------------------------


def test_personalized_plan_entitlement_is_enforced(client, db):
    register(client)
    assert client.get("/api/plan").status_code == 200  # Free includes it
    assert client.get("/api/recommendations").status_code == 200
    ent = db.scalar(select(PlanEntitlement).join(SubscriptionPlan).where(
        SubscriptionPlan.key == "free", PlanEntitlement.feature_key == "plan.personalized"))
    ent.enabled = False
    db.commit()
    for method, path in (("get", "/api/plan"), ("get", "/api/recommendations"),
                         ("post", "/api/recommendations/regenerate")):
        r = getattr(client, method)(path)
        assert r.status_code == 403 and r.json()["error"]["code"] == "UPGRADE_REQUIRED", path
        assert r.json()["error"]["details"]["feature"] == "plan.personalized"


# --- D8: analytics -----------------------------------------------------------------------------------------------


def test_admin_grants_are_not_counted_as_paid(client, db, payments_on):
    learner = make_user(db, "l@example.com")
    payer = make_user(db, "p@example.com")
    subs.assign(db, user_id=learner.id, plan=_plan(db, "pro"), actor_id=None, source=SubscriptionSource.ADMIN,
                reason="Scholarship")
    db.commit()
    _admin(client, db)
    s = client.get("/api/admin/analytics/overview").json()["subscriptions"]
    assert s["paid_users"] == 0 and s["granted_free_of_charge"] == 1
    _hook(client, payments_on, {"id": "evt_1", "type": "subscription.activated",
                                "data": {"user_id": payer.id, "plan_key": "pro", "reference": "sub_p"}})
    s = client.get("/api/admin/analytics/overview").json()["subscriptions"]
    assert s["paid_users"] == 1 and s["granted_free_of_charge"] == 1


# --- D9: one current subscription, one default plan --------------------------------------------------------------


def test_database_allows_one_current_subscription_per_user(db):
    u = make_user(db, "l@example.com")
    pro = _plan(db, "pro")
    for _ in range(2):
        db.add(UserSubscription(user_id=u.id, plan_id=pro.id, status=SubscriptionStatus.ACTIVE,
                                source=SubscriptionSource.ADMIN))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    # Ended subscriptions don't count.
    db.add(UserSubscription(user_id=u.id, plan_id=pro.id, status=SubscriptionStatus.EXPIRED,
                            source=SubscriptionSource.ADMIN))
    db.add(UserSubscription(user_id=u.id, plan_id=pro.id, status=SubscriptionStatus.ACTIVE,
                            source=SubscriptionSource.ADMIN))
    db.commit()


def test_assign_twice_keeps_exactly_one_current_subscription(db):
    u = make_user(db, "l@example.com")
    for key in ("pro", "premium", "pro"):
        subs.assign(db, user_id=u.id, plan=_plan(db, key), actor_id=None, source=SubscriptionSource.ADMIN,
                    reason="change")
        db.commit()
    current = db.query(UserSubscription).filter(UserSubscription.user_id == u.id,
                                                UserSubscription.status.in_(subs.CURRENT)).all()
    assert len(current) == 1 and current[0].plan.key == "pro"


def test_database_allows_only_one_default_plan(db):
    _plan(db, "pro").is_default = True
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# --- D10: content deletes can't erase learner history -------------------------------------------------------------


def test_competency_with_scores_cannot_be_hard_deleted(client, db):
    att_id = _started_attempt(client)
    answer_all(client, att_id)
    assert client.post(f"/api/assessments/attempts/{att_id}/submit").status_code == 200
    comp_id = db.scalar(select(CompetencyScore.competency_id).where(CompetencyScore.attempt_id == att_id))
    with pytest.raises(IntegrityError):
        db.execute(Competency.__table__.delete().where(Competency.id == comp_id))
        db.commit()
    db.rollback()
    assert db.query(CompetencyScore).filter(CompetencyScore.attempt_id == att_id).count() > 0


def test_content_without_history_can_still_be_deleted(db):
    res = db.scalar(select(LearningResource))
    db.delete(res)
    db.commit()
    assert db.get(LearningResource, res.id) is None


def test_account_deletion_still_cascades_to_learner_history(client, db):
    att_id = _started_attempt(client)
    answer_all(client, att_id)
    client.post(f"/api/assessments/attempts/{att_id}/submit")
    u = db.scalar(select(User).where(User.email == "learner@example.com"))
    db.delete(u)
    db.commit()
    assert db.query(CompetencyScore).count() == 0 and db.query(AssessmentAttempt).count() == 0


# --- D11: admin plan nulls, Google link race, single-use state ----------------------------------------------------


@pytest.mark.parametrize("field", ["name", "price_cents", "currency", "is_active"])
def test_plan_patch_with_null_required_field_is_422(client, db, field):
    _admin(client, db)
    pid = _plan(db, "pro").id
    r = client.patch(f"/api/admin/plans/{pid}", json={field: None, "reason": "testing nulls"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_oauth_state_is_consumed_atomically_once(db):
    from app.services import google_oidc as google

    db.add(OAuthState(state_hash=google._hash("st"), nonce="n", code_verifier="v", mode="login", remember=False,
                      language="en", expires_at=utcnow() + timedelta(minutes=5)))
    db.commit()
    assert google.consume_state(db, "st", "st").used_at is not None
    db.commit()
    with pytest.raises(google.OAuthError):
        google.consume_state(db, "st", "st")
    db.rollback()


# --- F2: bearer tokens get the reuse check ------------------------------------------------------------------------


def test_superseded_cookie_token_replayed_as_bearer_revokes_the_session(client, db, monkeypatch):
    make_user(db, "r@example.com")
    login(client, "r@example.com")
    name = get_settings().auth_cookie_name
    first = client.cookies.get(name)
    monkeypatch.setattr(get_settings(), "token_rotate_minutes", -1)  # each cookie request rotates
    assert client.get("/api/auth/me").status_code == 200
    assert client.get("/api/auth/me").status_code == 200  # version 0 is now two rotations old
    monkeypatch.setattr(get_settings(), "token_rotate_minutes", 60)
    client.cookies.clear()
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {first}"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "SESSION_REVOKED"
    db.expire_all()
    assert db.scalar(select(UserSession)).revoked_at is not None


def test_bearer_only_clients_keep_working(raw_client):
    r = raw_client.post("/api/auth/register", json={"email": "api@example.com", "password": "Secret123",
                                                    "full_name": "Api Client", "accept_terms": True})
    token = r.json()["access_token"]
    raw_client.cookies.clear()
    for _ in range(3):
        assert raw_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


# --- F4: Google start rate limit and housekeeping ------------------------------------------------------------------


def test_google_start_is_rate_limited(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", "id.apps.googleusercontent.com")
    monkeypatch.setattr(s, "google_client_secret", "secret")
    codes = []
    for _ in range(32):
        r = client.get("/api/auth/google/start", follow_redirects=False, headers={"X-Forwarded-For": "203.0.113.7"})
        codes.append("oauth_error=RATE_LIMITED" in r.headers["location"])
    assert not codes[0] and codes[-1]


def test_purge_removes_dead_auth_rows_and_keeps_live_ones(db):
    u = make_user(db, "l@example.com")
    now = utcnow()
    old = now - timedelta(days=40)
    db.add_all([
        OAuthState(state_hash="a" * 64, nonce="n", code_verifier="v", mode="login", remember=False, language="en",
                   expires_at=now - timedelta(minutes=1)),
        OAuthState(state_hash="b" * 64, nonce="n", code_verifier="v", mode="login", remember=False, language="en",
                   expires_at=now + timedelta(minutes=5)),
        UserSession(id="old", user_id=u.id, expires_at=old, revoked_at=old),
        UserSession(id="live", user_id=u.id, expires_at=now + timedelta(days=1)),
        PasswordResetToken(user_id=u.id, token_hash="r1", expires_at=old),
        PasswordResetToken(user_id=u.id, token_hash="r2", expires_at=now + timedelta(minutes=30)),
        EmailVerificationToken(user_id=u.id, token_hash="v1", email=u.email, expires_at=old, used_at=old),
    ])
    db.commit()
    counts = maintenance.maybe_purge(force=True)
    assert counts == {"oauth_states": 1, "user_sessions": 1, "email_verification_tokens": 1,
                      "password_reset_tokens": 1}
    db.expire_all()
    assert [s.id for s in db.scalars(select(UserSession))] == ["live"]
    assert db.query(OAuthState).count() == 1 and db.query(PasswordResetToken).count() == 1


# --- F5: only failed sign-ins count per email ----------------------------------------------------------------------


def test_successful_logins_do_not_lock_out_an_email(client, db):
    make_user(db, "demo@example.com")
    for i in range(12):  # more than the per-email failure limit, from varying addresses
        r = client.post("/api/auth/login", json={"email": "demo@example.com", "password": "Secret123"},
                        headers={"X-Forwarded-For": f"198.51.100.{i}"})
        assert r.status_code == 200


def test_failed_logins_lock_the_email_for_that_client_only(client, db):
    make_user(db, "demo@example.com")
    attacker = {"X-Forwarded-For": "203.0.113.9"}
    for _ in range(8):
        r = client.post("/api/auth/login", json={"email": "demo@example.com", "password": "wrong-pass"},
                        headers=attacker)
        assert r.status_code == 401
    r = client.post("/api/auth/login", json={"email": "demo@example.com", "password": "Secret123"}, headers=attacker)
    assert r.status_code == 429
    r = client.post("/api/auth/login", json={"email": "demo@example.com", "password": "Secret123"},
                    headers={"X-Forwarded-For": "198.51.100.1"})
    assert r.status_code == 200


# --- F6: the public demo account is read-only for its credentials ---------------------------------------------------


def test_demo_account_credentials_and_status_cannot_be_changed(client, db):
    demo = make_user(db, get_settings().demo_email)
    login(client, demo.email)
    checks = [
        client.post("/api/auth/password", json={"current_password": "Secret123", "new_password": "Hijack123x"}),
        client.post("/api/auth/deactivate", json={"password": "Secret123"}),
        client.delete("/api/auth/google"),
    ]
    for r in checks:
        assert r.status_code == 403 and r.json()["error"]["code"] == "DEMO_ACCOUNT_READ_ONLY", r.text
    assert client.get("/api/auth/me").status_code == 200  # still signed in, still active
    login(client, demo.email)  # password unchanged


def test_demo_email_cannot_be_changed_by_staff(client, db):
    demo = make_user(db, get_settings().demo_email)
    _admin(client, db)
    r = client.patch(f"/api/admin/users/{demo.id}", json={"email": "mine@example.com", "reason": "takeover"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "DEMO_ACCOUNT_READ_ONLY"


# --- F8: staff email change ----------------------------------------------------------------------------------------


def test_staff_email_change_revokes_sessions_and_pending_reset_links(client, db):
    learner = make_user(db, "l@example.com")
    other = SessionLocal()
    other.add(PasswordResetToken(user_id=learner.id, token_hash="pending", expires_at=utcnow() + timedelta(hours=1)))
    other.add(UserSession(id="learner-session", user_id=learner.id, expires_at=utcnow() + timedelta(days=1)))
    other.commit()
    other.close()
    _admin(client, db)
    r = client.patch(f"/api/admin/users/{learner.id}", json={"email": "new@example.com", "reason": "typo fix"})
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(UserSession, "learner-session").revoked_at is not None
    assert db.scalar(select(PasswordResetToken)).used_at is not None
    row = db.scalar(select(AuditLog).where(AuditLog.action == "admin.user_updated").order_by(AuditLog.id.desc()))
    assert row.details["revoked_sessions"] == 1 and row.details["pending_links_invalidated"] == 1
    assert db.scalar(select(AuditLog).where(AuditLog.action == "admin.email_change_notified")) is not None


def test_staff_cannot_change_their_own_email_through_the_admin_endpoint(client, db):
    admin = _admin(client, db)
    r = client.patch(f"/api/admin/users/{admin.id}", json={"email": "me2@example.com", "reason": "my new email"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "SELF_ACTION_FORBIDDEN"


# --- F9: no self-granted plans --------------------------------------------------------------------------------------


def test_staff_cannot_assign_a_subscription_to_themselves(client, db):
    admin = _admin(client, db)
    r = client.post(f"/api/admin/users/{admin.id}/subscriptions", json={"plan_key": "pro", "reason": "for me"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "SELF_ACTION_FORBIDDEN"
    assert db.query(UserSubscription).count() == 0


# --- F10: last super admin --------------------------------------------------------------------------------------------


def test_last_super_admin_guard_still_applies(db):
    from app.services.permissions import assert_keeps_a_super_admin

    sa = make_user(db, "sa@example.com", ("user", "super_admin"))
    with pytest.raises(ConflictError) as e:
        assert_keeps_a_super_admin(db, sa, deactivating=True)
    assert e.value.code == "LAST_SUPER_ADMIN"


# --- F12: API docs ----------------------------------------------------------------------------------------------------


def test_api_docs_are_off_in_production_unless_enabled(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.setenv("ENVIRONMENT", "production")
    get_settings.cache_clear()
    try:
        assert get_settings().docs_enabled is False
        c = TestClient(create_app())
        assert c.get("/api/openapi.json").status_code == 404 and c.get("/api/docs").status_code == 404
        monkeypatch.setenv("API_DOCS_ENABLED", "true")
        get_settings.cache_clear()
        assert TestClient(create_app()).get("/api/openapi.json").status_code == 200
    finally:
        monkeypatch.delenv("API_DOCS_ENABLED", raising=False)
        monkeypatch.setenv("ENVIRONMENT", "test")
        get_settings.cache_clear()
    assert get_settings().docs_enabled is True


def test_oauth_identity_link_race_redirects_with_already_linked(client, db, monkeypatch):
    """A second Google link committed concurrently: the unique constraint fails our insert → redirect, not a 500."""
    from urllib.parse import parse_qs, urlparse

    from authlib.jose import JsonWebKey, KeySet

    from app.services import google_oidc as google
    from tests.test_google_oauth import CLIENT_ID, KEY, _callback, _error, _id_token

    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", CLIENT_ID)
    monkeypatch.setattr(s, "google_client_secret", "test-secret")
    monkeypatch.setattr(google, "google_keys", lambda: KeySet([JsonWebKey.import_key(KEY.as_dict(is_private=False))]))
    u = make_user(db, "linker@example.com")
    login(client, u.email)
    r = client.post("/api/auth/google/link")
    assert r.status_code == 200
    q = parse_qs(urlparse(r.json()["url"]).query)
    # Meanwhile another request linked a different Google account to this user.
    db.add(OAuthIdentity(user_id=u.id, provider="google", subject="g-other", email="other@example.com"))
    db.commit()
    resp = _callback(client, monkeypatch, q["state"][0], _id_token(q["nonce"][0], sub="g-mine"))
    assert resp.status_code == 302 and _error(resp) == "OAUTH_ALREADY_LINKED"
    assert db.query(OAuthIdentity).filter(OAuthIdentity.user_id == u.id).count() == 1
