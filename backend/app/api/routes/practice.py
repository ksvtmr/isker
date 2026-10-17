from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.ai.providers import heuristic_evaluation
from app.ai.service import RULE_BASED, evaluate_text
from app.api.deps import DB, CurrentUser
from app.core.content_i18n import base_text, match_ratings, rubric_aliases
from app.core.context import language_var
from app.core.database import utcnow
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.ratelimit import enforce
from app.models import AIEvaluation, Competency, PracticalTask, PracticeSubmission, Recommendation
from app.models.enums import AIInputType, ContentStatus, PracticeStatus, RecommendationStatus
from app.schemas.common import ERROR_RESPONSES
from app.schemas.learning import FeedbackOut, SubmitIn, TaskDetail, TaskOut
from app.services import entitlements
from app.services import recommendations as rec_service
from app.services.audit import audit

router = APIRouter(prefix="/api/practice", tags=["practice"], responses=ERROR_RESPONSES)


def _recs(db, user_id: int) -> dict[int, Recommendation]:
    return {
        r.task_id: r
        for r in db.scalars(
            select(Recommendation).where(
                Recommendation.user_id == user_id,
                Recommendation.status == RecommendationStatus.ACTIVE,
                Recommendation.task_id.is_not(None),
            )
        )
    }


def _base(t: PracticalTask, s: PracticeSubmission | None, recommended: bool) -> dict:
    return dict(
        id=t.id,
        slug=t.slug,
        title=t.title,
        description=t.description,
        difficulty=t.difficulty,
        duration_minutes=t.duration_minutes,
        competency_id=t.competency_id,
        competency_code=t.competency.code,
        competency_name=t.competency.name,
        status=s.status if s else None,
        recommended=recommended,
        feedback_score=s.feedback_score if s else None,
    )


@router.get("/tasks", response_model=list[TaskOut], summary="Practical entrepreneurship tasks")
def list_tasks(user: CurrentUser, db: DB, competency: str | None = None) -> list[TaskOut]:
    stmt = (
        select(PracticalTask)
        .join(Competency)
        .where(PracticalTask.status == ContentStatus.PUBLISHED, Competency.status == ContentStatus.PUBLISHED)
        .options(joinedload(PracticalTask.competency))
        .order_by(Competency.sort_order, PracticalTask.id)
    )
    if competency:
        stmt = stmt.where(Competency.code == competency)
    subs = {s.task_id: s for s in db.scalars(select(PracticeSubmission).where(PracticeSubmission.user_id == user.id))}
    recs = _recs(db, user.id)
    rows = sorted(db.scalars(stmt), key=lambda t: (t.id not in recs, t.competency.sort_order, t.id))
    return [TaskOut(**_base(t, subs.get(t.id), t.id in recs)) for t in rows]


def _get(db, task_id: int, history_user_id: int | None = None) -> PracticalTask:
    """A published task. With `history_user_id`, an unpublished task the user already submitted to stays readable
    (their submission and feedback history), but nothing new can be started on it."""
    t = db.scalar(
        select(PracticalTask).where(PracticalTask.id == task_id).options(joinedload(PracticalTask.competency))
    )
    if t is None or (t.status != ContentStatus.PUBLISHED and (
        history_user_id is None or _sub(db, history_user_id, t.id) is None
    )):
        raise NotFoundError("Practical task not found", "TASK_NOT_FOUND")
    return t


def _sub(db, user_id: int, task_id: int) -> PracticeSubmission | None:
    return db.scalar(
        select(PracticeSubmission).where(PracticeSubmission.user_id == user_id, PracticeSubmission.task_id == task_id)
    )


def _ensure_sub(db, user_id: int, task_id: int) -> tuple[PracticeSubmission, bool]:
    """The user's submission row, created (status started) when missing. A concurrent first request that inserts it
    too hits the (user_id, task_id) unique constraint inside a savepoint and re-reads the winner's row instead of
    failing with a 500. Returns (row, created)."""
    s = _sub(db, user_id, task_id)
    if s is not None:
        return s, False
    try:
        with db.begin_nested():
            s = PracticeSubmission(user_id=user_id, task_id=task_id, status=PracticeStatus.STARTED)
            db.add(s)
            db.flush()
        return s, True
    except IntegrityError:
        s = _sub(db, user_id, task_id)
        if s is None:  # pragma: no cover - the conflicting row vanished again
            raise
        return s, False


