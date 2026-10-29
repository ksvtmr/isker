from tests.conftest import login, make_user


def _admin(client, db):
    make_user(db, "admin@example.com", ("user", "admin"), password="Admin1234")
    login(client, "admin@example.com", "Admin1234")


def test_admin_stats_and_catalogue(client, db):
    _admin(client, db)
    s = client.get("/api/admin/stats").json()
    assert s["users"] == 1 and len(s["competency_averages"]) == 15
    assert len(client.get("/api/admin/questions").json()) == 30
    assert len(client.get("/api/admin/resources").json()) == 30
    assert len(client.get("/api/admin/tasks").json()) == 15


def test_admin_creates_resource_and_question(client, db):
    _admin(client, db)
    comp = client.get("/api/admin/competencies").json()[0]
    r = client.post(
        "/api/admin/resources",
        json={
            "slug": "new-resource",
            "competency_id": comp["id"],
            "title": "New resource",
            "description": "A useful description",
            "type": "article",
            "difficulty": "beginner",
            "duration_minutes": 10,
            "content": "## Heading\nSome useful content for learners.",
        },
    )
    assert r.status_code == 201, r.text
    assert client.post("/api/admin/resources", json={**r.json(), "slug": "new-resource"}).status_code == 409

    a = client.get("/api/admin/assessments").json()[0]
    q = client.post(
        "/api/admin/questions",
        json={
            "assessment_id": a["id"],
            "type": "situational",
            "section": "Situational judgement",
            "text": "What would you do in this new situation?",
            "options": [{"label": "Good", "score": 100}, {"label": "Bad", "score": 0}],
            "competencies": [{"competency_id": comp["id"], "weight": 1}],
        },
    )
    assert q.status_code == 201, q.text
    bad = client.post(
        "/api/admin/questions",
        json={
            "assessment_id": a["id"],
            "type": "open",
            "section": "Open",
            "text": "Describe something important.",
            "competencies": [{"competency_id": comp["id"], "weight": 1}],
        },
    )
    assert bad.status_code == 422  # open questions need a rubric
    assert client.delete(f"/api/admin/questions/{q.json()['id']}").status_code == 200


def test_prompt_versioning(client, db):
    _admin(client, db)
    prompts = client.get("/api/admin/ai/prompts").json()
    assert {p["key"] for p in prompts} == {"answer_evaluation", "profile_insight", "development_analysis"}
    r = client.post(
        "/api/admin/ai/prompts",
        json={"key": "profile_insight", "system_prompt": "x" * 30, "user_template": "Facts: {facts}", "activate": True},
    )
    assert r.status_code == 201 and r.json()["version"] == 2 and r.json()["is_active"]
    active = [p for p in client.get("/api/admin/ai/prompts").json() if p["key"] == "profile_insight" and p["is_active"]]
    assert len(active) == 1
    bad = client.post(
        "/api/admin/ai/prompts",
        json={"key": "profile_insight", "system_prompt": "x" * 30, "user_template": "Facts: {unknown}"},
    )
    assert bad.status_code == 422
