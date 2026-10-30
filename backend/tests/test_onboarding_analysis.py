"""Initial-assessment onboarding, result versions and evidence, and the AI development analysis.

Providers here are test doubles (MOCKED): the deterministic MockAIProvider and small fakes that return chosen JSON or
raise provider errors. No network is used; live provider calls are verified separately (see
docs/testing/assessment-flow-test-results.md).
"""

from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import func, select

import app.ai.analysis as analysis_mod
from app.ai.providers import AIProvider, AIProviderError, GeminiProvider, MockAIProvider
from app.core.config import Settings
from app.models import AIAnalysis, AssessmentAttempt, Competency, CompetencyScore, QuestionCompetency
from app.models.enums import ContentStatus, QuestionType
from tests.conftest import answer_all, login, make_user, onboard, register

FAKE_KEY = "test-not-a-real-key-0000"


def complete_full(client) -> int:
    att_id = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
    answer_all(client, att_id)
    r = client.post(f"/api/assessments/attempts/{att_id}/submit")
    assert r.status_code == 200, r.text
    return att_id


def new_learner(client, email="learner@example.com") -> None:
    register(client, email=email)
    onboard(client)


class FakeProvider(AIProvider):
    """MOCKED provider returning fixed text (or raising) for analyze(); records what it was asked."""

    name, model = "fake", "fake-1"

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def evaluate(self, req):  # pragma: no cover - not used here
        raise AIProviderError("unused")

    def insight(self, req):  # pragma: no cover - not used here
        raise AIProviderError("unused")

    def analyze(self, req):
        self.requests.append(req)
        nxt = self.responses.pop(0) if self.responses else self.responses_last
        self.responses_last = nxt
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


def mock_output(facts: dict) -> str:
    return MockAIProvider().analyze(type("R", (), {"facts": facts})())


# --- Onboarding state -------------------------------------------------------------------------------------------------

def test_new_user_has_no_assessment_and_is_sent_to_it(client):
    new_learner(client)
    me = client.get("/api/auth/me").json()
    assert me["onboarding_completed"] is True
    assert me["initial_assessment_completed"] is False
    assert me["in_progress_attempt_id"] is None


def test_unfinished_attempt_is_resumable_with_saved_answers(client):
    new_learner(client)
    att = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]
    state = client.get(f"/api/assessments/attempts/{att['id']}").json()
    q = next(q for q in state["questions"] if q["options"])
    client.put(f"/api/assessments/attempts/{att['id']}/answers/{q['id']}",
               json={"option_id": q["options"][0]["id"], "position": q["index"]})
    # "Refresh" / come back later: a new session sees the same attempt and the saved answer.
    login(client, "learner@example.com")
    me = client.get("/api/auth/me").json()
    assert me["in_progress_attempt_id"] == att["id"] and me["initial_assessment_completed"] is False
    again = client.post("/api/assessments/attempts", json={"scope": "full"}).json()
    assert again["attempt"]["id"] == att["id"] and again["resumed"] is True
    saved = client.get(f"/api/assessments/attempts/{att['id']}", headers={"Accept-Language": "kk"}).json()
    kept = next(x for x in saved["answers"] if x["question_id"] == q["id"])
    assert kept["option_id"] == q["options"][0]["id"]  # same answer after switching to Kazakh


def test_completed_user_is_not_sent_back(client):
    new_learner(client)
    complete_full(client)
    login(client, "learner@example.com")
    me = client.get("/api/auth/me").json()
    assert me["initial_assessment_completed"] is True and me["in_progress_attempt_id"] is None


# --- Versions, language and evidence ----------------------------------------------------------------------------------

def test_attempt_records_versions_language_and_evidence(client, db):
    new_learner(client)
    att_id = client.post("/api/assessments/attempts", json={"scope": "full"},
                         headers={"Accept-Language": "ru"}).json()["attempt"]["id"]
    answer_all(client, att_id)
    r = client.post(f"/api/assessments/attempts/{att_id}/submit", headers={"Accept-Language": "kk"})
    assert r.status_code == 200
    att = db.get(AssessmentAttempt, att_id)
    assert att.assessment_version == 1 and att.scoring_version == "v1" and att.language == "kk"
    scores = list(db.scalars(select(CompetencyScore).where(CompetencyScore.attempt_id == att_id)))
    assert len(scores) == 15
    for s in scores:
        assert s.evidence and all({"question_id", "answer_id", "method", "item_score"} <= set(e) for e in s.evidence)
        assert s.evidence_level in ("sufficient", "limited", "insufficient")
    out = client.get(f"/api/assessments/attempts/{att_id}/results").json()
    assert all(c["evidence_level"] for c in out["profile"]["competencies"])


