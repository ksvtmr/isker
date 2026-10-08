from app.models.enums import GapBand
from app.services.gaps import GapInput, analyze


def test_gap_target_boost_for_goal_relevant_competency():
    out = {
        g.competency_id: g
        for g in analyze(
            [
                GapInput(1, 52, relevance=0.9, importance=0.5, learning_priority=0.5),
                GapInput(2, 52, relevance=0.2, importance=0.5, learning_priority=0.5),
            ]
        )
    }
    assert out[1].target == 75 and out[1].gap == 23 and out[1].band == GapBand.HIGH
    assert out[2].target == 70 and out[2].gap == 18 and out[2].band == GapBand.MEDIUM


def test_priority_combines_gap_relevance_importance_learning():
    out = analyze(
        [
            GapInput(1, 50, relevance=0.2, importance=0.2, learning_priority=0.2),  # gap 20
            GapInput(2, 50, relevance=0.6, importance=0.9, learning_priority=0.9),  # gap 20, more relevant
            GapInput(3, 30, relevance=0.2, importance=0.2, learning_priority=0.2),  # gap 40
        ]
    )
    # A goal-relevant, important gap of 20 outranks an irrelevant gap of 40.
    assert [g.competency_id for g in out] == [2, 3, 1]
    assert out[0].priority_score == round(0.5 * 20 / 30 + 0.25 * 0.6 + 0.15 * 0.9 + 0.1 * 0.9, 4)
    assert out[1].priority_score == round(0.5 * 1 + 0.25 * 0.2 + 0.15 * 0.2 + 0.1 * 0.2, 4)


def test_no_gap_has_zero_priority_and_ranks_last():
    out = analyze([GapInput(1, 90, 0.9, 0.9, 0.9), GapInput(2, 65, 0.1, 0.1, 0.1)])
    assert out[0].competency_id == 2
    assert out[1].gap == 0 and out[1].priority_score == 0 and out[1].label == "None"
    assert [g.rank for g in out] == [1, 2]
