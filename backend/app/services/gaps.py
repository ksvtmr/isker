"""Gap analysis.

For each competency:
    target   = default target (70) + 5 when the competency is central to the user's goals (relevance ≥ 0.7)
    gap      = max(0, target − current score)
    band     = High ≥ 20 · Medium 10–19 · Low < 10
    priority = 0.50 · min(gap / 30, 1)       (gap size)
             + 0.25 · goal relevance           (0–1, from the user's goals)
             + 0.15 · competency importance    (0–1, EntreComp weighting)
             + 0.10 · learning priority        (0–1, how foundational it is for other competencies)
    Competencies without a gap get priority 0 and are ranked after all gaps (lowest score first).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AssessmentAttempt, Competency, CompetencyGap, UserGoal
from app.models.enums import GapBand
from app.services.levels import gap_band
from app.services.profile import current_scores, goal_relevance, relevance_for

GOAL_TARGET_BOOST = 5
GOAL_CENTRAL = 0.7


@dataclass
class GapInput:
    competency_id: int
    score: int
    relevance: float
    importance: float
    learning_priority: float
    default_target: int = 70


@dataclass
class GapCalc:
    competency_id: int
    current: int
    target: int
    gap: int
    band: GapBand
    relevance: float
    importance: float
    learning_priority: float
    priority_score: float
    rank: int = 0
    label: str = "Low"


def priority_label(p: float, gap: int) -> str:
    if gap <= 0:
        return "None"
    return "High" if p >= 0.55 else "Medium" if p >= 0.35 else "Low"


def analyze(inputs: list[GapInput]) -> list[GapCalc]:
    """Pure function: compute gaps and a priority ranking."""
    out: list[GapCalc] = []
    for i in inputs:
        target = i.default_target + (GOAL_TARGET_BOOST if i.relevance >= GOAL_CENTRAL else 0)
        gap = max(0, target - i.score)
        p = 0.0
        if gap > 0:
            p = 0.5 * min(gap / 30, 1) + 0.25 * i.relevance + 0.15 * i.importance + 0.10 * i.learning_priority
        out.append(
            GapCalc(
                i.competency_id,
                i.score,
                target,
                gap,
                gap_band(gap),
                i.relevance,
                i.importance,
                i.learning_priority,
                round(p, 4),
            )
        )
    out.sort(key=lambda g: (-g.priority_score, g.current, g.competency_id))
    for rank, g in enumerate(out, start=1):
        g.rank = rank
        g.label = priority_label(g.priority_score, g.gap)
    return out


def compute_and_store(db: Session, attempt: AssessmentAttempt) -> list[CompetencyGap]:
    user_id = attempt.user_id
    scores = current_scores(db, user_id)
    rel = goal_relevance(db, user_id)
    has_goals = db.scalar(select(UserGoal.id).where(UserGoal.user_id == user_id).limit(1)) is not None
    comps = {c.id: c for c in db.scalars(select(Competency))}
    inputs = [
        GapInput(
            cid,
            s.score,
            relevance_for(rel, cid, has_goals).value,
            comps[cid].importance,
            comps[cid].learning_priority,
            comps[cid].default_target,
        )
        for cid, s in scores.items()
    ]
    rows = []
    for g in analyze(inputs):
        row = CompetencyGap(
            attempt_id=attempt.id,
            user_id=user_id,
            competency_id=g.competency_id,
            current_score=g.current,
            target_score=g.target,
            gap=g.gap,
            band=g.band,
            goal_relevance=g.relevance,
            importance=g.importance,
            learning_priority=g.learning_priority,
            priority_score=g.priority_score,
            priority_rank=g.rank,
            priority_label=g.label,
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def latest_gaps(db: Session, user_id: int) -> list[CompetencyGap]:
    last_attempt_id = db.scalar(
        select(CompetencyGap.attempt_id)
        .join(AssessmentAttempt, AssessmentAttempt.id == CompetencyGap.attempt_id)
        .where(CompetencyGap.user_id == user_id)
        .order_by(AssessmentAttempt.completed_at.desc(), AssessmentAttempt.id.desc())
        .limit(1)
    )
    if last_attempt_id is None:
        return []
    return list(
        db.scalars(
            select(CompetencyGap)
            .where(CompetencyGap.attempt_id == last_attempt_id)
            .order_by(CompetencyGap.priority_rank)
        )
    )