def test_every_competency_is_covered_with_demonstrated_evidence(db):
    """Each of the 15 published competencies has questions in the active assessment, at least one of which is not a
    self-rating (situational judgement or an applied open task)."""
    comps = list(db.scalars(select(Competency).where(Competency.status == ContentStatus.PUBLISHED)))
    assert len(comps) == 15
    for c in comps:
        types = {link.question.type for link in db.scalars(
            select(QuestionCompetency).where(QuestionCompetency.competency_id == c.id))
            if link.question.status == ContentStatus.PUBLISHED and link.question.is_active}
        assert types, c.code
        assert types & {QuestionType.SITUATIONAL, QuestionType.OPEN, QuestionType.PRACTICAL}, c.code


def test_different_scoring_method_is_not_compared(client, db):
    new_learner(client)
    first = complete_full(client)
    db.get(AssessmentAttempt, first).scoring_version = "v0"
    db.commit()
    second = complete_full(client)
    prof = client.get(f"/api/assessments/attempts/{second}/results").json()["profile"]
    assert prof["comparison"] == "method_changed" and prof["change"] is None
    assert all(c["change"] is None for c in prof["competencies"])
    trends = client.get("/api/progress").json()["trends"]
    assert all(t["change_since_previous"] is None and t["comparison"] == "method_changed" for t in trends)


def test_same_method_is_compared(client):
    new_learner(client)
    complete_full(client)
    second = complete_full(client)
    prof = client.get(f"/api/assessments/attempts/{second}/results").json()["profile"]
    assert prof["comparison"] == "same" and prof["change"] is not None


# --- AI development analysis ------------------------------------------------------------------------------------------

def test_analysis_lifecycle_is_idempotent_and_references_real_content(client, db):
    new_learner(client)
    att_id = complete_full(client)
    # Queued at submit; nothing has run yet.
    assert client.get(f"/api/assessments/attempts/{att_id}/analysis").json()["status"] == "pending"
    before = [(s.competency_id, s.score) for s in db.scalars(
        select(CompetencyScore).where(CompetencyScore.attempt_id == att_id))]
    r = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "completed" and body["rule_based"] is True and body["language"] == "en"
    a = body["analysis"]
    assert a["summary"] and a["development_areas"] and a["milestones"] and a["reassessment_weeks"]
    for act in a["recommended_actions"]:
        if act["kind"] == "learn":
            assert act["resource"] and act["resource"]["available"]
        if act["kind"] == "practice":
            assert act["task"] and act["task"]["available"]
    # Calling again neither runs nor duplicates anything; scores are untouched.
    again = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={}).json()
    assert again["runs"] == 1
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(AIAnalysis)) == 1
    after = [(s.competency_id, s.score) for s in db.scalars(
        select(CompetencyScore).where(CompetencyScore.attempt_id == att_id))]
    assert before == after


def test_analysis_only_for_owner_and_completed_attempts(client):
    new_learner(client)
    att_id = complete_full(client)
    open_id = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
    r = client.post(f"/api/assessments/attempts/{open_id}/analysis", json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "ATTEMPT_NOT_COMPLETED"
    new_learner(client, "other@example.com")
    assert client.get(f"/api/assessments/attempts/{att_id}/analysis").status_code == 404
    assert client.post(f"/api/assessments/attempts/{att_id}/analysis", json={}).status_code == 404


def test_invalid_output_fails_safely_then_retry_succeeds_without_duplicates(client, db, monkeypatch):
    new_learner(client)
    att_id = complete_full(client)
    bad_code = json.dumps({"summary": "x", "development_areas": [{"competency_code": "made-up", "explanation": "y",
                                                                 "priority": 1}], "reassessment_weeks": 6,
                           "language": "en"})
    fake = FakeProvider(["not json at all", bad_code])  # both tries invalid (AI_MAX_RETRIES=1 → 2 tries)
    monkeypatch.setattr(analysis_mod, "get_provider", lambda: fake)
    r = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={}).json()
    assert r["status"] == "failed" and r["error_code"] == "invalid_output" and r["analysis"] is None
    assert len(fake.requests) == 2
    monkeypatch.setattr(analysis_mod, "get_provider", lambda: MockAIProvider())
    r = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={}).json()
    assert r["status"] == "completed" and r["runs"] == 2
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(AIAnalysis)) == 1


