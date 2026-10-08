"""Assessment engine: start/resume attempts, autosave answers, submit → score → gaps → plan → snapshot."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.ai.service import generate_insight
from app.core.database import utcnow
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models import (
    Answer,
    Assessment,
    AssessmentAttempt,
    Competency,
    LearningResource,
    PracticeSubmission,
    ProgressSnapshot,
    Question,
    QuestionCompetency,
    Reassessment,
    User,
    UserLearningProgress,
)
from app.models.enums import (
    AttemptScope,
    AttemptStatus,
    PracticeStatus,
    ProgressStatus,
    QuestionType,
)
from app.services import gaps as gap_service
from app.services import recommendations as rec_service
from app.services.audit import audit, notify
from app.services.levels import level_name_for
from app.services.profile import area_scores, current_scores, overall_score
from app.services.scoring import score_attempt

MAX_TEXT = 4000
CHOICE_TYPES = (QuestionType.LIKERT, QuestionType.SITUATIONAL)


def active_assessment(db: Session) -> Assessment:
    a = db.scalar(select(Assessment).where(Assessment.is_active.is_(True)).order_by(Assessment.id))
    if a is None:
        raise NotFoundError("No active assessment is configured.", "ASSESSMENT_NOT_FOUND")
    return a


def get_attempt(db: Session, user: User, attempt_id: int) -> AssessmentAttempt:
    att = db.scalar(
        select(AssessmentAttempt)
        .where(AssessmentAttempt.id == attempt_id, AssessmentAttempt.user_id == user.id)
        .options(selectinload(AssessmentAttempt.answers).selectinload(Answer.option))
    )
    if att is None:
        raise NotFoundError("Assessment attempt not found", "ATTEMPT_NOT_FOUND")
    return att


def questions_for(db: Session, attempt: AssessmentAttempt) -> list[Question]:
    q = (
        select(Question)
        .where(Question.assessment_id == attempt.assessment_id, Question.is_active.is_(True))
        .options(selectinload(Question.options), selectinload(Question.competency_links))
        .order_by(Question.sort_order, Question.id)
    )
    if attempt.scope == AttemptScope.COMPETENCY and attempt.scope_competency_id:
        q = q.where(
            Question.id.in_(
                select(QuestionCompetency.question_id).where(
                    QuestionCompetency.competency_id == attempt.scope_competency_id
                )
            )
        )
    return list(db.scalars(q))


def scope_competency_ids(db: Session, attempt: AssessmentAttempt, questions: list[Question]) -> list[int]:
    if attempt.scope == AttemptScope.COMPETENCY and attempt.scope_competency_id:
        return [attempt.scope_competency_id]
    ids = {link.competency_id for q in questions for link in q.competency_links}
    return [c.id for c in db.scalars(select(Competency).order_by(Competency.sort_order)) if c.id in ids]


def in_progress_attempt(db: Session, user_id: int) -> AssessmentAttempt | None:
    return db.scalar(
        select(AssessmentAttempt)
        .where(AssessmentAttempt.user_id == user_id, AssessmentAttempt.status == AttemptStatus.IN_PROGRESS)
        .order_by(AssessmentAttempt.id.desc())
    )


def start_attempt(
    db: Session, user: User, scope: AttemptScope, competency_id: int | None
) -> tuple[AssessmentAttempt, bool]:
    """Start a new attempt or resume the matching in-progress one. Returns (attempt, resumed)."""
    if scope == AttemptScope.COMPETENCY:
        if competency_id is None or db.get(Competency, competency_id) is None:
            raise ValidationError(
                "A valid competency is required for a competency reassessment.", "COMPETENCY_REQUIRED"
            )
    else:
        competency_id = None
    current = in_progress_attempt(db, user.id)
    if current is not None:
        if current.scope == scope and current.scope_competency_id == competency_id:
            return current, True
        # Only one attempt can be open at a time; the older one is abandoned (its answers are kept).
        current.status = AttemptStatus.ABANDONED
    assessment = active_assessment(db)
    att = AssessmentAttempt(
        user_id=user.id, assessment_id=assessment.id, scope=scope, scope_competency_id=competency_id
    )
    db.add(att)
    db.flush()
    previous = db.scalar(
        select(AssessmentAttempt.id)
        .where(AssessmentAttempt.user_id == user.id, AssessmentAttempt.status == AttemptStatus.COMPLETED)
        .order_by(AssessmentAttempt.completed_at.desc())
        .limit(1)
    )
    if previous is not None:
        db.add(
            Reassessment(
                user_id=user.id,
                attempt_id=att.id,
                previous_attempt_id=previous,
                competency_id=competency_id,
                reason="competency" if competency_id else "full",
            )
        )
    audit(db, user.id, "assessment.started", "assessment_attempt", att.id, scope=scope.value)
    return att, False


def save_answer(
    db: Session,
    attempt: AssessmentAttempt,
    question_id: int,
    option_id: int | None,
    text: str | None,
    position: int | None,
) -> Answer:
    if attempt.status != AttemptStatus.IN_PROGRESS:
        raise ConflictError("This assessment is already finished.", "ATTEMPT_NOT_IN_PROGRESS")
    questions = questions_for(db, attempt)
    q = next((x for x in questions if x.id == question_id), None)
    if q is None:
        raise NotFoundError("Question not found in this assessment", "QUESTION_NOT_FOUND")
    ans = next((a for a in attempt.answers if a.question_id == question_id), None)
    if ans is None:
        ans = Answer(attempt_id=attempt.id, question_id=q.id)
        db.add(ans)
        attempt.answers.append(ans)
    if q.type in CHOICE_TYPES:
        opt = next((o for o in q.options if o.id == option_id), None)
        if opt is None:
            raise ValidationError("Choose one of the answer options.", "INVALID_OPTION")
        ans.option_id, ans.option, ans.text_response = opt.id, opt, None
    else:
        text = (text or "").strip()
        if len(text) > MAX_TEXT:
            raise ValidationError(f"Answers can be at most {MAX_TEXT} characters.", "ANSWER_TOO_LONG")
        ans.text_response, ans.option_id = text, None
    ans.item_score = None
    if position is not None:
        attempt.current_index = max(0, min(position, len(questions) - 1))
    db.flush()
    return ans


def is_answered(q: Question, a: Answer | None) -> bool:
    if a is None:
        return False
    if q.type in CHOICE_TYPES:
        return a.option_id is not None
    return len((a.text_response or "").strip()) >= max(1, q.min_length)


def submit(db: Session, user: User, attempt: AssessmentAttempt) -> AssessmentAttempt:
    if attempt.status != AttemptStatus.IN_PROGRESS:
        raise ConflictError("This assessment is already finished.", "ATTEMPT_NOT_IN_PROGRESS")
    questions = questions_for(db, attempt)
    answers = {a.question_id: a for a in attempt.answers}
    missing = [i + 1 for i, q in enumerate(questions) if not is_answered(q, answers.get(q.id))]
    if missing:
        raise ValidationError(
            "Answer every question before finishing.", "ASSESSMENT_INCOMPLETE", {"unanswered": missing}
        )

    comp_ids = scope_competency_ids(db, attempt, questions)
    score_attempt(db, attempt, questions, comp_ids)

    now = utcnow()
    attempt.status = AttemptStatus.COMPLETED
    attempt.completed_at = now
    attempt.sequence = 1 + (
        db.scalar(
            select(func.count(AssessmentAttempt.id)).where(
                AssessmentAttempt.user_id == user.id,
                AssessmentAttempt.status == AttemptStatus.COMPLETED,
                AssessmentAttempt.id != attempt.id,
            )
        )
        or 0
    )
    db.flush()

    profile = current_scores(db, user.id)
    attempt.overall_score = overall_score(profile)
    rec_service.on_reassessed(db, user.id, set(comp_ids), now)
    gaps = gap_service.compute_and_store(db, attempt)
    recs = rec_service.refresh(db, attempt, gaps)
    write_snapshot(db, user.id, attempt, recs)
    insight_for_attempt(db, user.id, attempt, profile, gaps, recs)
    notify(
        db,
        user.id,
        "assessment.completed",
        "Your competency profile is ready",
        f"Overall score {attempt.overall_score} / 100.",
        f"/results?attempt={attempt.id}",
    )
    audit(
        db,
        user.id,
        "assessment.completed",
        "assessment_attempt",
        attempt.id,
        overall=attempt.overall_score,
        competencies=len(comp_ids),
    )
    db.flush()
    return attempt


def write_snapshot(db: Session, user_id: int, attempt: AssessmentAttempt, recs) -> ProgressSnapshot:
    profile = current_scores(db, user_id)
    areas = area_scores(db, profile)
    overall = overall_score(profile) or 0
    done_res = (
        db.scalar(
            select(func.count(UserLearningProgress.id)).where(
                UserLearningProgress.user_id == user_id, UserLearningProgress.status == ProgressStatus.COMPLETED
            )
        )
        or 0
    )
    done_tasks = (
        db.scalar(
            select(func.count(PracticeSubmission.id)).where(
                PracticeSubmission.user_id == user_id, PracticeSubmission.status == PracticeStatus.COMPLETED
            )
        )
        or 0
    )
    snap = ProgressSnapshot(
        user_id=user_id,
        attempt_id=attempt.id,
        overall_score=overall,
        ideas_score=areas.get("ideas") or 0,
        resources_score=areas.get("resources") or 0,
        action_score=areas.get("action") or 0,
        level=level_name_for(overall),
        completed_resources=done_res,
        completed_tasks=done_tasks,
        plan_progress_pct=rec_service.plan_progress(recs)[2],
        created_at=attempt.completed_at,
    )
    db.add(snap)
    return snap


def insight_for_attempt(db: Session, user_id: int, attempt: AssessmentAttempt, profile, gaps, recs) -> None:
    comps = {c.id: c for c in db.scalars(select(Competency))}
    if not profile:
        return
    best = max(profile.values(), key=lambda s: (s.score, -s.competency_id))
    top_gap = next((g for g in gaps if g.gap > 0), None)
    top_res = None
    if recs and recs[0].resource_id:
        r = db.get(LearningResource, recs[0].resource_id)
        top_res = r.title if r else None
    facts = {
        "overall": attempt.overall_score,
        "strongest": {"name": comps[best.competency_id].name, "score": best.score},
        "top_gap": (
            {"name": comps[top_gap.competency_id].name, "score": top_gap.current_score, "target": top_gap.target_score}
            if top_gap
            else None
        ),
        "top_resource": top_res,
    }
    generate_insight(db, user_id=user_id, facts=facts, attempt_id=attempt.id)
