"""Admin content editor ↔ learner platform: status lifecycle, question versioning, translations, optimistic locking."""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select
from sqlalchemy.orm.exc import StaleDataError

from app.core.database import SessionLocal
from app.models import (
    Answer,
    AuditLog,
    Competency,
    LearningResource,
    Question,
    Recommendation,
    UserLearningProgress,
)
from app.models.enums import ContentStatus
from tests.conftest import answer_all, login, make_user, onboard, register

RU = {"Accept-Language": "ru"}
KK = {"Accept-Language": "kk"}


def _cm(client, db, email: str = "cm@example.com") -> None:
    make_user(db, email, ("user", "content_manager"))
    login(client, email)


def _learner(client, email: str = "learner@example.com") -> None:
    client.cookies.clear()
    register(client, email=email)
    onboard(client)


def _complete_assessment(client) -> int:
    att = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
    answer_all(client, att)
    r = client.post(f"/api/assessments/attempts/{att}/submit")
    assert r.status_code == 200, r.text
    return att


NEW_COMP = {
    "code": "storytelling",
    "area_id": 1,
    "name": "Storytelling",
    "short_name": "Story",
    "description": "Telling the story of a venture so that others act on it.",
}


# --- Scenario 8: a new competency appears on the platform once published ------------------------------------


def test_new_competency_is_draft_until_published(client, db):
    _cm(client, db)
    r = client.post("/api/admin/competencies", json=NEW_COMP)
    assert r.status_code == 201, r.text
    comp = r.json()
    assert comp["status"] == "draft" and comp["lock_version"] == 1
    assert client.post("/api/admin/competencies", json=NEW_COMP).json()["error"]["code"] == "COMPETENCY_CODE_TAKEN"
    assert client.post("/api/admin/competencies", json={**NEW_COMP, "code": "x2", "area_id": 999}).status_code == 422

    _learner(client)
    codes = {c["code"] for c in client.get("/api/competencies").json()["competencies"]}
    assert "storytelling" not in codes and len(codes) == 15
    assert client.get("/api/competencies/storytelling").status_code == 404

    login(client, "cm@example.com")
    r = client.post(f"/api/admin/competencies/{comp['id']}/status",
                    json={"status": "published", "expected_version": comp["lock_version"]})
    assert r.status_code == 200 and r.json()["status"] == "published" and r.json()["lock_version"] == 2

    login(client, "learner@example.com")
    codes = {c["code"] for c in client.get("/api/competencies").json()["competencies"]}
    assert "storytelling" in codes
    assert client.get("/api/competencies/storytelling").status_code == 200


def test_competency_edit_is_used_by_the_platform_and_audited(client, db):
    _cm(client, db)
    comp = next(c for c in client.get("/api/admin/competencies").json() if c["code"] == "spotting")
    r = client.put(f"/api/admin/competencies/{comp['id']}", json={
        "description": "Spot and seize opportunities to create value for others.",
        "expected_version": comp["lock_version"]})
    assert r.status_code == 200, r.text
    log = db.scalar(select(AuditLog).where(AuditLog.action == "admin.competency_updated"))
    assert log.details["changes"]["description"]["to"].startswith("Spot and seize")
    assert set(log.details["changes"]) == {"description"}
    _learner(client)
    spotting = next(c for c in client.get("/api/competencies").json()["competencies"] if c["code"] == "spotting")
    assert spotting["description"] == "Spot and seize opportunities to create value for others."


def test_archived_competency_leaves_new_assessments_but_history_stays(client, db):
    _learner(client)
    _complete_assessment(client)
    _cm(client, db)
    comp = next(c for c in client.get("/api/admin/competencies").json() if c["code"] == "spotting")
    r = client.post(f"/api/admin/competencies/{comp['id']}/status", json={"status": "archived"})
    assert r.status_code == 200

    login(client, "learner@example.com")
    catalogue = {c["code"] for c in client.get("/api/competencies").json()["competencies"]}
    assert "spotting" not in catalogue
    # History: the profile still shows the measured score and the detail page still renders.
    profile = client.get("/api/scores/profile").json()
    assert any(c["code"] == "spotting" and c["score"] is not None for c in profile["competencies"])
    assert client.get("/api/competencies/spotting").status_code == 200
    # A new attempt no longer measures it, and it can't be reassessed on its own.
    att = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
    qids = {q["id"] for q in client.get(f"/api/assessments/attempts/{att}").json()["questions"]}
    only_spotting = {
        q.id for q in db.scalars(select(Question))
        if {link.competency_id for link in q.competency_links} == {comp["id"]}
    }
    assert only_spotting and not (qids & only_spotting)
    r = client.post("/api/assessments/attempts", json={"scope": "competency", "competency_id": comp["id"]})
    assert r.status_code == 422


