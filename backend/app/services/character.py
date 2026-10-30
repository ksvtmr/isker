"""Character progression: which of four development stages the learner's confirmed results correspond to.

The stage is a visual summary of the current competency profile, not a judgement of the person. It is computed only
here, on the server, from stored results:

    assessment score  = overall score of the current profile (mean of the latest score of every competency, 0–100;
                        services/profile.overall_score — the same number the dashboard shows)
    practice score    = mean AI rubric score of completed practical tasks whose evaluation succeeded (a heuristic
                        fallback after a failed AI call is not counted as confirmed); counted from PRACTICE_MIN_TASKS
    stage score       = assessment score, or (1 − PRACTICE_WEIGHT) · assessment + PRACTICE_WEIGHT · practice
    stage             = STAGE_BANDS band of the stage score

Viewing or completing learning resources never changes the stage. A stage change is recorded as an append-only
CharacterStageEvent only when a confirmed result is saved (assessment submitted, practical task completed), in the
same transaction as that result; reading the dashboard never records one.

The thresholds are preliminary product thresholds kept in configuration (STAGE_BANDS); they are not scientifically
validated. Change RULES_VERSION whenever they or the formula change.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models import (
    AIEvaluation,
    AssessmentAttempt,
    CharacterStageEvent,
    Competency,
    PracticalTask,
    PracticeSubmission,
)
from app.models.enums import AIEvalStatus, AttemptScope, AttemptStatus, ContentStatus, PracticeStatus
from app.services.profile import current_scores, overall_score

RULES_VERSION = "stage-v1"

# (stage, key, min score, max score). Preliminary product thresholds, not scientifically validated.
STAGE_BANDS: list[tuple[int, str, int, int]] = [
    (1, "novice", 0, 24),
    (2, "starter", 25, 49),
    (3, "entrepreneur", 50, 74),
    (4, "leader", 75, 100),
]
PRACTICE_WEIGHT = 0.2
PRACTICE_MIN_TASKS = 2
# Share of published competencies that must have a current score, and share of those whose evidence is at least
# "limited", before the profile is summarised as one stage.
MIN_COVERAGE = 0.8
MIN_EVIDENCE = 0.6
CONFIRMED_AI = (AIEvalStatus.SUCCESS, AIEvalStatus.RETRIED)


@dataclass
class UserProgress:
    """Confirmed inputs of the stage rule (all from the database)."""

    has_full_assessment: bool
    assessment_score: int | None
    competencies_assessed: int
    competencies_total: int
    competencies_with_evidence: int
    practice_scores: list[int] = field(default_factory=list)
    latest_attempt_id: int | None = None


@dataclass
class StageResult:
    status: str  # "no_assessment" | "insufficient_data" | "ready"
    stage: int | None = None
    key: str | None = None
    score: int | None = None
    assessment_score: int | None = None
    practice_score: int | None = None
    practice_tasks: int = 0
    practice_counted: bool = False
    progress_pct: int | None = None  # within the current band, towards the next stage
    next_stage: int | None = None
    points_to_next: int | None = None
    basis: dict = field(default_factory=dict)


def band_for(score: int) -> tuple[int, str, int, int]:
    s = max(0, min(100, int(score)))
    for band in STAGE_BANDS:
        if band[2] <= s <= band[3]:
            return band
    return STAGE_BANDS[0]


def progress_in_band(score: int, stage: int) -> tuple[int, int | None, int | None]:
    """(percent through the band of `stage`, next stage, points to it). The last stage has no next one."""
    _, _, lo, hi = STAGE_BANDS[stage - 1]
    if stage == len(STAGE_BANDS):
        return 100, None, None
    nxt = STAGE_BANDS[stage][2]
    pct = round((min(max(score, lo), nxt) - lo) / (nxt - lo) * 100)
    return max(0, min(100, pct)), stage + 1, max(0, nxt - score)


def get_character_stage(progress: UserProgress) -> StageResult:
    """Pure stage rule (see the module docstring)."""
    basis = {
        "rules_version": RULES_VERSION,
        "competencies_assessed": progress.competencies_assessed,
        "competencies_total": progress.competencies_total,
        "competencies_with_evidence": progress.competencies_with_evidence,
        "practice_weight": PRACTICE_WEIGHT,
        "practice_min_tasks": PRACTICE_MIN_TASKS,
        "attempt_id": progress.latest_attempt_id,
    }
    if not progress.has_full_assessment or progress.assessment_score is None:
        return StageResult(status="no_assessment", basis=basis)
    total = max(1, progress.competencies_total)
    assessed = progress.competencies_assessed
    if assessed / total < MIN_COVERAGE or progress.competencies_with_evidence / max(1, assessed) < MIN_EVIDENCE:
        return StageResult(status="insufficient_data", assessment_score=progress.assessment_score, basis=basis)
    tasks = len(progress.practice_scores)
    practice = round(sum(progress.practice_scores) / tasks) if tasks else None
    counted = practice is not None and tasks >= PRACTICE_MIN_TASKS
    if counted and practice is not None:
        score = round((1 - PRACTICE_WEIGHT) * progress.assessment_score + PRACTICE_WEIGHT * practice)
    else:
        score = progress.assessment_score
    score = max(0, min(100, score))
    stage, key, _, _ = band_for(score)
    pct, nxt, to_next = progress_in_band(score, stage)
    return StageResult(
        status="ready", stage=stage, key=key, score=score, assessment_score=progress.assessment_score,
        practice_score=practice, practice_tasks=tasks, practice_counted=counted, progress_pct=pct, next_stage=nxt,
        points_to_next=to_next, basis=basis,
    )


def collect_progress(db: Session, user_id: int) -> UserProgress:
    """Read the confirmed inputs. Learning resources are deliberately not part of it."""
    published = set(db.scalars(select(Competency.id).where(Competency.status == ContentStatus.PUBLISHED)))
    profile = {cid: s for cid, s in current_scores(db, user_id).items() if cid in published}
    has_full = (
        db.scalar(
            select(func.count(AssessmentAttempt.id)).where(
                AssessmentAttempt.user_id == user_id,
                AssessmentAttempt.status == AttemptStatus.COMPLETED,
                AssessmentAttempt.scope == AttemptScope.FULL,
            )
        )
        or 0
    ) > 0
    latest_attempt = db.scalar(
        select(AssessmentAttempt.id)
        .where(AssessmentAttempt.user_id == user_id, AssessmentAttempt.status == AttemptStatus.COMPLETED)
        .order_by(AssessmentAttempt.completed_at.desc(), AssessmentAttempt.id.desc())
        .limit(1)
    )
    # Scores stored before evidence was recorded (evidence_level NULL) keep counting: their method is unchanged.
    with_evidence = sum(1 for s in profile.values() if s.evidence_level in (None, "sufficient", "limited"))
    return UserProgress(
        has_full_assessment=has_full,
        assessment_score=overall_score(profile),
        competencies_assessed=len(profile),
        competencies_total=len(published),
        competencies_with_evidence=with_evidence,
        practice_scores=confirmed_practice_scores(db, user_id),
        latest_attempt_id=latest_attempt,
    )


def confirmed_practice_scores(db: Session, user_id: int) -> list[int]:
    """Scores of completed practical tasks whose latest AI evaluation succeeded (not the heuristic fallback)."""
    latest = (
        select(AIEvaluation.practice_submission_id, func.max(AIEvaluation.id).label("eid"))
        .where(AIEvaluation.practice_submission_id.is_not(None))
        .group_by(AIEvaluation.practice_submission_id)
        .subquery()
    )
    rows = db.execute(
        select(AIEvaluation.status, AIEvaluation.score)
        .join(latest, latest.c.eid == AIEvaluation.id)
        .join(PracticeSubmission, PracticeSubmission.id == AIEvaluation.practice_submission_id)
        .join(PracticalTask, PracticalTask.id == PracticeSubmission.task_id)
        .join(Competency, Competency.id == PracticalTask.competency_id)
        .where(
            PracticeSubmission.user_id == user_id,
            PracticeSubmission.status == PracticeStatus.COMPLETED,
            Competency.status == ContentStatus.PUBLISHED,
        )
    ).all()
    return [int(score) for status, score in rows if status in CONFIRMED_AI and score is not None]


def latest_event(db: Session, user_id: int) -> CharacterStageEvent | None:
    return db.scalar(
        select(CharacterStageEvent)
        .where(CharacterStageEvent.user_id == user_id)
        .order_by(CharacterStageEvent.sequence.desc())
        .limit(1)
    )


def _append(
    db: Session, user_id: int, result: StageResult, trigger: str, *, attempt_id: int | None = None,
    submission_id: int | None = None, when: datetime | None = None, seen: bool = False,
) -> CharacterStageEvent | None:
    prev = latest_event(db, user_id)
    if prev is not None and prev.stage == result.stage:
        return None
    assert result.stage is not None and result.score is not None and result.assessment_score is not None
    now = when or utcnow()
    direction = "initial" if prev is None else ("up" if result.stage > prev.stage else "down")
    ev = CharacterStageEvent(
        user_id=user_id,
        sequence=(prev.sequence + 1) if prev else 1,
        stage=result.stage,
        previous_stage=prev.stage if prev else None,
        direction=direction,
        score=result.score,
        assessment_score=result.assessment_score,
        practice_score=result.practice_score if result.practice_counted else None,
        practice_tasks=result.practice_tasks,
        basis=result.basis,
        rules_version=RULES_VERSION,
        trigger=trigger,
        attempt_id=attempt_id,
        practice_submission_id=submission_id,
        confirmed_at=now,
        seen_at=now if seen else None,
    )
    # Two confirmations at once: the (user_id, sequence) constraint lets one insert win; the other is dropped.
    try:
        with db.begin_nested():
            db.add(ev)
            db.flush()
    except IntegrityError:
        return None
    return ev


def record_confirmed_result(
    db: Session, user_id: int, trigger: str, *, attempt_id: int | None = None, submission_id: int | None = None
) -> CharacterStageEvent | None:
    """Call after a confirmed result is stored (same transaction). Appends an event only when the stage changed.
    Without enough data nothing is recorded: the last confirmed stage stays."""
    result = get_character_stage(collect_progress(db, user_id))
    if result.status != "ready":
        return None
    return _append(db, user_id, result, trigger, attempt_id=attempt_id, submission_id=submission_id)


def ensure_baseline(db: Session, user_id: int, result: StageResult) -> CharacterStageEvent | None:
    """Profiles confirmed before this feature existed get their first stage once, marked as already seen (no
    congratulation). Only when no event exists at all, so it never creates a transition."""
    if result.status != "ready" or latest_event(db, user_id) is not None:
        return None
    return _append(db, user_id, result, "baseline", attempt_id=result.basis.get("attempt_id"), seen=True)


def history(db: Session, user_id: int) -> list[CharacterStageEvent]:
    return list(
        db.scalars(
            select(CharacterStageEvent)
            .where(CharacterStageEvent.user_id == user_id)
            .order_by(CharacterStageEvent.sequence.asc())
        )
    )


def mark_seen(db: Session, user_id: int, event_id: int) -> CharacterStageEvent | None:
    ev = db.scalar(
        select(CharacterStageEvent).where(CharacterStageEvent.id == event_id, CharacterStageEvent.user_id == user_id)
    )
    if ev is not None and ev.seen_at is None:
        ev.seen_at = utcnow()
    return ev


def result_dict(result: StageResult) -> dict:
    return asdict(result)