@pytest.mark.parametrize("action", [
    {"kind": "learn", "resource_id": 999999, "task_id": None},  # resource not in the catalog
    {"kind": "practice", "resource_id": None, "task_id": None},  # practice without a task
    {"kind": "reflect", "resource_id": 1, "task_id": None},  # reflect must not link content
])
def test_unsupported_recommendations_are_rejected(client, monkeypatch, action):
    new_learner(client)
    att_id = complete_full(client)

    def provider():
        class P(FakeProvider):
            def analyze(self, req):
                out = json.loads(mock_output(req.facts))
                code = req.facts["competencies"][0]["code"]
                out["recommended_actions"] = [{"competency_code": code, "reason": "r", **action}]
                return json.dumps(out)
        return P([])

    monkeypatch.setattr(analysis_mod, "get_provider", provider)
    r = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={}).json()
    assert r["status"] == "failed" and r["error_code"] == "invalid_output"


def test_provider_errors_are_recoverable(client, monkeypatch):
    new_learner(client)
    att_id = complete_full(client)
    limited = AIProviderError("provider rate limit (HTTP 429)")
    monkeypatch.setattr(analysis_mod, "get_provider", lambda: FakeProvider([limited]))
    r = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={}).json()
    assert r["status"] == "failed" and r["error_code"] == "rate_limited"
    down = AIProviderError("network error: ReadTimeout")
    monkeypatch.setattr(analysis_mod, "get_provider", lambda: FakeProvider([down]))
    r = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={}).json()
    assert r["status"] == "failed" and r["error_code"] == "provider_unavailable"


def test_language_is_passed_and_checked(client, monkeypatch):
    new_learner(client)
    att_id = complete_full(client)
    kk = {"Accept-Language": "kk"}

    class EnglishAnyway(FakeProvider):
        def analyze(self, req):
            self.requests.append(req)
            out = json.loads(mock_output({**req.facts, "language": "en"}))
            out["language"] = "kk"  # claims Kazakh but writes English
            out["summary"] = "This is an English summary that is long enough to judge its script reliably."
            return json.dumps(out)

    fake = EnglishAnyway([])
    monkeypatch.setattr(analysis_mod, "get_provider", lambda: fake)
    r = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={}, headers=kk).json()
    assert r["status"] == "failed" and r["error_code"] == "wrong_language"
    assert all(req.facts["language"] == "kk" and "Kazakh" in req.system_prompt for req in fake.requests)
    monkeypatch.setattr(analysis_mod, "get_provider", lambda: MockAIProvider())
    r = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={}, headers=kk).json()
    assert r["status"] == "completed" and r["language"] == "kk"
    assert any("ә" in t or "қ" in t or "ғ" in t for t in [r["analysis"]["summary"]])  # ә қ ғ
    # Regenerate in Russian: same row, new language.
    r = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={"regenerate": True},
                    headers={"Accept-Language": "ru"}).json()
    assert r["status"] == "completed" and r["language"] == "ru" and r["runs"] == 3


