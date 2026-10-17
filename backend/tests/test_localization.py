"""Language resolution, saved language preference, localized content, generated texts and emails."""

from __future__ import annotations

from sqlalchemy import select

from app.core.middleware import parse_language
from app.models import Competency, User
from tests.conftest import answer_all, login, make_user, onboard, register

RU = {"Accept-Language": "ru"}
KK = {"Accept-Language": "kk"}
EN = {"Accept-Language": "en"}

RU_OPEN_ANSWER = (
    "Сначала я бы перечислил гипотезы, лежащие в основе идеи, и проверил самую рискованную. Я бы провёл интервью "
    "с десятью клиентами о проблеме, запустил бесплатный лендинг как дешёвый прототип, измерил регистрации и "
    "сделал выводы из результата. Мы продолжили после неудачного теста, и я понял, что моя сильная сторона — "
    "подготовка доказательств. Клиенты платят небольшую комиссию за заказ, поэтому выручка покрывает расходы."
)


def test_accept_language_parsing():
    assert parse_language("kk-KZ,kk;q=0.9,ru;q=0.8") == "kk"
    assert parse_language("en-US,en;q=0.9") == "en"
    assert parse_language("de-DE,fr;q=0.8") == "ru"  # unsupported → default
    assert parse_language(None) == "ru"
    assert parse_language("fr;q=0.9, kk;q=0.5") == "kk"


def test_api_responses_vary_by_language(client):
    r = client.get("/api/competencies", headers=RU)
    assert "accept-language" in r.headers.get("vary", "").lower()


def test_content_follows_the_request_language(client):
    en = client.get("/api/competencies", headers=EN).json()
    ru = client.get("/api/competencies", headers=RU).json()
    kk = client.get("/api/competencies", headers=KK).json()
    names = lambda d: {c["code"]: c["name"] for c in d["competencies"]}  # noqa: E731
    assert names(en)["spotting"] == "Spotting Opportunities"
    assert names(ru)["spotting"] == "Выявление возможностей"
    assert names(kk)["spotting"] == "Мүмкіндіктерді анықтау"
    # Identifiers are never translated.
    assert names(en).keys() == names(ru).keys() == names(kk).keys()


def test_localized_reads_never_overwrite_the_base_text(client, db):
    client.get("/api/competencies", headers=RU)
    db.expire_all()
    assert db.scalar(select(Competency).where(Competency.code == "spotting")).name == "Spotting Opportunities"


def test_admin_content_editor_works_on_the_base_text_and_sees_translations(client, db):
    make_user(db, "admin@example.com", roles=("user", "super_admin"))
    login(client, "admin@example.com")
    rows = client.get("/api/admin/competencies", headers=RU).json()
    spotting = next(c for c in rows if c["code"] == "spotting")
    assert spotting["name"] == "Spotting Opportunities"


def test_questions_and_options_are_localized_but_ids_stay_the_same(client):
    register(client)
    onboard(client)
    a = client.post("/api/assessments/attempts", json={"scope": "full"}, headers=RU).json()["attempt"]["id"]
    ru = client.get(f"/api/assessments/attempts/{a}", headers=RU).json()["questions"]
    en = client.get(f"/api/assessments/attempts/{a}", headers=EN).json()["questions"]
    assert [q["id"] for q in ru] == [q["id"] for q in en]
    assert ru[0]["text"] != en[0]["text"] and any("а" in q["text"] for q in ru)
    assert [o["id"] for o in ru[0]["options"]] == [o["id"] for o in en[0]["options"]]
    assert ru[0]["options"][0]["label"] != en[0]["options"][0]["label"]


def test_russian_open_answers_are_scored_with_russian_keywords(client):
    register(client)
    onboard(client)
    a = client.post("/api/assessments/attempts", json={"scope": "full"}, headers=RU).json()["attempt"]["id"]
    answer_all(client, a, text=RU_OPEN_ANSWER)
    profile = client.post(f"/api/assessments/attempts/{a}/submit", headers=RU).json()["profile"]
    assert profile["has_profile"]
    # Generated explanations, insight and recommendation reasons are in Russian.
    assert any(c["explanation"].startswith("Сочетает") for c in profile["competencies"])
    assert profile["insight"]["headline"].startswith("Ваша самая сильная сторона")
    recs = client.get("/api/recommendations", headers=RU).json()
    assert recs and recs[0]["reason"].startswith("Балл")
    # The same stored results read in Kazakh and English.
    assert client.get("/api/recommendations", headers=KK).json()[0]["reason"].endswith(".")
    en = client.get("/api/scores/profile", headers=EN).json()
    assert en["insight"]["headline"].startswith("Your strongest area")
    kk = client.get("/api/scores/profile", headers=KK).json()
    assert kk["insight"]["headline"].startswith("Сіздің ең күшті жағыңыз")


