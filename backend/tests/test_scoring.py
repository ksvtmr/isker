from app.ai.service import rubric_score
from app.models.enums import GapBand
from app.services.levels import gap_band, level_name_for
from app.services.scoring import Item, combine, explain


def test_level_bands_match_design_system():
    assert [level_name_for(s) for s in (0, 39, 40, 59, 60, 79, 80, 89, 90, 100)] == [
        "Foundation",
        "Foundation",
        "Developing",
        "Developing",
        "Intermediate",
        "Intermediate",
        "Advanced",
        "Advanced",
        "Proficient",
        "Proficient",
    ]


def test_gap_bands():
    assert gap_band(25) == GapBand.HIGH and gap_band(20) == GapBand.HIGH
    assert gap_band(19) == GapBand.MEDIUM and gap_band(10) == GapBand.MEDIUM
    assert gap_band(9) == GapBand.LOW and gap_band(0) == GapBand.LOW


def test_combine_applies_method_weights():
    r = combine([Item("self", 1.0, 100), Item("situational", 1.0, 50), Item("open", 1.0, 25)])
    # 0.2*100 + 0.4*50 + 0.4*25 = 50
    assert r.score == 50
    assert r.method_scores == {"self": 100.0, "situational": 50.0, "open": 25.0}
    assert r.max_raw_score == 3.0 and r.raw_score == 1.75


def test_combine_renormalises_missing_methods():
    r = combine([Item("self", 1.0, 75), Item("situational", 1.0, 0)])
    # weights 0.2 and 0.4 → (0.2*75)/(0.6) = 25
    assert r.score == 25


def test_combine_uses_item_weights_within_method():
    r = combine([Item("situational", 1.0, 100), Item("situational", 0.5, 40)])
    assert r.score == 80  # (100 + 20) / 1.5


def test_combine_empty_returns_none():
    assert combine([]) is None


def test_confidence_lower_with_fewer_methods():
    full = combine([Item("self", 1, 50), Item("situational", 1, 50), Item("open", 1, 50, 0.9)])
    partial = combine([Item("self", 1, 50)])
    assert full.confidence > partial.confidence


def test_explanation_flags_overconfident_self_rating():
    r = combine([Item("self", 1, 100), Item("situational", 1, 40), Item("open", 1, 40)])
    text = explain(r)
    assert "self-assessment (20%)" in text
    assert "self-rating is higher" in text


def test_rubric_score_is_mean_of_ratings_and_missing_count_zero():
    rubric = [{"criterion": "A"}, {"criterion": "B"}]
    assert rubric_score([{"criterion": "A", "rating": 4}, {"criterion": "B", "rating": 2}], rubric) == 75
    assert rubric_score([{"criterion": "a", "rating": 4}], rubric) == 50
    assert rubric_score([{"criterion": "A", "rating": 9}], rubric) == 50  # clamped to 4