def _feedback(ev: AIEvaluation | None, t: PracticalTask, response: str | None) -> FeedbackOut | None:
    if ev is None:
        return None
    out = ev.output or {}
    language = ev.language
    if ev.provider in RULE_BASED and t.rubric:
        # Deterministic feedback is composed again with the task rubric in the request language (keeping the stored
        # ratings), so its texts never mix the language it was first generated in with the current one.
        ratings = match_ratings(out.get("criteria") or [], rubric_aliases(base_text(t, "rubric"), t.translations))
        out = heuristic_evaluation(t.competency.name, response or ev.input_excerpt or "", t.rubric, ratings)
        language = language_var.get()
        evidence, strengths, dev, explanation = (
            out["evidence"], out["strengths"], out["development_areas"], out["explanation"]
        )
    else:
        evidence, strengths, dev, explanation = (
            ev.evidence or [], ev.strengths or [], ev.development_areas or [], ev.explanation
        )
    return FeedbackOut(
        evaluation_id=ev.id,
        score=ev.score or 0,
        level=ev.level or "",
        confidence=ev.confidence,
        criteria=out.get("criteria", []),
        evidence=evidence,
        strengths=strengths,
        development_areas=dev,
        explanation=explanation,
        provider=ev.provider,
        language=language,
        created_at=ev.created_at,
    )


def _detail(db, user_id: int, t: PracticalTask) -> TaskDetail:
    s = _sub(db, user_id, t.id)
    rec = _recs(db, user_id).get(t.id)
    ev = (
        db.scalar(
            select(AIEvaluation).where(AIEvaluation.practice_submission_id == s.id).order_by(AIEvaluation.id.desc())
        )
        if s
        else None
    )
    return TaskDetail(
        **_base(t, s, rec is not None),
        instructions=t.instructions,
        rubric=[{"criterion": r["criterion"], "description": r["description"]} for r in t.rubric],
        min_length=t.min_length,
        response_text=s.response_text if s else None,
        started_at=s.started_at if s else None,
        submitted_at=s.submitted_at if s else None,
        completed_at=s.completed_at if s else None,
        feedback=_feedback(ev, t, s.response_text if s else None),
        reason=rec_service.localized_reason(rec) if rec else None,
    )


@router.get("/tasks/{task_id}", response_model=TaskDetail, summary="Task, your response and AI feedback")
def get_task(task_id: int, user: CurrentUser, db: DB) -> TaskDetail:
    return _detail(db, user.id, _get(db, task_id, user.id))


@router.post("/tasks/{task_id}/start", response_model=TaskDetail, summary="Start a task")
def start(task_id: int, user: CurrentUser, db: DB) -> TaskDetail:
    t = _get(db, task_id)
    if _sub(db, user.id, t.id) is None:
        entitlements.require(db, user, "practice.tasks")
        _, created = _ensure_sub(db, user.id, t.id)
        if created:
            audit(db, user.id, "practice.started", "practical_task", t.id)
    rec_service.on_task_started(db, user.id, t.id)
    db.commit()
    return _detail(db, user.id, t)


@router.post(
    "/tasks/{task_id}/submit",
    response_model=TaskDetail,
    summary="Submit a response and receive rubric-based AI feedback",
)
def submit(task_id: int, body: SubmitIn, user: CurrentUser, db: DB) -> TaskDetail:
    t = _get(db, task_id)
    text = body.response_text.strip()
    if len(text) < t.min_length:
        raise ValidationError(
            f"Write at least {t.min_length} characters so the feedback can be specific.", "RESPONSE_TOO_SHORT"
        )
    entitlements.require(db, user, "practice.ai_feedback", consume=0)
    enforce("ai_user", str(user.id))  # each submission is an AI evaluation (cost control)
    s = _sub(db, user.id, t.id)
    if s is None:
        entitlements.require(db, user, "practice.tasks")
        s, _ = _ensure_sub(db, user.id, t.id)
    if s.status == PracticeStatus.COMPLETED:
        raise ConflictError("This task is already completed.", "TASK_COMPLETED")
    s.response_text, s.status, s.submitted_at = text, PracticeStatus.SUBMITTED, utcnow()
    db.flush()
    res = evaluate_text(
        db,
        user_id=user.id,
        competency_id=t.competency_id,
        competency_name=t.competency.name,
        question=f"{t.title}\n{t.instructions}",
        answer=text,
        rubric=t.rubric,
        input_type=AIInputType.PRACTICE_SUBMISSION,
        practice_submission_id=s.id,
    )
    s.feedback_score = res.score
    rec_service.on_task_started(db, user.id, t.id)
    audit(db, user.id, "practice.submitted", "practical_task", t.id, score=res.score)
    db.commit()
    return _detail(db, user.id, t)


@router.post("/tasks/{task_id}/complete", response_model=TaskDetail, summary="Mark a submitted task complete")
def complete(task_id: int, user: CurrentUser, db: DB) -> TaskDetail:
    t = _get(db, task_id)
    s = _sub(db, user.id, t.id)
    if s is None or s.status == PracticeStatus.STARTED:
        raise ConflictError("Submit your response before completing the task.", "TASK_NOT_SUBMITTED")
    if s.status != PracticeStatus.COMPLETED:
        now = utcnow()
        s.status, s.completed_at = PracticeStatus.COMPLETED, now
        rec_service.on_task_completed(db, user.id, t.id, now)
        audit(db, user.id, "practice.completed", "practical_task", t.id)
        db.commit()
    return _detail(db, user.id, t)
