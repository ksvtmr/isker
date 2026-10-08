from types import SimpleNamespace

from app.models.enums import Difficulty, LearningFormat, ResourceType
from app.services.profile import Relevance
from app.services.recommendations import LearnerContext, build_reason, rank_resources, rank_tasks


def _res(id_, type_, diff, minutes=15):
    return SimpleNamespace(id=id_, type=ResourceType(type_), difficulty=Difficulty(diff), duration_minutes=minutes)


def _ctx(**kw):
    base = dict(
        preferred_format=LearningFormat.ARTICLE,
        weekly_minutes=60,
        completed_resources=set(),
        in_progress_resources=set(),
        completed_tasks=set(),
    )
    base.update(kw)
    return LearnerContext(**base)


def test_prefers_matching_difficulty_and_format():
    rs = [_res(1, "video", "advanced"), _res(2, "article", "beginner"), _res(3, "course", "intermediate", 45)]
    assert rank_resources(rs, score=35, ctx=_ctx())[0].id == 2  # Foundation → beginner article
    assert rank_resources(rs, score=85, ctx=_ctx(preferred_format=LearningFormat.VIDEO))[0].id == 1


def test_skips_completed_resources():
    rs = [_res(1, "article", "beginner"), _res(2, "article", "intermediate")]
    assert rank_resources(rs, score=35, ctx=_ctx(completed_resources={1}))[0].id == 2


def test_tasks_prefer_not_completed():
    ts = [SimpleNamespace(id=1, difficulty=Difficulty.BEGINNER), SimpleNamespace(id=2, difficulty=Difficulty.ADVANCED)]
    assert rank_tasks(ts, 30, _ctx(completed_tasks={1}))[0].id == 2


def test_reason_mentions_gap_and_goal():
    gap = SimpleNamespace(current_score=52, gap=23, target_score=75)
    comp = SimpleNamespace(name="Financial & Economic Literacy", importance=0.9)
    goal = SimpleNamespace(title="Launch my own startup")
    text = build_reason(gap, comp, Relevance(0.9, goal))
    assert (
        text == "Score 52 is 23 points below your target of 75, and it matters for your goal “Launch my own startup”."
    )
    text = build_reason(gap, comp, Relevance(0.2, None))
    assert "large effect" in text


def test_recommendations_follow_goal_priorities(client):
    from tests.conftest import answer_all, onboard, register

    register(client)
    onboard(client, ["social-impact"])
    att = client.post("/api/assessments/attempts", json={"scope": "full"}).json()["attempt"]["id"]
    answer_all(client, att, choice_index=2)
    client.post(f"/api/assessments/attempts/{att}/submit")
    recs = client.get("/api/recommendations").json()
    gaps = {g["code"]: g for g in client.get("/api/gaps").json()}
    for r in recs:
        g = gaps[r["competency_code"]]
        assert r["gap"] == g["gap"] and r["current"] == g["current"]
    # Ethics is central to the social-impact goal → its target is boosted to 75
    assert gaps["ethics"]["target"] == 75 and gaps["financial-literacy"]["target"] == 70
