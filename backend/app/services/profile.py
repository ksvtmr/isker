"""Current competency profile = latest score per competency across completed attempts."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    AssessmentAttempt,
    Competency,
    CompetencyScore,
    GoalCompetencyWeight,
    GoalDefinition,
    UserGoal,
)
from app.models.enums import AttemptStatus

NEUTRAL_RELEVANCE = 0.5


def completed_attempts(db: Session, user_id: int) -> list[AssessmentAttempt]:
    return list(
        db.scalars(
            select(AssessmentAttempt)
            .where(AssessmentAttempt.user_id == user_id, AssessmentAttempt.status == AttemptStatus.COMPLETED)
            .order_by(AssessmentAttempt.completed_at.asc(), AssessmentAttempt.id.asc())
        )
    )


def all_scores(db: Session, user_id: int) -> list[tuple[CompetencyScore, AssessmentAttempt]]:
    rows = db.execute(
        select(CompetencyScore, AssessmentAttempt)
        .join(AssessmentAttempt, AssessmentAttempt.id == CompetencyScore.attempt_id)
        .where(CompetencyScore.user_id == user_id, AssessmentAttempt.status == AttemptStatus.COMPLETED)
        .options(joinedload(CompetencyScore.level))
        .order_by(AssessmentAttempt.completed_at.asc(), AssessmentAttempt.id.asc())
    ).all()
    return [(r[0], r[1]) for r in rows]


def current_scores(db: Session, user_id: int, up_to_attempt_id: int | None = None) -> dict[int, CompetencyScore]:
    """Latest score per competency (optionally as of a given attempt, for historical views)."""
    latest: dict[int, CompetencyScore] = {}
    reached = False
    for score, attempt in all_scores(db, user_id):
        if up_to_attempt_id is not None:
            if attempt.id == up_to_attempt_id:
                reached = True
            elif reached:
                break  # past the requested attempt
        latest[score.competency_id] = score
    return latest


def history(db: Session, user_id: int) -> dict[int, list[tuple[CompetencyScore, AssessmentAttempt]]]:
    h: dict[int, list] = defaultdict(list)
    for score, attempt in all_scores(db, user_id):
        h[score.competency_id].append((score, attempt))
    return h


def overall_score(scores: dict[int, CompetencyScore] | dict[int, int]) -> int | None:
    vals = [s if isinstance(s, int) else s.score for s in scores.values()]
    return round(sum(vals) / len(vals)) if vals else None


def area_scores(db: Session, scores: dict[int, CompetencyScore]) -> dict[str, int | None]:
    out: dict[str, list[int]] = defaultdict(list)
    for c in db.scalars(select(Competency).options(joinedload(Competency.area))):
        if c.id in scores:
            out[c.area.code].append(scores[c.id].score)
    return {k: (round(sum(v) / len(v)) if v else None) for k, v in out.items()}


@dataclass
class Relevance:
    value: float
    goal: GoalDefinition | None


def goal_relevance(db: Session, user_id: int) -> dict[int, Relevance]:
    """Max goal weight per competency across the user's goals (neutral 0.5 when no goals)."""
    goals = list(db.scalars(select(UserGoal).where(UserGoal.user_id == user_id).options(joinedload(UserGoal.goal))))
    out: dict[int, Relevance] = {}
    if not goals:
        return out
    weights = db.scalars(
        select(GoalCompetencyWeight).where(GoalCompetencyWeight.goal_id.in_([g.goal_id for g in goals]))
    )
    goal_by_id = {g.goal_id: g.goal for g in goals}
    for w in weights:
        cur = out.get(w.competency_id)
        if cur is None or w.weight > cur.value:
            out[w.competency_id] = Relevance(w.weight, goal_by_id[w.goal_id])
    return out


def relevance_for(rel: dict[int, Relevance], competency_id: int, has_goals: bool) -> Relevance:
    if competency_id in rel:
        return rel[competency_id]
    return Relevance(NEUTRAL_RELEVANCE if not has_goals else 0.2, None)