def test_language_preference_is_saved_on_the_account(client, db):
    register(client)
    me = client.get("/api/auth/me").json()
    assert me["language"] == "en"  # registered with Accept-Language: en
    r = client.put("/api/auth/me/language", json={"language": "kk"})
    assert r.status_code == 200 and r.json()["language"] == "kk"
    assert client.get("/api/auth/me").json()["language"] == "kk"
    assert client.put("/api/auth/me/language", json={"language": "de"}).status_code == 422


def test_registration_stores_the_chosen_language(client):
    r = client.post("/api/auth/register", json={"email": "k@example.com", "password": "Secret123",
                                                "full_name": "Kazakh User", "accept_terms": True,
                                                "language": "kk"})
    assert r.status_code == 201 and r.json()["user"]["language"] == "kk"


def test_emails_are_sent_in_the_account_language(client, db, caplog):
    caplog.set_level("WARNING", logger="isker.email")
    client.post("/api/auth/register", json={"email": "k@example.com", "password": "Secret123",
                                            "full_name": "Kazakh User", "accept_terms": True, "language": "kk"})
    assert any("Сәлеметсіз бе" in r.getMessage() for r in caplog.records)
    caplog.clear()
    client.post("/api/auth/forgot-password", json={"email": "k@example.com"}, headers=RU)
    # The account language wins over the language of the request that triggered the email.
    assert any("Сәлеметсіз бе" in r.getMessage() for r in caplog.records)


def test_error_codes_are_stable_across_languages(client):
    for h in (RU, KK, EN):
        r = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "Wrong123"}, headers=h)
        assert r.status_code == 401 and r.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_password_reset_response_is_generic(client, db):
    make_user(db, "real@example.com")
    a = client.post("/api/auth/forgot-password", json={"email": "real@example.com"}).json()
    b = client.post("/api/auth/forgot-password", json={"email": "ghost@example.com"}).json()
    assert a == b


def test_user_language_column_starts_empty_for_admin_created_accounts(db):
    u = make_user(db, "x@example.com")
    assert db.get(User, u.id).profile.language is None


def test_notifications_and_plan_steps_follow_the_language(client):
    register(client)
    onboard(client)
    a = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
    answer_all(client, a)
    client.post(f"/api/assessments/attempts/{a}/submit")
    en = client.get("/api/notifications", headers=EN).json()
    kk = client.get("/api/notifications", headers=KK).json()
    assert en[0]["title"] == "Your competency profile is ready"
    assert kk[0]["title"] == "Құзыреттер профиліңіз дайын" and kk[0]["body"].startswith("Жалпы балл")
    steps = client.get("/api/recommendations", headers=RU).json()[0]["activities"]
    reassess = next(s for s in steps if s["kind"] == "reassess")
    assert reassess["title"].startswith("Повторная оценка")


def test_admin_stats_competency_names_are_localized(client, db):
    # Regression: the query selected Competency.name as a column, which bypasses content translation.
    make_user(db, "admin@example.com", roles=("user", "super_admin"))
    login(client, "admin@example.com")
    stats = client.get("/api/admin/stats", headers=RU).json()
    names = {c["code"]: c["name"] for c in stats["competency_averages"]}
    assert names["spotting"] == "Выявление возможностей"


def test_learning_search_matches_the_language_the_learner_sees(client, db):
    from app.models import LearningResource

    register(client)
    onboard(client)
    res = db.scalars(select(LearningResource)).first()
    ru_title = res.translations["ru"]["title"]
    word = ru_title.split()[0]
    found = client.get("/api/learning/resources", params={"q": word, "page_size": 100}, headers=RU).json()["items"]
    assert any(r["id"] == res.id for r in found)
    # The English base text still matches too.
    en_word = res.title.split()[0]
    params = {"q": en_word, "page_size": 100}
    found_en = client.get("/api/learning/resources", params=params, headers=RU).json()["items"]
    assert any(r["id"] == res.id for r in found_en)
