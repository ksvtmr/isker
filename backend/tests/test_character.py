"""Character progression: stage rule, confirmed transitions, history, and protection against client-side changes."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import AIEvaluation, CharacterStageEvent, PracticalTask, SubscriptionPlan, User
from app.models.enums import AIEvalStatus, SubscriptionSource
from app.services import character as cs
from app.services import subscriptions as sub_service
from tests.conftest import OPEN_ANSWER, answer_all, onboard, register

WEAK = (
    "I am not sure what I would do here. Maybe I would ask a friend about it later and see what happens next time, "
    "it depends on the situation and on how I feel that day really."
)


def _progress(score: int | None, *, full: bool = True, assessed: int = 15, evidence: int = 15,
              practice: list[int] | None = None) -> cs.UserProgress:
    return cs.UserProgress(
        has_full_assessment=full, assessment_score=score, competencies_assessed=assessed, competencies_total=15,
        competencies_with_evidence=evidence, practice_scores=practice or [], latest_attempt_id=1,
    )


# --- pure rule ---

@pytest.mark.parametrize(
    ("score", "stage", "key"),
    [(0, 1, "novice"), (24, 1, "novice"), (25, 2, "starter"), (49, 2, "starter"),
     (50, 3, "entrepreneur"), (74, 3, "entrepreneur"), (75, 4, "leader"), (100, 4, "leader")],
)
def test_stage_boundaries(score, stage, key):
    r = cs.get_character_stage(_progress(score))
    assert (r.status, r.stage, r.key, r.score) == ("ready", stage, key, score)


def test_progress_to_next_stage():
    r = cs.get_character_stage(_progress(37))
    assert (r.stage, r.next_stage, r.points_to_next, r.progress_pct) == (2, 3, 13, 48)
    top = cs.get_character_stage(_progress(90))
    assert (top.stage, top.next_stage, top.points_to_next, top.progress_pct) == (4, None, None, 100)


def test_no_stage_before_first_full_assessment():
    assert cs.get_character_stage(_progress(None, full=False)).status == "no_assessment"
    # A score without a full assessment (impossible in the app, but not trusted) still gives no stage.
    r = cs.get_character_stage(_progress(60, full=False))
    assert (r.status, r.stage) == ("no_assessment", None)


def test_insufficient_data_is_not_a_stage():
    assert cs.get_character_stage(_progress(60, assessed=10)).status == "insufficient_data"
    assert cs.get_character_stage(_progress(60, evidence=5)).status == "insufficient_data"


def test_practice_counts_from_two_confirmed_tasks():
    one = cs.get_character_stage(_progress(70, practice=[100]))
    assert (one.score, one.stage, one.practice_counted) == (70, 3, False)
    two = cs.get_character_stage(_progress(70, practice=[100, 100]))
    assert (two.score, two.stage, two.practice_counted) == (76, 4, True)


def test_thresholds_are_configuration():
    assert [b[2] for b in cs.STAGE_BANDS] == [0, 25, 50, 75] and cs.STAGE_BANDS[-1][3] == 100
    assert cs.RULES_VERSION


# --- API ---

def _pro(db, email="learner@example.com"):
    user = db.scalar(select(User).where(User.email == email))
    plan = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.key == "premium"))
    sub_service.assign(db, user_id=user.id, plan=plan, actor_id=None, source=SubscriptionSource.ADMIN, reason="tests")
    db.commit()
    return user


def _assess(client, choice: int, text: str = OPEN_ANSWER) -> int:
    r = client.post("/api/assessments/attempts", json={"scope": "full"})
    assert r.status_code in (200, 201), r.text
    aid = r.json()["attempt"]["id"]
    answer_all(client, aid, choice_index=choice, text=text)
    r = client.post(f"/api/assessments/attempts/{aid}/submit")
    assert r.status_code == 200, r.text
    return aid


@pytest.fixture
def learner(client, db):
    register(client)
    onboard(client)
    return _pro(db)


def test_no_assessment_state(client, learner, db):
    c = client.get("/api/character").json()
    assert c["status"] == "no_assessment" and c["stage"] is None and c["history"] == []
    assert db.scalar(select(CharacterStageEvent.id)) is None


def test_first_assessment_records_initial_stage(client, learner):
    aid = _assess(client, 0, WEAK)
    c = client.get("/api/character").json()
    assert c["status"] == "ready" and c["stage"] == cs.band_for(c["score"])[0]
    assert c["score"] == c["assessment_score"]  # no practice yet
    [ev] = c["history"]
    assert (ev["direction"], ev["trigger"], ev["attempt_id"]) == ("initial", "assessment", aid)
    assert ev["rules_version"] == "stage-v1"
    assert c["pending_event"] is None  # the first stage is introduced, not congratulated
    assert c["basis"]["competencies_assessed"] == c["basis"]["competencies_total"] == 15


def test_dashboard_loads_never_create_transitions(client, learner, db):
    _assess(client, 0, WEAK)
    for _ in range(3):
        assert client.get("/api/character").status_code == 200
        assert client.get("/api/dashboard").status_code == 200
    assert len(db.scalars(select(CharacterStageEvent)).all()) == 1


def test_confirmed_improvement_moves_stage_and_is_shown_once(client, learner, db):
    _assess(client, 0, WEAK)
    low = client.get("/api/character").json()
    _assess(client, 9)
    c = client.get("/api/character").json()
    assert c["stage"] > low["stage"]
    ev = c["pending_event"]
    assert ev["direction"] == "up" and ev["previous_stage"] == low["stage"] and ev["stage"] == c["stage"]
    # Shown once: after acknowledging, a reload has nothing to congratulate.
    assert client.post(f"/api/character/events/{ev['id']}/seen").status_code == 200
    assert client.get("/api/character").json()["pending_event"] is None
    assert client.post(f"/api/character/events/{ev['id']}/seen").status_code == 200  # idempotent
    # History keeps the earlier stage untouched.
    hist = client.get("/api/character").json()["history"]
    assert [h["sequence"] for h in hist] == [1, 2] and hist[0]["stage"] == low["stage"]


def test_lower_result_is_recorded_neutrally_and_history_is_kept(client, learner, db):
    _assess(client, 9)
    high = client.get("/api/character").json()
    first = db.scalar(select(CharacterStageEvent))
    before = (first.stage, first.score, first.confirmed_at)
    _assess(client, 0, WEAK)
    c = client.get("/api/character").json()
    assert c["stage"] < high["stage"] and c["pending_event"]["direction"] == "down"
    db.expire_all()
    first = db.get(CharacterStageEvent, first.id)
    assert (first.stage, first.score, first.confirmed_at) == before


def test_learning_resources_alone_do_not_change_stage(client, learner):
    _assess(client, 1)
    before = client.get("/api/character").json()
    for r in client.get("/api/learning/resources").json()["items"][:5]:
        client.post(f"/api/learning/resources/{r['id']}/start")
        assert client.post(f"/api/learning/resources/{r['id']}/complete").status_code == 200
    after = client.get("/api/character").json()
    assert (after["score"], after["stage"]) == (before["score"], before["stage"])
    assert after["history"] == before["history"]


def _complete_task(client, task_id: int):
    client.post(f"/api/practice/tasks/{task_id}/start")
    r = client.post(f"/api/practice/tasks/{task_id}/submit", json={"response_text": OPEN_ANSWER})
    assert r.status_code == 200, r.text
    r = client.post(f"/api/practice/tasks/{task_id}/complete")
    assert r.status_code == 200, r.text


def test_confirmed_practice_counts_and_failed_ai_does_not(client, learner, db):
    _assess(client, 1)
    tasks = [t["id"] for t in client.get("/api/practice/tasks").json()[:3]]
    _complete_task(client, tasks[0])
    assert client.get("/api/character").json()["practice_counted"] is False  # one task is not enough
    _complete_task(client, tasks[1])
    c = client.get("/api/character").json()
    assert c["practice_counted"] is True and c["practice_tasks"] == 2
    # A failed AI call (heuristic fallback) is not a confirmed result.
    ev = db.scalar(
        select(AIEvaluation).where(AIEvaluation.practice_submission_id.is_not(None)).order_by(AIEvaluation.id)
    )
    ev.status = AIEvalStatus.FALLBACK
    db.commit()
    c = client.get("/api/character").json()
    assert c["practice_tasks"] == 1 and c["practice_counted"] is False


def test_unpublished_task_competency_is_ignored(client, learner, db):
    _assess(client, 1)
    tid = client.get("/api/practice/tasks").json()[0]["id"]
    _complete_task(client, tid)
    assert len(cs.confirmed_practice_scores(db, learner.id)) == 1
    task = db.get(PracticalTask, tid)
    task.competency.status = "archived"
    db.commit()
    assert cs.confirmed_practice_scores(db, learner.id) == []


def test_stage_cannot_be_set_from_the_client(client, learner):
    _assess(client, 0, WEAK)
    c = client.get("/api/character").json()
    for method in ("post", "put", "patch"):
        r = getattr(client, method)("/api/character", json={"stage": 4, "score": 100})
        assert r.status_code == 405
    ev = c["history"][0]["id"]
    r = client.post(f"/api/character/events/{ev}/seen", json={"stage": 4})
    assert r.status_code == 200
    assert client.get("/api/character").json()["stage"] == c["stage"]


def test_events_of_other_users_are_private(client, learner):
    _assess(client, 0, WEAK)
    ev = client.get("/api/character").json()["history"][0]["id"]
    client.cookies.clear()
    register(client, email="other@example.com")
    assert client.post(f"/api/character/events/{ev}/seen").status_code == 404
    assert client.get("/api/character").json()["history"] == []


def test_existing_profile_gets_a_silent_baseline(client, learner, db):
    _assess(client, 1)
    for e in db.scalars(select(CharacterStageEvent)):
        db.delete(e)
    db.commit()
    c = client.get("/api/character").json()
    [ev] = c["history"]
    assert ev["trigger"] == "baseline" and ev["seen"] is True and c["pending_event"] is None
    client.get("/api/character")
    assert len(db.scalars(select(CharacterStageEvent)).all()) == 1


def test_requires_sign_in(client):
    assert client.get("/api/character").status_code == 401