# --- Scenario 9: archiving learning material ----------------------------------------------------------------


def test_archived_resource_disappears_but_progress_history_remains(client, db):
    _learner(client)
    res = client.get("/api/learning/resources", params={"page_size": 100}).json()["items"]
    rid = res[0]["id"]
    assert client.post(f"/api/learning/resources/{rid}/complete").status_code == 200

    _cm(client, db)
    assert client.delete(f"/api/admin/resources/{rid}").status_code == 200
    admin_row = next(r for r in client.get("/api/admin/resources").json() if r["id"] == rid)
    assert admin_row["status"] == "archived" and admin_row["is_published"] is False

    login(client, "learner@example.com")
    ids = {r["id"] for r in client.get("/api/learning/resources", params={"page_size": 100}).json()["items"]}
    assert rid not in ids and len(ids) == len(res) - 1
    # The learner who completed it can still open it; nothing new can be started on it.
    assert client.get(f"/api/learning/resources/{rid}").status_code == 200
    assert client.post(f"/api/learning/resources/{rid}/start").status_code == 404
    assert db.scalar(select(UserLearningProgress).where(UserLearningProgress.resource_id == rid)) is not None
    assert any(item["title"] == admin_row["title"] for item in client.get("/api/progress").json()["recent"])

    _learner(client, "other@example.com")
    assert client.get(f"/api/learning/resources/{rid}").status_code == 404


def test_archived_resources_and_tasks_are_never_recommended(client, db):
    with SessionLocal() as s:
        for r in s.scalars(select(LearningResource)).all()[::2]:
            r.set_status(ContentStatus.ARCHIVED)
        s.commit()
        archived = {r.id for r in s.scalars(select(LearningResource).where(
            LearningResource.status == ContentStatus.ARCHIVED))}
    _learner(client)
    _complete_assessment(client)
    recs = db.scalars(select(Recommendation)).all()
    assert recs and not any(r.resource_id in archived for r in recs)


def test_unpublished_task_is_hidden_and_draft_resource_is_published_later(client, db):
    _cm(client, db)
    comp = client.get("/api/admin/competencies").json()[0]
    body = {"slug": "draft-res", "competency_id": comp["id"], "title": "Draft resource", "type": "article",
            "description": "A useful description", "difficulty": "beginner", "duration_minutes": 5,
            "content": "Some content that is long enough.", "status": "draft"}
    r = client.post("/api/admin/resources", json=body).json()
    assert r["status"] == "draft" and r["is_published"] is False
    task = client.get("/api/admin/tasks").json()[0]
    hidden = client.post(f"/api/admin/tasks/{task['id']}/status", json={"status": "draft"}).json()
    assert hidden["is_published"] is False

    _learner(client)
    titles = {x["title"] for x in client.get("/api/learning/resources", params={"page_size": 100}).json()["items"]}
    assert "Draft resource" not in titles
    assert task["id"] not in {t["id"] for t in client.get("/api/practice/tasks").json()}
    assert client.get(f"/api/practice/tasks/{task['id']}").status_code == 404

    login(client, "cm@example.com")
    client.post(f"/api/admin/resources/{r['id']}/status", json={"status": "published"})
    login(client, "learner@example.com")
    titles = {x["title"] for x in client.get("/api/learning/resources", params={"page_size": 100}).json()["items"]}
    assert "Draft resource" in titles


def test_older_clients_sending_only_is_published_still_work(client, db):
    _cm(client, db)
    r = client.get("/api/admin/resources").json()[0]
    body = {k: r[k] for k in ("slug", "competency_id", "title", "description", "type", "difficulty",
                              "duration_minutes", "content", "url")}
    out = client.put(f"/api/admin/resources/{r['id']}", json={**body, "is_published": False}).json()
    assert out["status"] == "draft" and out["is_published"] is False
    out = client.put(f"/api/admin/resources/{r['id']}", json={**body, "is_published": True}).json()
    assert out["status"] == "published"


# --- Question versioning: past results never change ----------------------------------------------------------


def _question_body(q: dict, **over) -> dict:
    return {
        "assessment_id": q["assessment_id"], "type": q["type"], "section": q["section"], "text": q["text"],
        "help_text": q["help_text"], "reverse_scored": q["reverse_scored"], "min_length": q["min_length"],
        "options": [{"label": o["label"], "score": o["score"], "value": o["value"]} for o in q["options"]],
        "competencies": q["competencies"], "rubric": q["rubric"], "expected_version": q["lock_version"], **over,
    }


