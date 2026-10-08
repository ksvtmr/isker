from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import selectinload

from app.api.deps import DB, AdminUser
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models import (
    AIEvaluation,
    AIPromptVersion,
    Answer,
    Assessment,
    AssessmentAttempt,
    Competency,
    CompetencyScore,
    LearningResource,
    PracticalTask,
    PracticeSubmission,
    Question,
    QuestionCompetency,
    QuestionOption,
    User,
    UserLearningProgress,
)
from app.models.enums import (
    AIEvalStatus,
    AIInputType,
    AssessmentKind,
    AttemptStatus,
    PracticeStatus,
    ProgressStatus,
)
from app.schemas.admin import (
    AdminStats,
    AdminUserOut,
    AIEvaluationAdminOut,
    AssessmentAdminOut,
    AssessmentIn,
    AssessmentUpdate,
    CompetencyUpdate,
    PromptIn,
    PromptOut,
    QuestionAdminOut,
    QuestionIn,
    ResourceAdminOut,
    ResourceIn,
    TaskAdminOut,
    TaskIn,
)
from app.schemas.common import ERROR_RESPONSES, Message, Page
from app.schemas.competency import CompetencyOut
from app.services import views
from app.services.audit import audit

router = APIRouter(prefix="/api/admin", tags=["admin"], responses=ERROR_RESPONSES)


@router.get("/stats", response_model=AdminStats, summary="Platform and assessment statistics")
def stats(_: AdminUser, db: DB) -> AdminStats:
    def count(stmt) -> int:
        return db.scalar(stmt) or 0

    avg = db.scalar(
        select(func.avg(AssessmentAttempt.overall_score)).where(AssessmentAttempt.status == AttemptStatus.COMPLETED)
    )
    comp_avgs = db.execute(
        select(Competency.code, Competency.name, func.avg(CompetencyScore.score), func.count(CompetencyScore.id))
        .join(CompetencyScore, CompetencyScore.competency_id == Competency.id, isouter=True)
        .group_by(Competency.id)
        .order_by(Competency.sort_order)
    ).all()
    return AdminStats(
        users=count(select(func.count(User.id))),
        onboarded_users=count(select(func.count(User.id)).where(User.onboarding_completed.is_(True))),
        completed_attempts=count(
            select(func.count(AssessmentAttempt.id)).where(AssessmentAttempt.status == AttemptStatus.COMPLETED)
        ),
        in_progress_attempts=count(
            select(func.count(AssessmentAttempt.id)).where(AssessmentAttempt.status == AttemptStatus.IN_PROGRESS)
        ),
        average_overall=round(float(avg), 1) if avg is not None else None,
        ai_evaluations=count(select(func.count(AIEvaluation.id))),
        ai_fallbacks=count(select(func.count(AIEvaluation.id)).where(AIEvaluation.status == AIEvalStatus.FALLBACK)),
        resources_completed=count(
            select(func.count(UserLearningProgress.id)).where(UserLearningProgress.status == ProgressStatus.COMPLETED)
        ),
        tasks_completed=count(
            select(func.count(PracticeSubmission.id)).where(PracticeSubmission.status == PracticeStatus.COMPLETED)
        ),
        competency_averages=[
            {"code": c, "name": n, "average": round(float(a), 1) if a is not None else None, "measurements": k}
            for c, n, a, k in comp_avgs
        ],
    )


@router.get("/users", response_model=Page[AdminUserOut], summary="Users")
def users(
    _: AdminUser,
    db: DB,
    q: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> Page:
    stmt = select(User)
    if q:
        stmt = stmt.where(or_(User.email.ilike(f"%{q}%"), User.full_name.ilike(f"%{q}%")))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(User.id).offset((page - 1) * page_size).limit(page_size))
    items = []
    for u in rows:
        out = AdminUserOut.model_validate(u)
        done = list(
            db.scalars(
                select(AssessmentAttempt)
                .where(AssessmentAttempt.user_id == u.id, AssessmentAttempt.status == AttemptStatus.COMPLETED)
                .order_by(AssessmentAttempt.completed_at)
            )
        )
        out.completed_attempts = len(done)
        out.latest_overall = done[-1].overall_score if done else None
        items.append(out)
    return Page[AdminUserOut](items=items, total=total, page=page, page_size=page_size)


# --- Competencies ----------------------------------------------------------------------------------


@router.get("/competencies", response_model=list[CompetencyOut], summary="Competencies")
def competencies(_: AdminUser, db: DB) -> list[CompetencyOut]:
    return [CompetencyOut.model_validate(c) for c in views.competencies(db)]


