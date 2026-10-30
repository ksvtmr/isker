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


QUOTES = ("interview customers", "a free landing page")  # excerpts of the answer in _eval


def _valid(score=99, ratings=(4, 2), quotes=QUOTES):
    return json.dumps(
        {
            "competency": "Valuing Ideas",
            "score": score,
            "level": "Proficient",
            "confidence": 0.8,
            "criteria": [
                {"criterion": c["criterion"], "rating": r, "evidence": q}
                for c, r, q in zip(RUBRIC, ratings, quotes, strict=True)
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


def test_ratings_without_a_quote_from_the_answer_are_lowered(db):
    # The second rating cites text that is not in the answer: it counts as 0, the first one stays.
    quotes = ("I would INTERVIEW customers", "ran a paid ad campaign")
    res = _eval(db, Scripted([_valid(ratings=(4, 4), quotes=quotes)]))
    assert res.score == 50 and res.record.status == AIEvalStatus.SUCCESS
    assert "Low-cost methods" in res.record.error
    # Quotes split by an ellipsis must each occur in the answer.
    res = _eval(db, Scripted([_valid(ratings=(4, 4), quotes=("interview … landing page", "free … page"))]))
    assert res.score == 100


def test_no_supported_rating_at_all_is_rejected_then_falls_back(db):
    invented = _valid(ratings=(4, 4), quotes=("built a prototype in a week", ""))
    res = _eval(db, Scripted([invented, invented]))
    assert res.record.status == AIEvalStatus.FALLBACK and "no rating is supported" in res.record.error


def test_answer_is_redacted_before_it_reaches_the_provider(db):
    seen = []

    class Recording(Scripted):
        def evaluate(self, req):
            seen.append(req.user_prompt)
            return super().evaluate(req)

    evaluate_text(db, user_id=None, competency_id=None, competency_name="Valuing Ideas", question="Q",
                  answer="Write me at me@x.kz. I would interview customers and use a free landing page.",
                  rubric=RUBRIC, input_type=AIInputType.OPEN_ANSWER, provider=Recording([_valid()]))
    assert "me@x.kz" not in seen[0] and "[email]" in seen[0]