def test_editing_an_answered_question_creates_a_new_version(client, db):
    _learner(client)
    att = _complete_assessment(client)
    before = client.get(f"/api/assessments/attempts/{att}/results").json()

    _cm(client, db)
    q = next(x for x in client.get("/api/admin/questions").json() if x["type"] == "situational")
    assert q["answer_count"] == 1 and q["version"] == 1
    flipped = [{"label": o["label"], "score": 100 - o["score"], "value": o["value"]} for o in q["options"]]
    r = client.put(f"/api/admin/questions/{q['id']}",
                   json=_question_body(q, text="A reworded situation: what do you do next?", options=flipped))
    assert r.status_code == 200, r.text
    new = r.json()
    assert new["id"] != q["id"] and new["replaced_id"] == q["id"] and new["previous_id"] == q["id"]
    assert new["version"] == 2 and new["status"] == "published" and new["answer_count"] == 0
    old = next(x for x in client.get("/api/admin/questions").json() if x["id"] == q["id"])
    assert old["status"] == "archived" and old["text"] == q["text"]
    assert [o["score"] for o in old["options"]] == [o["score"] for o in q["options"]]
    assert db.scalar(select(AuditLog).where(AuditLog.action == "admin.question_versioned")).details["replaced_id"] \
        == q["id"]

    login(client, "learner@example.com")
    after = client.get(f"/api/assessments/attempts/{att}/results").json()
    assert after["profile"]["overall"] == before["profile"]["overall"]
    assert after["profile"]["competencies"] == before["profile"]["competencies"]
    state = client.get(f"/api/assessments/attempts/{att}").json()
    assert q["id"] in {x["id"] for x in state["questions"]} and new["id"] not in {x["id"] for x in state["questions"]}

    # New attempts use the new version.
    new_att = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]
    ids = {x["id"] for x in client.get(f"/api/assessments/attempts/{new_att['id']}").json()["questions"]}
    assert new["id"] in ids and q["id"] not in ids and new_att["total"] == 30


def test_unanswered_question_is_edited_in_place(client, db):
    _cm(client, db)
    q = client.get("/api/admin/questions").json()[0]
    r = client.put(f"/api/admin/questions/{q['id']}", json=_question_body(q, text="An edited question text here."))
    assert r.status_code == 200 and r.json()["id"] == q["id"] and r.json()["version"] == 1
    assert r.json()["lock_version"] == q["lock_version"] + 1
    # Saving the same content again changes nothing.
    again = client.put(f"/api/admin/questions/{q['id']}", json=_question_body(r.json()))
    assert again.status_code == 422 and again.json()["error"]["code"] == "NO_CHANGES"


def test_in_progress_attempt_keeps_the_version_it_answered(client, db):
    _learner(client)
    att = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
    first = client.get(f"/api/assessments/attempts/{att}").json()["questions"][0]
    client.put(f"/api/assessments/attempts/{att}/answers/{first['id']}",
               json={"option_id": first["options"][0]["id"], "position": 0})

    _cm(client, db)
    q = next(x for x in client.get("/api/admin/questions").json() if x["id"] == first["id"])
    new = client.put(f"/api/admin/questions/{q['id']}", json=_question_body(q, text="A new wording for question one."))
    assert new.json()["id"] != q["id"]

    login(client, "learner@example.com")
    state = client.get(f"/api/assessments/attempts/{att}").json()
    assert state["questions"][0]["id"] == first["id"] and len(state["questions"]) == 30
    answer_all(client, att)
    assert client.post(f"/api/assessments/attempts/{att}/submit").status_code == 200
    assert db.scalar(select(Answer).where(Answer.question_id == first["id"])) is not None


def test_archived_question_is_not_in_new_attempts(client, db):
    _cm(client, db)
    q = client.get("/api/admin/questions").json()[0]
    assert client.delete(f"/api/admin/questions/{q['id']}").status_code == 200
    _learner(client)
    att = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]
    assert att["total"] == 29
    ids = {x["id"] for x in client.get(f"/api/assessments/attempts/{att['id']}").json()["questions"]}
    assert q["id"] not in ids
    assert client.get("/api/assessments").json()["assessment"]["question_count"] == 29


# --- Scenario 10: translations ------------------------------------------------------------------------------