@router.put("/competencies/{competency_id}", response_model=CompetencyOut, summary="Edit a competency")
def update_competency(competency_id: int, body: CompetencyUpdate, admin: AdminUser, db: DB) -> CompetencyOut:
    c = db.get(Competency, competency_id)
    if c is None:
        raise NotFoundError("Competency not found", "COMPETENCY_NOT_FOUND")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    audit(db, admin.id, "admin.competency_updated", "competency", c.id, fields=sorted(body.model_fields_set))
    db.commit()
    return CompetencyOut.model_validate(next(x for x in views.competencies(db) if x.id == c.id))


# --- Questions -------------------------------------------------------------------------------------


def _q_out(db, q: Question) -> QuestionAdminOut:
    n = db.scalar(select(func.count(Answer.id)).where(Answer.question_id == q.id)) or 0
    return QuestionAdminOut(
        id=q.id,
        assessment_id=q.assessment_id,
        sort_order=q.sort_order,
        type=q.type,
        section=q.section,
        text=q.text,
        help_text=q.help_text,
        reverse_scored=q.reverse_scored,
        min_length=q.min_length,
        is_active=q.is_active,
        options=[{"id": o.id, "label": o.label, "score": o.score, "value": o.value} for o in q.options],
        competencies=[{"competency_id": link.competency_id, "weight": link.weight} for link in q.competency_links],
        rubric=q.rubric or [],
        answer_count=n,
    )


def _get_q(db, qid: int) -> Question:
    q = db.scalar(
        select(Question)
        .where(Question.id == qid)
        .options(selectinload(Question.options), selectinload(Question.competency_links))
    )
    if q is None:
        raise NotFoundError("Question not found", "QUESTION_NOT_FOUND")
    return q


@router.get("/questions", response_model=list[QuestionAdminOut], summary="Question bank")
def questions(_: AdminUser, db: DB, assessment_id: int | None = None) -> list[QuestionAdminOut]:
    stmt = select(Question).options(selectinload(Question.options), selectinload(Question.competency_links))
    if assessment_id:
        stmt = stmt.where(Question.assessment_id == assessment_id)
    return [_q_out(db, q) for q in db.scalars(stmt.order_by(Question.assessment_id, Question.sort_order))]


def _apply_question(db, q: Question, body: QuestionIn) -> None:
    comp_ids = {c.id for c in db.scalars(select(Competency))}
    codes = {c.code for c in db.scalars(select(Competency))}
    if any(link.competency_id not in comp_ids for link in body.competencies):
        raise ValidationError("Unknown competency in mapping.", "INVALID_COMPETENCY")
    if any(r.competency and r.competency not in codes for r in body.rubric):
        raise ValidationError("Unknown competency code in rubric.", "INVALID_COMPETENCY")
    if db.get(Assessment, body.assessment_id) is None:
        raise ValidationError("Unknown assessment.", "INVALID_ASSESSMENT")
    q.assessment_id, q.type, q.section, q.text = body.assessment_id, body.type, body.section, body.text
    q.help_text, q.reverse_scored, q.min_length, q.is_active = (
        body.help_text,
        body.reverse_scored,
        body.min_length,
        body.is_active,
    )
    q.rubric = [r.model_dump() for r in body.rubric] or None
    if body.sort_order is not None:
        q.sort_order = body.sort_order
    q.options.clear()
    q.competency_links.clear()
    db.flush()
    for i, o in enumerate(body.options):
        q.options.append(QuestionOption(sort_order=i, label=o.label, score=o.score, value=o.value))
    for link in body.competencies:
        q.competency_links.append(QuestionCompetency(competency_id=link.competency_id, weight=link.weight))


@router.post("/questions", response_model=QuestionAdminOut, status_code=status.HTTP_201_CREATED)
def create_question(body: QuestionIn, admin: AdminUser, db: DB) -> QuestionAdminOut:
    last = db.scalar(select(func.max(Question.sort_order)).where(Question.assessment_id == body.assessment_id)) or 0
    q = Question(
        sort_order=body.sort_order or last + 1,
        assessment_id=body.assessment_id,
        type=body.type,
        section=body.section,
        text=body.text,
    )
    db.add(q)
    _apply_question(db, q, body)
    db.flush()
    audit(db, admin.id, "admin.question_created", "question", q.id)
    db.commit()
    return _q_out(db, _get_q(db, q.id))


@router.put("/questions/{question_id}", response_model=QuestionAdminOut)
def update_question(question_id: int, body: QuestionIn, admin: AdminUser, db: DB) -> QuestionAdminOut:
    q = _get_q(db, question_id)
    answered = db.scalar(select(func.count(Answer.id)).where(Answer.question_id == q.id)) or 0
    if answered and (q.type != body.type or len(q.options) != len(body.options)):
        raise ConflictError(
            "This question already has answers. Deactivate it and create a new one instead.", "QUESTION_IN_USE"
        )
    _apply_question(db, q, body)
    audit(db, admin.id, "admin.question_updated", "question", q.id)
    db.commit()
    return _q_out(db, _get_q(db, q.id))


