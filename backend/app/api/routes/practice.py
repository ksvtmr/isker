from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.ai.service import evaluate_text
from app.api.deps import DB, CurrentUser
from app.core.database import utcnow
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models import AIEvaluation, Competency, PracticalTask, PracticeSubmission, Recommendation
from app.models.enums import AIInputType, PracticeStatus, RecommendationStatus
from app.schemas.common import ERROR_RESPONSES
from app.schemas.learning import FeedbackOut, SubmitIn, TaskDetail, TaskOut
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
        .where(PracticalTask.is_published.is_(True))
        .options(joinedload(PracticalTask.competency))
        .order_by(Competency.sort_order, PracticalTask.id)
    )
    if competency:
        stmt = stmt.where(Competency.code == competency)
    subs = {s.task_id: s for s in db.scalars(select(PracticeSubmission).where(PracticeSubmission.user_id == user.id))}
    recs = _recs(db, user.id)
    rows = sorted(db.scalars(stmt), key=lambda t: (t.id not in recs, t.competency.sort_order, t.id))
    return [TaskOut(**_base(t, subs.get(t.id), t.id in recs)) for t in rows]


def _get(db, task_id: int) -> PracticalTask:
    t = db.scalar(
        select(PracticalTask)
        .where(PracticalTask.id == task_id, PracticalTask.is_published.is_(True))
        .options(joinedload(PracticalTask.competency))
    )
    if t is None:
        raise NotFoundError("Practical task not found", "TASK_NOT_FOUND")
    return t


def _sub(db, user_id: int, task_id: int) -> PracticeSubmission | None:
    return db.scalar(
        select(PracticeSubmission).where(PracticeSubmission.user_id == user_id, PracticeSubmission.task_id == task_id)
    )


def _feedback(ev: AIEvaluation | None) -> FeedbackOut | None:
    if ev is None:
        return None
    return FeedbackOut(
        evaluation_id=ev.id,
        score=ev.score or 0,
        level=ev.level or "",
        confidence=ev.confidence,
        criteria=(ev.output or {}).get("criteria", []),
        evidence=ev.evidence or [],
        strengths=ev.strengths or [],
        development_areas=ev.development_areas or [],
        explanation=ev.explanation,
        provider=ev.provider,
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
        feedback=_feedback(ev),
        reason=rec.reason if rec else None,
    )


@router.get("/tasks/{task_id}", response_model=TaskDetail, summary="Task, your response and AI feedback")
def get_task(task_id: int, user: CurrentUser, db: DB) -> TaskDetail:
    return _detail(db, user.id, _get(db, task_id))


@router.post("/tasks/{task_id}/start", response_model=TaskDetail, summary="Start a task")
def start(task_id: int, user: CurrentUser, db: DB) -> TaskDetail:
    t = _get(db, task_id)
    if _sub(db, user.id, t.id) is None:
        db.add(PracticeSubmission(user_id=user.id, task_id=t.id, status=PracticeStatus.STARTED))
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
    s = _sub(db, user.id, t.id)
    if s is None:
        s = PracticeSubmission(user_id=user.id, task_id=t.id, status=PracticeStatus.STARTED)
        db.add(s)
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