def test_translation_edits_show_in_the_chosen_language(client, db):
    _cm(client, db)
    r = client.get("/api/admin/resources").json()[0]
    body = {k: r[k] for k in ("slug", "competency_id", "title", "description", "type", "difficulty",
                              "duration_minutes", "content", "url")}
    tr = {"ru": {"title": "Новое название", "description": "  "}, "kk": {"title": "Жаңа атау"}}
    out = client.put(f"/api/admin/resources/{r['id']}",
                     json={**body, "translations": tr, "expected_version": r["lock_version"]}).json()
    # Empty texts are dropped; the admin editor keeps working on the English base text.
    assert out["translations"]["ru"] == {"title": "Новое название"} and out["title"] == r["title"]

    _learner(client)
    assert client.get(f"/api/learning/resources/{r['id']}", headers=RU).json()["title"] == "Новое название"
    assert client.get(f"/api/learning/resources/{r['id']}", headers=KK).json()["title"] == "Жаңа атау"
    assert client.get(f"/api/learning/resources/{r['id']}").json()["title"] == r["title"]


def test_competency_and_question_translations(client, db):
    _cm(client, db)
    comp = next(c for c in client.get("/api/admin/competencies").json() if c["code"] == "spotting")
    tr = {**comp["translations"], "kk": {**comp["translations"]["kk"], "name": "Мүмкіндікті көру"}}
    r = client.put(f"/api/admin/competencies/{comp['id']}", json={"translations": tr})
    assert r.status_code == 200, r.text
    q = next(x for x in client.get("/api/admin/questions").json() if x["type"] == "open")
    rubric_tr = [{"criterion": "Критерий", "keywords": ["гипотеза"]}]
    r = client.put(f"/api/admin/questions/{q['id']}", json=_question_body(
        q, translations={"ru": {"text": "Новый текст вопроса", "rubric": rubric_tr}}))
    assert r.status_code == 200, r.text
    assert r.json()["translations"]["ru"]["rubric"] == rubric_tr

    _learner(client)
    names = {c["code"]: c["name"] for c in client.get("/api/competencies", headers=KK).json()["competencies"]}
    assert names["spotting"] == "Мүмкіндікті көру"
    att = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
    texts = {x["id"]: x["text"] for x in client.get(f"/api/assessments/attempts/{att}", headers=RU).json()["questions"]}
    assert texts[q["id"]] == "Новый текст вопроса"


@pytest.mark.parametrize("bad", [
    {"de": {"title": "Titel"}},
    {"en": {"title": "Title"}},
    {"ru": {"slug": "x"}},
    {"ru": {"title": 5}},
    {"ru": "Название"},
])
def test_invalid_translations_are_refused(client, db, bad):
    _cm(client, db)
    r = client.get("/api/admin/resources").json()[0]
    body = {k: r[k] for k in ("slug", "competency_id", "title", "description", "type", "difficulty",
                              "duration_minutes", "content", "url")}
    res = client.put(f"/api/admin/resources/{r['id']}", json={**body, "translations": bad})
    assert res.status_code == 422 and res.json()["error"]["code"] in ("INVALID_TRANSLATIONS", "VALIDATION_ERROR")


# --- Scenarios 11 & 12: reload keeps changes, concurrent edits never overwrite silently ---------------------------


def test_two_admins_editing_the_same_resource(client, db):
    make_user(db, "a@example.com", ("user", "content_manager"))
    make_user(db, "b@example.com", ("user", "content_manager"))
    login(client, "a@example.com")
    r = client.get("/api/admin/resources").json()[0]
    body = {k: r[k] for k in ("slug", "competency_id", "title", "description", "type", "difficulty",
                              "duration_minutes", "content", "url")}
    seen = r["lock_version"]
    ok = client.put(f"/api/admin/resources/{r['id']}", json={**body, "title": "Title by A", "expected_version": seen})
    assert ok.status_code == 200 and ok.json()["lock_version"] == seen + 1

    login(client, "b@example.com")
    stale = client.put(f"/api/admin/resources/{r['id']}",
                       json={**body, "title": "Title by B", "expected_version": seen})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "VERSION_CONFLICT"
    assert stale.json()["error"]["details"]["current_version"] == seen + 1
    # Reloading shows A's saved state; B can then apply the change on top of it.
    fresh = next(x for x in client.get("/api/admin/resources").json() if x["id"] == r["id"])
    assert fresh["title"] == "Title by A"
    again = client.put(f"/api/admin/resources/{r['id']}",
                       json={**body, "title": "Title by B", "expected_version": fresh["lock_version"]})
    assert again.status_code == 200 and again.json()["title"] == "Title by B"