@router.delete("/questions/{question_id}", response_model=Message, summary="Deactivate (history is preserved)")
def deactivate_question(question_id: int, admin: AdminUser, db: DB) -> Message:
    q = _get_q(db, question_id)
    q.is_active = False
    audit(db, admin.id, "admin.question_deactivated", "question", q.id)
    db.commit()
    return Message(message="Question deactivated")


# --- Assessments -----------------------------------------------------------------------------------


def _a_out(db, a: Assessment) -> AssessmentAdminOut:
    out = AssessmentAdminOut.model_validate(a)
    out.question_count = (
        db.scalar(select(func.count(Question.id)).where(Question.assessment_id == a.id, Question.is_active.is_(True)))
        or 0
    )
    out.attempt_count = (
        db.scalar(select(func.count(AssessmentAttempt.id)).where(AssessmentAttempt.assessment_id == a.id)) or 0
    )
    return out


@router.get("/assessments", response_model=list[AssessmentAdminOut])
def assessments(_: AdminUser, db: DB) -> list[AssessmentAdminOut]:
    return [_a_out(db, a) for a in db.scalars(select(Assessment).order_by(Assessment.id))]


@router.post("/assessments", response_model=AssessmentAdminOut, status_code=status.HTTP_201_CREATED)
def create_assessment(body: AssessmentIn, admin: AdminUser, db: DB) -> AssessmentAdminOut:
    if db.scalar(select(Assessment.id).where(Assessment.code == body.code)):
        raise ConflictError("An assessment with this code exists.", "ASSESSMENT_CODE_TAKEN")
    a = Assessment(kind=AssessmentKind.FULL, **body.model_dump())
    db.add(a)
    db.flush()
    audit(db, admin.id, "admin.assessment_created", "assessment", a.id)
    db.commit()
    return _a_out(db, a)


@router.put("/assessments/{assessment_id}", response_model=AssessmentAdminOut)
def update_assessment(assessment_id: int, body: AssessmentUpdate, admin: AdminUser, db: DB) -> AssessmentAdminOut:
    a = db.get(Assessment, assessment_id)
    if a is None:
        raise NotFoundError("Assessment not found", "ASSESSMENT_NOT_FOUND")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(a, k, v)
    a.version += 1
    audit(db, admin.id, "admin.assessment_updated", "assessment", a.id)
    db.commit()
    return _a_out(db, a)


# --- Resources & tasks -----------------------------------------------------------------------------


def _check_comp(db, cid: int) -> None:
    if db.get(Competency, cid) is None:
        raise ValidationError("Unknown competency.", "INVALID_COMPETENCY")


@router.get("/resources", response_model=list[ResourceAdminOut])
def resources(_: AdminUser, db: DB) -> list[LearningResource]:
    return list(db.scalars(select(LearningResource).order_by(LearningResource.competency_id, LearningResource.id)))


@router.post("/resources", response_model=ResourceAdminOut, status_code=status.HTTP_201_CREATED)
def create_resource(body: ResourceIn, admin: AdminUser, db: DB) -> LearningResource:
    _check_comp(db, body.competency_id)
    if db.scalar(select(LearningResource.id).where(LearningResource.slug == body.slug)):
        raise ConflictError("A resource with this slug exists.", "SLUG_TAKEN")
    r = LearningResource(**body.model_dump())
    db.add(r)
    db.flush()
    audit(db, admin.id, "admin.resource_created", "learning_resource", r.id)
    db.commit()
    return r


@router.put("/resources/{resource_id}", response_model=ResourceAdminOut)
def update_resource(resource_id: int, body: ResourceIn, admin: AdminUser, db: DB) -> LearningResource:
    r = db.get(LearningResource, resource_id)
    if r is None:
        raise NotFoundError("Resource not found", "RESOURCE_NOT_FOUND")
    _check_comp(db, body.competency_id)
    clash = db.scalar(
        select(LearningResource.id).where(LearningResource.slug == body.slug, LearningResource.id != r.id)
    )
    if clash:
        raise ConflictError("A resource with this slug exists.", "SLUG_TAKEN")
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    audit(db, admin.id, "admin.resource_updated", "learning_resource", r.id)
    db.commit()
    return r


@router.delete("/resources/{resource_id}", response_model=Message, summary="Unpublish a resource")
def unpublish_resource(resource_id: int, admin: AdminUser, db: DB) -> Message:
    r = db.get(LearningResource, resource_id)
    if r is None:
        raise NotFoundError("Resource not found", "RESOURCE_NOT_FOUND")
    r.is_published = False
    audit(db, admin.id, "admin.resource_unpublished", "learning_resource", r.id)
    db.commit()
    return Message(message="Resource unpublished")


