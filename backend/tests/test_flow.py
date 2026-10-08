"""End-to-end product loop through the public API:
Register → Onboarding → Assess → Profile → Gaps → Recommendations → Plan → Learn → Practice → Reflect
→ Reassess → Progress."""

from tests.conftest import OPEN_ANSWER, answer_all, onboard, register


def _start(client, **body):
    r = client.post("/api/assessments/attempts", json=body or {"scope": "full"})
    assert r.status_code == 201, r.text
    return r.json()


def test_full_product_loop(client):
    register(client)
    onboard(client, ["launch-startup"])
    assert client.get("/api/auth/me").json()["onboarding_completed"] is True

    # --- Assessment
    started = _start(client)
    attempt_id = started["attempt"]["id"]
    assert started["resumed"] is False and started["attempt"]["total"] == 30
    # Resuming returns the same attempt
    assert _start(client)["attempt"]["id"] == attempt_id and _start(client)["resumed"] is True

    state = client.get(f"/api/assessments/attempts/{attempt_id}").json()
    assert len(state["questions"]) == 30
    # FR-14: the question payload never reveals which competency is measured
    assert all("competenc" not in k for q in state["questions"] for k in q)

    answer_all(client, attempt_id, choice_index=1)
    progress = client.get(f"/api/assessments/attempts/{attempt_id}").json()["attempt"]
    assert progress["answered"] == 30 and progress["current_index"] == 29

    r = client.post(f"/api/assessments/attempts/{attempt_id}/submit")
    assert r.status_code == 200, r.text
    results = r.json()
    profile = results["profile"]
    assert profile["has_profile"] and len(results["measured"]) == 15
    assert 0 <= profile["overall"] <= 100 and profile["level"]
    assert len(profile["strengths"]) == 3
    assert profile["insight"]["headline"]
    for c in profile["competencies"]:
        assert c["score"] is not None and c["level"] and c["explanation"]

    # --- Gaps (stored, prioritised)
    gaps = client.get("/api/gaps").json()
    assert len(gaps) == 15
    assert [g["priority_rank"] for g in gaps] == list(range(1, 16))
    assert all(g["gap"] == max(0, g["target"] - g["current"]) for g in gaps)

    # --- Recommendations: linked to competency, gap, goal and resource/task, with a reason
    recs = client.get("/api/recommendations").json()
    assert 1 <= len(recs) <= 3
    top = recs[0]
    assert top["competency_code"] == gaps[0]["code"]
    assert top["resource"] and top["task"] and "below your target" in top["reason"]
    assert [a["kind"] for a in top["activities"]] == ["learn", "practice", "reflect", "reassess"]
    assert top["activities"][3]["locked"] is True

    # --- Plan: Learn
    rid = top["resource"]["id"]
    assert client.post(f"/api/learning/resources/{rid}/start").json()["status"] == "in_progress"
    assert client.put(f"/api/learning/resources/{rid}/progress", json={"progress_pct": 40}).json()["progress_pct"] == 40
    done = client.post(f"/api/learning/resources/{rid}/complete").json()
    assert done["status"] == "completed" and done["completed_at"]

    # --- Practice with AI feedback
    tid = top["task"]["id"]
    client.post(f"/api/practice/tasks/{tid}/start")
    assert client.post(f"/api/practice/tasks/{tid}/complete").status_code == 409  # must submit first
    sub = client.post(f"/api/practice/tasks/{tid}/submit", json={"response_text": OPEN_ANSWER}).json()
    assert sub["status"] == "submitted" and sub["feedback"]["score"] >= 0 and sub["feedback"]["criteria"]
    assert client.post(f"/api/practice/tasks/{tid}/complete").json()["status"] == "completed"

    # --- Reflect
    plan = client.get("/api/plan").json()
    rec = next(r for r in plan["recommendations"] if r["id"] == top["id"])
    reflect = next(a for a in rec["activities"] if a["kind"] == "reflect")
    assert client.post(f"/api/plan/activities/{reflect['id']}/reflection", json={"text": "short"}).status_code == 422
    r = client.post(
        f"/api/plan/activities/{reflect['id']}/reflection",
        json={"text": "My riskiest assumption is that students will pay in advance."},
    )
    assert r.status_code == 200 and r.json()["status"] == "done"
    plan = client.get("/api/plan").json()
    rec = next(r for r in plan["recommendations"] if r["id"] == top["id"])
    assert rec["progress_pct"] == 75 and not next(a for a in rec["activities"] if a["kind"] == "reassess")["locked"]
    assert plan["done"] >= 3

    # --- Reassess only this competency (better answers)
    re = _start(client, scope="competency", competency_id=top["competency_id"])
    assert re["attempt"]["scope"] == "competency" and re["attempt"]["total"] < 30
    answer_all(client, re["attempt"]["id"], choice_index=99)
    r = client.post(f"/api/assessments/attempts/{re['attempt']['id']}/submit")
    assert r.status_code == 200, r.text
    assert [m["code"] for m in r.json()["measured"]] == [top["competency_code"]]

    # History is preserved: the competency now has two measurements, the others one
    detail = client.get(f"/api/competencies/{top['competency_code']}").json()
    assert len(detail["history"]) == 2
    assert detail["evidence"] and detail["explanation"]
    assert detail["current"]["change"] == detail["history"][1]["score"] - detail["history"][0]["score"]

    # The completed cycle is closed and a new plan is generated
    plan = client.get("/api/plan").json()
    assert any(c["id"] == top["id"] for c in plan["completed"])

    # --- Progress
    prog = client.get("/api/progress").json()
    assert len(prog["snapshots"]) == 2
    assert prog["completed_resources"] == 1 and prog["completed_tasks"] == 1
    assert prog["reflections"] == 1 and prog["reassessments"] == 1
    trend = next(t for t in prog["trends"] if t["code"] == top["competency_code"])
    assert len(trend["points"]) == 2

    dash = client.get("/api/dashboard").json()
    assert dash["profile"]["overall"] == prog["overall_current"]
    assert dash["profile"]["previous_overall"] == prog["snapshots"][0]["overall"]