def test_analysis_runs_are_rate_limited(client):
    new_learner(client)
    att_id = complete_full(client)
    codes = [client.post(f"/api/assessments/attempts/{att_id}/analysis", json={"regenerate": True}).status_code
             for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429


def test_facts_contain_answers_but_no_personal_data(client, db):
    new_learner(client)
    att_id = complete_full(client)
    from app.models import User

    user = db.scalar(select(User).where(User.email == "learner@example.com"))
    facts = analysis_mod.build_facts(db, user, db.get(AssessmentAttempt, att_id))
    dumped = json.dumps(facts, ensure_ascii=False)
    for private in ("learner@example.com", "Dana", "Small online shop", "CS student"):
        assert private not in dumped
    # The learner's own answers are there (question + chosen option or redacted text), each tied to competencies.
    ids = {a["answer_id"] for a in facts["answers"]}
    assert ids and all(a["question"] and a["response"] for a in facts["answers"])
    assert any("landing page" in a["response"] for a in facts["answers"])
    assert all(set(c["answer_ids"]) <= ids for c in facts["competencies"])


# --- Admin ------------------------------------------------------------------------------------------------------------

def test_admin_sees_and_retries_failed_analyses(client, db, monkeypatch):
    new_learner(client)
    att_id = complete_full(client)
    monkeypatch.setattr(analysis_mod, "get_provider", lambda: FakeProvider([AIProviderError("network error: X")]))
    client.post(f"/api/assessments/attempts/{att_id}/analysis", json={})
    # A learner can't use the admin endpoints.
    assert client.get("/api/admin/ai/analyses").status_code == 403
    make_user(db, "viewer@example.com", roles=("content_manager",))
    login(client, "viewer@example.com")
    listing = client.get("/api/admin/ai/analyses?status=failed").json()
    assert listing["counts"]["failed"] == 1 and listing["items"][0]["error_code"] == "provider_unavailable"
    assert "output" not in listing["items"][0]
    aid = listing["items"][0]["id"]
    assert client.post(f"/api/admin/ai/analyses/{aid}/retry").status_code == 403  # ai.view only
    make_user(db, "boss@example.com", roles=("admin",))
    login(client, "boss@example.com")
    monkeypatch.setattr(analysis_mod, "get_provider", lambda: MockAIProvider())
    r = client.post(f"/api/admin/ai/analyses/{aid}/retry").json()
    assert r["status"] == "completed"
    assert client.post(f"/api/admin/ai/analyses/{aid}/retry").status_code == 409


# --- Configuration and the Gemini adapter -----------------------------------------------------------------------------

def test_missing_key_is_a_configuration_error_not_a_silent_mock():
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        Settings(environment="test", mock_ai=False, ai_provider="gemini", gemini_api_key="", ai_api_key="")
    with pytest.raises(ValueError, match="no AI key"):
        Settings(environment="production", jwt_secret="x" * 40, email_backend="smtp", mock_ai=False,
                 openai_api_key="", gemini_api_key="", ai_api_key="")
    s = Settings(environment="test", mock_ai=False, ai_provider="gemini", ai_api_key=FAKE_KEY)
    assert s.resolved_ai_provider == "gemini" and s.ai_key("gemini") == FAKE_KEY


def test_api_key_is_never_returned(client, db, monkeypatch):
    from app.core import config

    monkeypatch.setenv("GEMINI_API_KEY", FAKE_KEY)
    config.get_settings.cache_clear()
    try:
        new_learner(client)
        assert FAKE_KEY not in client.get("/api/ai/status").text
        make_user(db, "boss@example.com", roles=("super_admin",))
        login(client, "boss@example.com")
        assert FAKE_KEY not in client.get("/api/admin/settings").text
    finally:
        config.get_settings.cache_clear()


def test_gemini_sends_key_in_header_only_and_hides_errors(monkeypatch):
    monkeypatch.setattr("app.ai.providers.time.sleep", lambda s: None)  # transport retries without waiting
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):  # MOCKED HTTP
        calls.append((url, headers, json))
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": '{"ok": 1}'}]}}]})

    monkeypatch.setattr("app.ai.providers.httpx.post", fake_post)
    p = GeminiProvider(FAKE_KEY, "gemini-test", "https://example.invalid/v1beta", 5)
    assert p.analyze(type("R", (), {"system_prompt": "s", "user_prompt": "u"})()) == '{"ok": 1}'
    url, headers, body = calls[0]
    assert FAKE_KEY not in url and headers["x-goog-api-key"] == FAKE_KEY
    assert body["generationConfig"]["responseMimeType"] == "application/json"

    for status, expected in ((429, "rate limit"), (403, "HTTP 403")):
        monkeypatch.setattr("app.ai.providers.httpx.post",
                            lambda *a, status=status, **k: httpx.Response(status, json={"error": FAKE_KEY}))
        with pytest.raises(AIProviderError) as e:
            p.analyze(type("R", (), {"system_prompt": "s", "user_prompt": "u"})())
        assert expected in str(e.value) and FAKE_KEY not in str(e.value)

    def timeout(*a, **k):
        raise httpx.ReadTimeout("timed out")

    monkeypatch.setattr("app.ai.providers.httpx.post", timeout)
    with pytest.raises(AIProviderError, match="network error"):
        p.analyze(type("R", (), {"system_prompt": "s", "user_prompt": "u"})())


def test_failed_regeneration_keeps_the_previous_analysis(client, monkeypatch):
    new_learner(client)
    att_id = complete_full(client)
    first = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={}).json()
    assert first["status"] == "completed" and first["language"] == "en"
    monkeypatch.setattr(analysis_mod, "get_provider", lambda: FakeProvider([AIProviderError("network error: X")]))
    r = client.post(f"/api/assessments/attempts/{att_id}/analysis", json={"regenerate": True},
                    headers={"Accept-Language": "ru"}).json()
    assert r["status"] == "completed" and r["error_code"] == "provider_unavailable"
    assert r["language"] == "en" and r["analysis"]["summary"] == first["analysis"]["summary"]


def test_rule_based_analysis_is_shown_in_the_readers_language(client):
    new_learner(client)
    att_id = complete_full(client)
    client.post(f"/api/assessments/attempts/{att_id}/analysis", json={}, headers={"Accept-Language": "ru"})
    r = client.get(f"/api/assessments/attempts/{att_id}/analysis", headers={"Accept-Language": "en"}).json()
    assert r["language"] == "en" and r["analysis"]["summary"].startswith("Your overall score")
    kk = client.get(f"/api/assessments/attempts/{att_id}/analysis", headers={"Accept-Language": "kk"}).json()
    assert kk["language"] == "kk" and "балыңыз" in kk["analysis"]["summary"]
