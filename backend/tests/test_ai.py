import json

from app.ai.providers import AIProvider, AIProviderError, MockAIProvider
from app.ai.service import evaluate_text
from app.models import AIEvaluation
from app.models.enums import AIEvalStatus, AIInputType

RUBRIC = [
    {"criterion": "Customer evidence", "description": "d", "keywords": ["customer", "interview"]},
    {"criterion": "Low-cost methods", "description": "d", "keywords": ["free", "cheap"]},
]


class Scripted(AIProvider):
    name, model = "scripted", "scripted-1"

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = 0

    def evaluate(self, req):
        self.calls += 1
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    def insight(self, req):
        return "{}"


def _valid(score=99, ratings=(4, 2)):
    return json.dumps(
        {
            "competency": "Valuing Ideas",
            "score": score,
            "level": "Proficient",
            "confidence": 0.8,
            "criteria": [
                {"criterion": c["criterion"], "rating": r, "evidence": "x"}
                for c, r in zip(RUBRIC, ratings, strict=True)
            ],
            "evidence": ["e"],
            "strengths": ["s"],
            "development_areas": [],
        }
    )


def _eval(db, provider):
    return evaluate_text(
        db,
        user_id=None,
        competency_id=None,
        competency_name="Valuing Ideas",
        question="Q",
        answer="I would interview customers and use a free landing page.",
        rubric=RUBRIC,
        input_type=AIInputType.OPEN_ANSWER,
        provider=provider,
    )


def test_score_is_recomputed_from_rubric_not_taken_from_model(db):
    res = _eval(db, Scripted([_valid(score=99, ratings=(4, 2))]))
    assert res.score == 75  # (4+2)/8, not the model's 99
    assert res.output.level == "Intermediate"
    assert res.record.status == AIEvalStatus.SUCCESS


def test_invalid_json_is_retried(db):
    p = Scripted(["not json", _valid()])
    res = _eval(db, p)
    assert p.calls == 2 and res.record.status == AIEvalStatus.RETRIED
    assert "attempt 1" in res.record.error


def test_missing_criteria_rejected(db):
    bad = json.loads(_valid())
    bad["criteria"] = bad["criteria"][:1]
    res = _eval(db, Scripted([json.dumps(bad), json.dumps(bad)]))
    assert res.record.status == AIEvalStatus.FALLBACK


def test_provider_failure_falls_back_safely(db):
    res = _eval(db, Scripted([AIProviderError("down"), AIProviderError("down")]))
    assert res.record.status == AIEvalStatus.FALLBACK
    assert res.record.provider == "fallback"
    assert 0 <= res.score <= 100 and res.output.confidence <= 0.5
    db.commit()
    assert db.query(AIEvaluation).count() == 1


def test_out_of_range_values_fail_validation(db):
    bad = json.loads(_valid())
    bad["confidence"] = 7
    res = _eval(db, Scripted([json.dumps(bad), json.dumps(bad)]))
    assert res.record.status == AIEvalStatus.FALLBACK


def test_mock_provider_is_deterministic(db):
    a = _eval(db, MockAIProvider()).score
    b = _eval(db, MockAIProvider()).score
    assert a == b