def test_submit_incomplete_is_rejected(client):
    register(client)
    attempt_id = _start(client)["attempt"]["id"]
    r = client.post(f"/api/assessments/attempts/{attempt_id}/submit")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "ASSESSMENT_INCOMPLETE"
    assert len(r.json()["error"]["details"]["unanswered"]) == 30


def test_open_answer_minimum_length_enforced(client):
    register(client)
    attempt_id = _start(client)["attempt"]["id"]
    answer_all(client, attempt_id, text="too short")
    r = client.post(f"/api/assessments/attempts/{attempt_id}/submit")
    assert r.status_code == 422 and r.json()["error"]["code"] == "ASSESSMENT_INCOMPLETE"


def test_invalid_option_rejected(client):
    register(client)
    attempt_id = _start(client)["attempt"]["id"]
    q = client.get(f"/api/assessments/attempts/{attempt_id}").json()["questions"][0]
    r = client.put(f"/api/assessments/attempts/{attempt_id}/answers/{q['id']}", json={"option_id": 999999})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_OPTION"


def test_cannot_access_another_users_attempt(client):
    register(client, "a@example.com")
    attempt_id = _start(client)["attempt"]["id"]
    client.cookies.clear()
    register(client, "b@example.com")
    r = client.get(f"/api/assessments/attempts/{attempt_id}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "ATTEMPT_NOT_FOUND"


def test_dashboard_empty_state_before_assessment(client):
    register(client)
    dash = client.get("/api/dashboard").json()
    assert dash["profile"]["has_profile"] is False and dash["top_recommendation"] is None
    assert client.get("/api/gaps").json() == []


def test_onboarding_rejects_unknown_goal(client):
    register(client)
    r = client.post(
        "/api/profile/onboarding",
        json={
            "full_name": "Dana",
            "education": "Bachelor",
            "entrepreneurial_experience": "none",
            "goal_codes": ["become-astronaut"],
            "preferred_learning_format": "video",
            "weekly_learning_minutes": 30,
        },
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_GOAL"


def test_delete_account(client):
    register(client)
    attempt_id = _start(client)["attempt"]["id"]
    answer_all(client, attempt_id)
    client.post(f"/api/assessments/attempts/{attempt_id}/submit")
    assert client.delete("/api/users/me").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
