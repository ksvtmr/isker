"""Regression tests for the dynamic-content and AI localization audit (H1–H5, M1–M6, Q3, L1, D4)."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import delete, select

from app.ai.providers import AIProvider, heuristic_evaluation, keyword_hits, tokens
from app.ai.service import evaluate_text, generate_insight, rubric_score, script_share
from app.core import i18n
from app.core.content_i18n import base_language, match_ratings, rubric_aliases, translation_status
from app.core.context import content_localization_var, language_var
from app.core.middleware import localizes_content
from app.models import (
    AIEvaluation,
    Competency,
    LearningActivity,
    LearningResource,
    PlanEntitlement,
    PracticalTask,
    Question,
    Recommendation,
    SubscriptionPlan,
    UserLearningProgress,
)
from app.models.enums import AIEvalStatus, AIInputType
from tests.conftest import answer_all, login, make_user, onboard, register

RU = {"Accept-Language": "ru"}
KK = {"Accept-Language": "kk"}
EN = {"Accept-Language": "en"}

RUBRIC = [
    {"criterion": "Customer evidence", "description": "d", "keywords": ["customer", "interview"]},
    {"criterion": "Low-cost methods", "description": "d", "keywords": ["free", "cheap"]},
]


@pytest.fixture
def lang():
    tokens_ = []

    def set_lang(value: str) -> None:
        tokens_.append(language_var.set(value))

    yield set_lang
    for t in reversed(tokens_):
        language_var.reset(t)


def _learner_with_profile(client, goals=None) -> int:
    register(client)
    onboard(client, goals)
    a = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
    answer_all(client, a)
    r = client.post(f"/api/assessments/attempts/{a}/submit")
    assert r.status_code == 200, r.text
    return a


def _admin(client, db):
    make_user(db, "admin@example.com", roles=("user", "super_admin"))
    login(client, "admin@example.com")


# --- tr() fallback chain ------------------------------------------------------------------------------------------


def test_catalog_falls_back_kk_to_ru_to_en(lang, monkeypatch):
    monkeypatch.setitem(i18n.CATALOG, "x.only_ru", {"ru": "Только по-русски", "en": "English only"})
    monkeypatch.setitem(i18n.CATALOG, "x.only_en", {"en": "English only"})
    lang("kk")
    assert i18n.tr("x.only_ru") == "Только по-русски"
    assert i18n.tr("x.only_en") == "English only"
    lang("ru")
    assert i18n.tr("x.only_en") == "English only"


# --- H5 / M1: tokenizer and keyword matching -----------------------------------------------------------------------


def test_kazakh_letters_are_part_of_words():
    assert tokens("Әлеуметтік әсер, ең маңызды Ңң") == ["әлеуметтік", "әсер", "ең", "маңызды", "ңң"]
    assert tokens("Ёлка и еж") == ["елка", "и", "еж"]


def test_keywords_count_distinct_words_and_match_word_starts_only():
    # Russian and Kazakh stems that both match the same word count once.
    assert keyword_hits("Клиенттермен сөйлестім", ["клиент", "клиенттер", "сөйлес"]) == 2
    # A stem inside a word does not match ("тест" in "протестировать").
    assert keyword_hits("Мы будем протестировать", ["тест"]) == 0
    # Repeating a word adds nothing.
    assert keyword_hits("customer customer customer", ["customer"]) == 1
    # Phrases match consecutive words; symbol keywords match as text.
    assert keyword_hits("Кері байланыс алдым, 20 %", ["кері байланыс", "%"]) == 2


def test_common_kazakh_function_words_are_not_keywords():
    from app.seed.translations import KEYWORDS

    kk = {k for entry in KEYWORDS.values() for k in entry["kk"]}
    assert not kk & {"олардың", "қайта", "пайда", "бар ресурс", "болады", "кейін", "жоқ", "кім", "біз"}


# --- M2: criterion matching ----------------------------------------------------------------------------------------


def test_rubric_score_normalizes_names():
    criteria = [{"criterion": "  CUSTOMER   evidence ", "rating": 4}, {"criterion": "low-cost methods", "rating": 2}]
    assert rubric_score(criteria, RUBRIC) == 75


def test_stored_ratings_are_matched_by_name_in_any_language_then_position():
    translations = {"ru": {"rubric": [{"criterion": "Данные от клиентов"}, {"criterion": "Недорогие методы"}]}}
    aliases = rubric_aliases(RUBRIC, translations)
    # Russian names in the reverse order are still matched to the right criteria.
    stored = [{"criterion": "Недорогие методы", "rating": 1}, {"criterion": "данные от клиентов", "rating": 4}]
    assert match_ratings(stored, aliases) == [4, 1]
    # Unknown names fall back to their position.
    assert match_ratings([{"criterion": "x", "rating": 3}, {"criterion": "y", "rating": 2}], aliases) == [3, 2]


# --- H4: language of real-model output -----------------------------------------------------------------------------


class Scripted(AIProvider):
    name, model = "scripted", "scripted-1"

    def __init__(self, replies, insights=()):
        self.replies, self.insights, self.prompts = list(replies), list(insights), []

    def evaluate(self, req):
        self.prompts.append(req.user_prompt)
        return self.replies.pop(0)

    def insight(self, req):
        self.prompts.append(req.user_prompt)
        return self.insights.pop(0)


def _reply(explanation: str) -> str:
    return json.dumps({
        "competency": "Valuing Ideas", "score": 50, "level": "", "confidence": 0.8,
        "criteria": [{"criterion": c["criterion"], "rating": 3, "evidence": ""} for c in RUBRIC],
        "evidence": [], "strengths": [], "development_areas": [], "explanation": explanation,
    })


EN_TEXT = "The answer describes customer interviews and a free landing page clearly and with good detail."
RU_TEXT = "Ответ ясно описывает интервью с клиентами и бесплатный лендинг, с хорошими подробностями."


def _evaluate(db, provider):
    return evaluate_text(
        db, user_id=None, competency_id=None, competency_name="Valuing Ideas", question="Q",
        answer="I would interview customers and use a free landing page.", rubric=RUBRIC,
        input_type=AIInputType.OPEN_ANSWER, provider=provider,
    )


def test_script_share():
    assert script_share([RU_TEXT], "ru") > 0.9
    assert script_share([EN_TEXT], "ru") == 0
    assert script_share(["OK"], "ru") is None  # too short to judge


def test_wrong_language_output_is_retried_with_the_language_instruction(db, lang):
    lang("ru")
    p = Scripted([_reply(EN_TEXT), _reply(RU_TEXT)])
    res = _evaluate(db, p)
    assert res.record.status == AIEvalStatus.RETRIED and res.record.language == "ru"
    assert "Russian" in p.prompts[1]
    assert res.output.explanation == RU_TEXT


def test_wrong_language_output_falls_back_to_rule_based_text_in_the_right_language(db, lang):
    lang("kk")
    res = _evaluate(db, Scripted([_reply(EN_TEXT)] * 5))
    assert res.record.status == AIEvalStatus.FALLBACK and res.record.language == "kk"
    assert res.output.explanation.startswith("Рубриканың")


def test_insight_in_the_wrong_language_is_retried_then_falls_back(db, lang):
    lang("ru")
    insight = json.dumps({"headline": EN_TEXT[:60], "body": EN_TEXT, "next_step": EN_TEXT[:80], "confidence": 0.7})
    facts = {"strongest": {"name": "Ideas", "score": 70}, "top_gap": None, "top_resource": None}
    rec = generate_insight(db, user_id=None, facts=facts, provider=Scripted([], [insight, insight]))
    assert rec.status == AIEvalStatus.FALLBACK and rec.language == "ru"
    assert rec.output["headline"].startswith("Ваша самая сильная сторона")


# --- H1: practice feedback follows the request language ------------------------------------------------------------


def _submit_task(client, db) -> int:
    t = db.scalar(select(PracticalTask).order_by(PracticalTask.id))
    text = (
        "I listed fixed costs like rent and variable costs per unit. I set the price by comparing competitor "
        "prices and adding a margin. Break-even is fixed costs divided by the contribution margin."
    )
    r = client.post(f"/api/practice/tasks/{t.id}/submit", json={"response_text": text * 2})
    assert r.status_code == 200, r.text
    return t.id


def test_rule_based_practice_feedback_is_rendered_in_the_request_language(client, db):
    _learner_with_profile(client)
    tid = _submit_task(client, db)
    en = client.get(f"/api/practice/tasks/{tid}", headers=EN).json()["feedback"]
    ru = client.get(f"/api/practice/tasks/{tid}", headers=RU).json()["feedback"]
    kk = client.get(f"/api/practice/tasks/{tid}", headers=KK).json()["feedback"]
    assert en["explanation"].startswith("Rated against") and en["language"] == "en"
    assert ru["explanation"].startswith("Оценено по") and ru["language"] == "ru"
    assert kk["explanation"].startswith("Рубриканың") and kk["language"] == "kk"
    # Same ratings, criterion names in the reader's language.
    assert [c["rating"] for c in ru["criteria"]] == [c["rating"] for c in en["criteria"]]
    assert ru["criteria"][0]["criterion"] != en["criteria"][0]["criterion"]
    assert ru["score"] == en["score"]


def test_ai_language_is_exposed_on_competency_and_insight(client):
    _learner_with_profile(client)
    profile = client.get("/api/scores/profile", headers=KK).json()
    assert profile["insight"]["language"] == "kk"
    detail = client.get("/api/competencies/spotting", headers=RU).json()
    assert all(a["language"] == "ru" for a in detail["ai"])


# --- H2 / M3 / M4: recommendation texts ----------------------------------------------------------------------------


def test_resource_and_task_reasons_are_localized(client, db):
    _learner_with_profile(client)
    rec = db.scalar(select(Recommendation).where(Recommendation.resource_id.is_not(None)))
    r = client.get(f"/api/learning/resources/{rec.resource_id}", headers=RU).json()
    assert r["reason"].startswith("Балл")
    if rec.task_id:
        t = client.get(f"/api/practice/tasks/{rec.task_id}", headers=KK).json()
        assert "балл" in t["reason"]


def test_stored_plan_texts_are_english_base_text_whatever_the_request_language(client, db):
    register(client)
    onboard(client)
    a = client.post("/api/assessments/attempts", json={"scope": "full"}, headers=KK).json()["attempt"]["id"]
    answer_all(client, a)
    assert client.post(f"/api/assessments/attempts/{a}/submit", headers=KK).status_code == 200
    db.expire_all()
    rec = db.scalar(select(Recommendation).order_by(Recommendation.id))
    assert rec.reason.startswith("Score")
    titles = {a.kind.value: a.title for a in db.scalars(select(LearningActivity))}
    assert titles["reflect"] == "Reflect on what you learned"
    assert titles["reassess"].startswith("Reassess ")
    learn = db.scalar(select(LearningActivity).where(LearningActivity.resource_id.is_not(None)))
    assert learn.title == db.get(LearningResource, learn.resource_id).title  # English base (this session: no i18n)


def test_export_renders_reasons_in_the_request_language(client):
    _learner_with_profile(client)
    data = client.get("/api/export/me", headers=RU).json()
    assert data["recommendations"] and data["recommendations"][0]["reason"].startswith("Балл")


def test_kept_recommendation_updates_its_goal(client, db):
    _learner_with_profile(client, ["launch-startup"])
    db.expire_all()
    recs = list(db.scalars(select(Recommendation)))
    with_goal = [r for r in recs if r.goal_id is not None]
    if not with_goal:
        pytest.skip("no goal-relevant recommendation in this profile")
    for r in with_goal:
        r.goal_id = None  # stale goal on a recommendation that will be kept
    db.commit()
    a = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
    answer_all(client, a)
    client.post(f"/api/assessments/attempts/{a}/submit")
    db.expire_all()
    kept = [db.get(Recommendation, r.id) for r in with_goal]
    kept = [r for r in kept if r.status.value == "active"]
    assert kept and all(r.goal_id is not None for r in kept)


# --- M3: middleware and subscriptions ------------------------------------------------------------------------------


def test_webhooks_and_translation_report_are_not_localized():
    assert not localizes_content("/api/billing/webhooks/stripe")
    assert not localizes_content("/api/admin/translations/status")
    assert localizes_content("/api/competencies")


def test_base_language_context_loads_untranslated_content(db, lang):
    lang("ru")
    content_localization_var.set(True)
    try:
        c = db.scalar(select(Competency).where(Competency.code == "spotting"))
        assert c.name == "Выявление возможностей"
        from app.core.content_i18n import base_text

        assert base_text(c, "name") == "Spotting Opportunities"
        db.expunge_all()
        with base_language():
            assert db.scalar(select(Competency).where(Competency.code == "spotting")).name == "Spotting Opportunities"
    finally:
        content_localization_var.set(False)


def test_default_plans_created_without_the_seed_are_translated(client, db):
    db.execute(delete(PlanEntitlement))
    db.execute(delete(SubscriptionPlan))
    db.commit()
    plans = client.get("/api/plans", headers=RU).json()
    free = next(p for p in plans if p["key"] == "free")
    assert free["description"].startswith("Всё необходимое")


# --- M5: seeding translations --------------------------------------------------------------------------------------


def test_seed_translations_never_overwrite_edited_texts(db):
    from app.seed.apply_translations import apply_content_translations

    c = db.scalar(select(Competency).where(Competency.code == "spotting"))
    c.translations = {**c.translations, "ru": {**c.translations["ru"], "name": "Отредактировано админом"}}
    db.commit()
    apply_content_translations(db)
    db.commit()
    db.expire_all()
    c = db.scalar(select(Competency).where(Competency.code == "spotting"))
    assert c.translations["ru"]["name"] == "Отредактировано админом"


def test_seed_does_not_write_english_names_as_rubric_translations(db):
    from app.seed import translations as T
    from app.seed.apply_translations import _rubric

    rows = _rubric([{"criterion": "Not in the catalogue", "description": "x", "keywords": []},
                    {"criterion": next(iter(T.RUBRIC)), "description": "y", "keywords": []}])
    assert rows["ru"]["rubric"][0] == {} and rows["ru"]["rubric"][1]["criterion"]


# --- M6 / Q3: stale translations and completeness ------------------------------------------------------------------


def test_editing_english_text_marks_its_translations_stale_until_replaced(client, db):
    _admin(client, db)
    c = next(x for x in client.get("/api/admin/competencies").json() if x["code"] == "spotting")
    assert c["translation_status"]["ru"]["status"] in ("complete", "partial")
    r = client.put(f"/api/admin/competencies/{c['id']}",
                   json={"description": "A rewritten English description of spotting.",
                         "expected_version": c["lock_version"]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["translation_status"]["ru"]["status"] == "stale"
    assert "description" in out["translation_status"]["ru"]["stale"]
    assert out["translations"]["ru"]["description"]  # kept, still shown to learners
    # The editor round-trips the translations (with _stale) while changing another field: still stale.
    r = client.put(f"/api/admin/competencies/{c['id']}",
                   json={"importance": 0.61, "translations": out["translations"],
                         "expected_version": out["lock_version"]})
    assert r.json()["translation_status"]["ru"]["stale"] == ["description"]
    # Replacing the Russian text clears it; Kazakh stays stale.
    tr = r.json()["translations"]
    tr["ru"]["description"] = "Новое описание."
    r = client.put(f"/api/admin/competencies/{c['id']}",
                   json={"translations": tr, "expected_version": r.json()["lock_version"]})
    st = r.json()["translation_status"]
    assert st["ru"]["stale"] == [] and st["kk"]["stale"] == ["description"]
    # Confirming the Kazakh text as still correct: send _stale without it.
    tr = {**r.json()["translations"], "_stale": {}}
    r = client.put(f"/api/admin/competencies/{c['id']}",
                   json={"translations": tr, "expected_version": r.json()["lock_version"]})
    assert r.json()["translation_status"]["kk"]["stale"] == []
    assert "_stale" not in (r.json()["translations"] or {})


def _question_body(q: dict, **over) -> dict:
    return {
        "assessment_id": q["assessment_id"], "type": q["type"], "section": q["section"], "text": q["text"],
        "help_text": q["help_text"], "reverse_scored": q["reverse_scored"], "min_length": q["min_length"],
        "options": [{"label": o["label"], "score": o["score"], "value": o["value"]} for o in q["options"]],
        "competencies": q["competencies"], "rubric": q["rubric"], "expected_version": q["lock_version"], **over,
    }


def test_question_options_keep_translations_by_label_and_mark_edited_labels_stale(client, db):
    _admin(client, db)
    q = next(x for x in client.get("/api/admin/questions").json() if x["type"] == "situational")
    opts = q["options"]
    reordered = [{"label": o["label"], "score": o["score"], "value": o["value"]} for o in reversed(opts)]
    reordered[0]["label"] = "A completely new first option label"  # was the last option's label, edited in place
    r = client.put(f"/api/admin/questions/{q['id']}", json=_question_body(q, options=reordered))
    assert r.status_code == 200, r.text
    new = r.json()["options"]
    by_label = {o["label"]: o for o in opts}
    for o in new[1:]:
        assert o["translations"] == by_label[o["label"]]["translations"]  # followed its English label
    assert new[0]["translations"]["ru"]["label"] == opts[-1]["translations"]["ru"]["label"]
    assert new[0]["translation_status"]["ru"]["status"] == "stale"
    assert r.json()["translation_status"]["ru"]["stale"] == ["options"]


def test_new_question_version_marks_changed_text_stale_and_realigns_rubric(client, db):
    _learner_with_profile(client)
    _admin(client, db)
    q = next(x for x in client.get("/api/admin/questions").json() if x["type"] == "open" and x["answer_count"])
    rubric = list(reversed(q["rubric"]))
    r = client.put(f"/api/admin/questions/{q['id']}",
                   json=_question_body(q, text=q["text"] + " (reworded)", rubric=rubric))
    assert r.status_code == 200, r.text
    new = r.json()
    assert new["replaced_id"] == q["id"]
    assert "text" in new["translation_status"]["ru"]["stale"]
    assert "rubric" not in new["translation_status"]["ru"]["stale"]  # only reordered
    assert new["translations"]["ru"]["rubric"] == list(reversed(q["translations"]["ru"]["rubric"]))


def test_translation_status_endpoint(client, db):
    _admin(client, db)
    r = client.get("/api/admin/translations/status")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"summary", "items", "total", "page", "page_size"}
    assert set(body["summary"]) == {
        "area", "competency", "level", "goal", "assessment", "question", "option", "resource", "task", "plan"
    }
    assert set(body["summary"]["competency"]["ru"]) == {"complete", "partial", "missing", "stale"}
    # Make one competency incomplete in Kazakh.
    c = db.scalar(select(Competency).where(Competency.code == "spotting"))
    c.translations = {"ru": c.translations["ru"]}
    db.commit()
    r = client.get("/api/admin/translations/status",
                   params={"entity": "competency", "language": "kk", "status": "missing,partial"}).json()
    item = next(i for i in r["items"] if i["id"] == c.id)
    assert item == {
        "entity": "competency", "id": c.id, "label": "Spotting Opportunities",
        "status": {"ru": translation_status(c)["ru"]["status"], "kk": "missing"},
        "missing": {"ru": translation_status(c)["ru"]["missing"], "kk": item["missing"]["kk"]},
        "stale": {"ru": [], "kk": []},
    }
    assert "name" in item["missing"]["kk"]
    page = client.get("/api/admin/translations/status", params={"page_size": 1, "page": 2}).json()
    assert len(page["items"]) <= 1 and page["page"] == 2
    bad = client.get("/api/admin/translations/status", params={"entity": "nope"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_FILTER"
    # Learners can't read it.
    client.cookies.clear()
    register(client, "l2@example.com")
    assert client.get("/api/admin/translations/status").status_code == 403


def test_admin_content_lists_include_translation_status(client, db):
    _admin(client, db)
    for path in ("competencies", "questions", "assessments", "resources", "tasks", "plans"):
        rows = client.get(f"/api/admin/{path}").json()
        assert rows and set(rows[0]["translation_status"]) == {"ru", "kk"}, path


# --- L1: message codes ---------------------------------------------------------------------------------------------


def test_archive_messages_have_codes(client, db):
    _admin(client, db)
    t = db.scalar(select(PracticalTask))
    assert client.delete(f"/api/admin/tasks/{t.id}").json()["code"] == "TASK_ARCHIVED"
    q = db.scalar(select(Question))
    assert client.delete(f"/api/admin/questions/{q.id}").json()["code"] == "QUESTION_ARCHIVED"


def test_frontend_has_texts_for_new_codes():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2] / "frontend" / "src" / "i18n" / "locales"
    for lang in ("ru", "kk", "en"):
        errors = json.loads((root / lang / "errors.json").read_text())
        messages = json.loads((root / lang / "auth.json").read_text())["messages"]
        for code in ("DEMO_ACCOUNT_READ_ONLY", "CANNOT_MODIFY_SELF", "INVALID_FILTER", "NOTIFICATION_NOT_FOUND",
                     "PROMPT_NOT_FOUND"):
            assert errors.get(code), (lang, code)
        for code in ("QUESTION_ARCHIVED", "RESOURCE_ARCHIVED", "TASK_ARCHIVED", "NOTIFICATION_READ"):
            assert messages.get(code), (lang, code)


# --- D4: lazy rows under concurrency -------------------------------------------------------------------------------


def test_concurrent_first_progress_insert_reuses_the_existing_row(client, db, monkeypatch):
    from app.api.routes import learning

    _learner_with_profile(client)
    rid = db.scalar(select(Recommendation.resource_id).where(Recommendation.resource_id.is_not(None)))
    assert client.post(f"/api/learning/resources/{rid}/start").status_code == 200
    user_id = db.scalar(select(UserLearningProgress.user_id))
    real = learning._progress
    calls = {"n": 0}

    def racy(db_, uid, r):  # the first lookup misses the row another request just inserted
        calls["n"] += 1
        return None if calls["n"] == 1 else real(db_, uid, r)

    monkeypatch.setattr(learning, "_progress", racy)
    p, created = learning._ensure_progress(db, user_id, rid, started_at=None)
    assert not created and p.resource_id == rid


def test_concurrent_first_submission_insert_reuses_the_existing_row(client, db, monkeypatch):
    from app.api.routes import practice

    _learner_with_profile(client)
    t = db.scalar(select(PracticalTask).order_by(PracticalTask.id))
    assert client.post(f"/api/practice/tasks/{t.id}/start").status_code == 200
    user_id = db.scalar(select(AIEvaluation.user_id).where(AIEvaluation.user_id.is_not(None)))
    real = practice._sub
    calls = {"n": 0}

    def racy(db_, uid, tid):
        calls["n"] += 1
        return None if calls["n"] == 1 else real(db_, uid, tid)

    monkeypatch.setattr(practice, "_sub", racy)
    s, created = practice._ensure_sub(db, user_id, t.id)
    assert not created and s.task_id == t.id


# --- seed ----------------------------------------------------------------------------------------------------------


def test_rule_based_texts_built_in_base_language_are_english(lang):
    lang("ru")
    with base_language():
        out = heuristic_evaluation("Ideas", "customer interview free", RUBRIC)
    assert out["explanation"].startswith("Rated against")