@router.get("/tasks", response_model=list[TaskAdminOut])
def tasks(_: AdminUser, db: DB) -> list[PracticalTask]:
    return list(db.scalars(select(PracticalTask).order_by(PracticalTask.competency_id, PracticalTask.id)))


@router.post("/tasks", response_model=TaskAdminOut, status_code=status.HTTP_201_CREATED)
def create_task(body: TaskIn, admin: AdminUser, db: DB) -> PracticalTask:
    _check_comp(db, body.competency_id)
    if db.scalar(select(PracticalTask.id).where(PracticalTask.slug == body.slug)):
        raise ConflictError("A task with this slug exists.", "SLUG_TAKEN")
    data = body.model_dump()
    t = PracticalTask(**data)
    db.add(t)
    db.flush()
    audit(db, admin.id, "admin.task_created", "practical_task", t.id)
    db.commit()
    return t


@router.put("/tasks/{task_id}", response_model=TaskAdminOut)
def update_task(task_id: int, body: TaskIn, admin: AdminUser, db: DB) -> PracticalTask:
    t = db.get(PracticalTask, task_id)
    if t is None:
        raise NotFoundError("Task not found", "TASK_NOT_FOUND")
    _check_comp(db, body.competency_id)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    audit(db, admin.id, "admin.task_updated", "practical_task", t.id)
    db.commit()
    return t


@router.delete("/tasks/{task_id}", response_model=Message, summary="Unpublish a task")
def unpublish_task(task_id: int, admin: AdminUser, db: DB) -> Message:
    t = db.get(PracticalTask, task_id)
    if t is None:
        raise NotFoundError("Task not found", "TASK_NOT_FOUND")
    t.is_published = False
    audit(db, admin.id, "admin.task_unpublished", "practical_task", t.id)
    db.commit()
    return Message(message="Task unpublished")


# --- AI governance ---------------------------------------------------------------------------------


@router.get("/ai/evaluations", response_model=Page[AIEvaluationAdminOut], summary="AI evaluation log")
def ai_evaluations(
    _: AdminUser,
    db: DB,
    status_filter: Annotated[AIEvalStatus | None, Query(alias="status")] = None,
    input_type: AIInputType | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> Page:
    stmt = select(AIEvaluation)
    if status_filter:
        stmt = stmt.where(AIEvaluation.status == status_filter)
    if input_type:
        stmt = stmt.where(AIEvaluation.input_type == input_type)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AIEvaluation.id.desc()).offset((page - 1) * page_size).limit(page_size))
    return Page[AIEvaluationAdminOut](
        items=[AIEvaluationAdminOut.model_validate(r) for r in rows], total=total, page=page, page_size=page_size
    )


@router.get("/ai/prompts", response_model=list[PromptOut], summary="Prompt versions")
def prompts(_: AdminUser, db: DB) -> list[AIPromptVersion]:
    return list(db.scalars(select(AIPromptVersion).order_by(AIPromptVersion.key, AIPromptVersion.version.desc())))


_PLACEHOLDERS = {
    "answer_evaluation": dict(competency="c", question="q", rubric="r", answer="a"),
    "profile_insight": dict(facts="{}"),
}


@router.post(
    "/ai/prompts", response_model=PromptOut, status_code=status.HTTP_201_CREATED, summary="Create a new prompt version"
)
def create_prompt(body: PromptIn, admin: AdminUser, db: DB) -> AIPromptVersion:
    try:
        body.user_template.format(**_PLACEHOLDERS[body.key])
    except (KeyError, IndexError, ValueError) as e:
        raise ValidationError(f"Template placeholders are invalid: {e}", "INVALID_TEMPLATE") from e
    version = (db.scalar(select(func.max(AIPromptVersion.version)).where(AIPromptVersion.key == body.key)) or 0) + 1
    pv = AIPromptVersion(
        key=body.key,
        version=version,
        system_prompt=body.system_prompt,
        user_template=body.user_template,
        notes=body.notes,
        is_active=False,
    )
    db.add(pv)
    db.flush()
    if body.activate:
        _activate(db, pv)
    audit(db, admin.id, "admin.prompt_created", "ai_prompt_version", pv.id, key=body.key, version=version)
    db.commit()
    return pv


def _activate(db, pv: AIPromptVersion) -> None:
    db.execute(update(AIPromptVersion).where(AIPromptVersion.key == pv.key).values(is_active=False))
    pv.is_active = True


@router.post("/ai/prompts/{prompt_id}/activate", response_model=PromptOut, summary="Activate a prompt version")
def activate_prompt(prompt_id: int, admin: AdminUser, db: DB) -> AIPromptVersion:
    pv = db.get(AIPromptVersion, prompt_id)
    if pv is None:
        raise NotFoundError("Prompt version not found")
    _activate(db, pv)
    audit(db, admin.id, "admin.prompt_activated", "ai_prompt_version", pv.id)
    db.commit()
    db.refresh(pv)
    return pv