@pytest.mark.parametrize("entity", ["competencies", "questions", "tasks", "resources"])
def test_stale_status_change_is_refused(client, db, entity):
    _cm(client, db)
    row = client.get(f"/api/admin/{entity}").json()[0]
    r = client.post(f"/api/admin/{entity}/{row['id']}/status",
                    json={"status": "archived", "expected_version": row["lock_version"] + 5})
    assert r.status_code == 409 and r.json()["error"]["code"] == "VERSION_CONFLICT"


def test_plan_edit_with_a_stale_version_is_refused(client, db):
    make_user(db, "admin@example.com", ("user", "super_admin"))
    login(client, "admin@example.com")
    plan = next(p for p in client.get("/api/admin/plans").json() if p["key"] == "pro")
    ok = client.patch(f"/api/admin/plans/{plan['id']}", json={
        "name": "Pro+", "reason": "rename", "expected_version": plan["lock_version"],
        "translations": {"ru": {"name": "Про+"}}})
    assert ok.status_code == 200 and ok.json()["lock_version"] == plan["lock_version"] + 1
    assert ok.json()["translations"]["ru"]["name"] == "Про+"
    stale = client.patch(f"/api/admin/plans/{plan['id']}", json={
        "name": "Pro 2", "reason": "rename", "expected_version": plan["lock_version"]})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "VERSION_CONFLICT"
    log = db.scalar(select(AuditLog).where(AuditLog.action == "admin.plan_updated"))
    assert log.details["changes"]["name"] == {"from": plan["name"], "to": "Pro+"}


def test_concurrent_writes_raise_stale_data_and_map_to_409():
    first, second = SessionLocal(), SessionLocal()
    try:
        a = first.scalar(select(Competency).where(Competency.code == "spotting"))
        b = second.scalar(select(Competency).where(Competency.code == "spotting"))
        a.name = "First writer"
        first.commit()
        b.name = "Second writer"
        with pytest.raises(StaleDataError):
            second.commit()
    finally:
        first.close()
        second.close()
    from app.main import app

    response = asyncio.run(app.exception_handlers[StaleDataError](None, StaleDataError()))
    assert response.status_code == 409 and b"VERSION_CONFLICT" in response.body


# --- Scenario 14: only content managers edit content ------------------------------------------------------------


@pytest.mark.parametrize("roles", [("user",), ("user", "support")])
def test_users_without_content_permission_cannot_edit_content(client, db, roles):
    make_user(db, "staff@example.com", roles)
    login(client, "staff@example.com")
    comp = db.scalar(select(Competency))
    res = db.scalar(select(LearningResource))
    assert client.post("/api/admin/competencies", json=NEW_COMP).status_code == 403
    assert client.put(f"/api/admin/competencies/{comp.id}", json={"name": "Hacked"}).status_code == 403
    assert client.post(f"/api/admin/resources/{res.id}/status", json={"status": "archived"}).status_code == 403
    assert client.delete(f"/api/admin/resources/{res.id}").status_code == 403
    db.expire_all()
    assert db.get(LearningResource, res.id).status == ContentStatus.PUBLISHED
    assert db.get(Competency, comp.id).name != "Hacked"


def test_content_manager_cannot_manage_users_or_plans(client, db):
    target = make_user(db, "target@example.com")
    _cm(client, db)
    assert client.post(f"/api/admin/users/{target.id}/suspend", json={"reason": "nope"}).status_code == 403
    plan = db.scalar(select(Competency))  # any id; the permission check comes first
    assert client.patch(f"/api/admin/plans/{plan.id}", json={"name": "X", "reason": "nope"}).status_code == 403


def test_archived_step_of_an_active_plan_can_still_be_completed(client, db):
    # Regression (audit D5): archiving a resource/task that is already a step of a learner's active plan used to
    # make that step impossible to finish, which kept the plan's reassessment locked until a new full assessment.
    _learner(client)
    _complete_assessment(client)
    rec = client.get("/api/recommendations").json()[0]
    rid, tid = rec["resource"]["id"], rec["task"]["id"]

    _cm(client, db)
    assert client.delete(f"/api/admin/resources/{rid}").status_code == 200
    assert client.delete(f"/api/admin/tasks/{tid}").status_code == 200

    login(client, "learner@example.com")
    listed = client.get("/api/learning/resources", params={"page_size": 100}).json()["items"]
    assert rid not in {r["id"] for r in listed}
    assert client.post(f"/api/learning/resources/{rid}/start").status_code == 200
    assert client.post(f"/api/learning/resources/{rid}/complete").status_code == 200
    assert client.post(f"/api/practice/tasks/{tid}/start").status_code == 200

    # Someone without it in their plan still can't start it.
    _learner(client, "other@example.com")
    assert client.post(f"/api/learning/resources/{rid}/start").status_code == 404
