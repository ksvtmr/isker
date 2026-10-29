from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import joinedload, selectinload

from app.ai import analysis as analysis_service
from app.api.deps import DB, require_permission
from app.core.content_i18n import LANGS, pair_by_key, reconcile_translations, translation_status
from app.core.context import language_var
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models import (
    AIAnalysis,
    AIEvaluation,
    AIPromptVersion,
    Assessment,
    AssessmentAttempt,
    Competency,
    CompetencyArea,
    CompetencyLevel,
    CompetencyScore,
    GoalDefinition,
    LearningResource,
    PracticalTask,
    PracticeSubmission,
    Question,
    QuestionCompetency,
    QuestionOption,
    SubscriptionPlan,
    User,
    UserLearningProgress,
)
from app.models.enums import (
    AIEvalStatus,
    AIInputType,
    AssessmentKind,
    AttemptStatus,
    ContentStatus,
    PracticeStatus,
    ProgressStatus,
)
from app.schemas.admin import (
    AdminStats,
    AIEvaluationAdminOut,
    AssessmentAdminOut,
    AssessmentIn,
    AssessmentUpdate,
    CompetencyAdminOut,
    CompetencyIn,
    CompetencyUpdate,
    PromptIn,
    PromptOut,
    QuestionAdminOut,
    QuestionIn,
    ResourceAdminOut,
    ResourceIn,
    StatusIn,
    TaskAdminOut,
    TaskIn,
)
from app.schemas.common import ERROR_RESPONSES, Message, Page
from app.services import assessments as assessment_service
from app.services import views
from app.services.audit import audit
from app.services.content_admin import (
    clean_translations,
    question_answer_count,
    question_translation_status,
    resolve_status,
    touch,
)
from app.services.locking import changes, check_version, snapshot

router = APIRouter(prefix="/api/admin", tags=["admin"], responses=ERROR_RESPONSES)

Analyst = Annotated[User, Depends(require_permission("analytics.view"))]
ContentManager = Annotated[User, Depends(require_permission("content.manage"))]
AIViewer = Annotated[User, Depends(require_permission("ai.view"))]
AIManager = Annotated[User, Depends(require_permission("ai.manage"))]


@router.get("/stats", response_model=AdminStats, summary="Platform and assessment statistics")
def stats(_: Analyst, db: DB) -> AdminStats:
    def count(stmt) -> int:
        return db.scalar(stmt) or 0

    avg = db.scalar(
        select(func.avg(AssessmentAttempt.overall_score)).where(AssessmentAttempt.status == AttemptStatus.COMPLETED)
    )
    # Select the Competency entity (not its columns) so its name is localized like everywhere else.
    comp_avgs = db.execute(
        select(Competency, func.avg(CompetencyScore.score), func.count(CompetencyScore.id))
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
            {
                "code": c.code,
                "name": c.name,
                "average": round(float(a), 1) if a is not None else None,
                "measurements": k,
            }
            for c, a, k in comp_avgs
        ],
    )


# --- Competencies ----------------------------------------------------------------------------------
#
# Every content edit: `expected_version` is checked against `lock_version` (409 VERSION_CONFLICT when stale), the
# changed fields are audited with old → new values, and the change commits in one transaction. Learner pages read
# the same rows, so a published change is visible on their next request.

COMPETENCY_FIELDS = (
    "code", "area_id", "name", "short_name", "description", "hint", "reflection_prompt", "importance",
    "learning_priority", "default_target", "sort_order", "status", "translations",
)


def _get_comp(db, competency_id: int) -> Competency:
    c = db.scalar(select(Competency).where(Competency.id == competency_id).options(joinedload(Competency.area)))
    if c is None:
        raise NotFoundError("Competency not found", "COMPETENCY_NOT_FOUND")
    return c


def _check_area(db, area_id: int) -> None:
    if db.get(CompetencyArea, area_id) is None:
        raise ValidationError("Unknown competency area.", "INVALID_AREA")


def _comp_out(db, competency_id: int) -> CompetencyAdminOut:
    db.expire_all()
    return CompetencyAdminOut.model_validate(_get_comp(db, competency_id))


@router.get("/competencies", response_model=list[CompetencyAdminOut], summary="Competencies (all statuses)")
def competencies(_: ContentManager, db: DB) -> list[CompetencyAdminOut]:
    return [CompetencyAdminOut.model_validate(c) for c in views.competencies(db)]


@router.post(
    "/competencies",
    response_model=CompetencyAdminOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a competency (draft unless published explicitly)",
)
def create_competency(body: CompetencyIn, admin: ContentManager, db: DB) -> CompetencyAdminOut:
    _check_area(db, body.area_id)
    if db.scalar(select(Competency.id).where(Competency.code == body.code)):
        raise ConflictError("A competency with this code exists.", "COMPETENCY_CODE_TAKEN")
    data = body.model_dump(exclude={"translations", "status", "sort_order"})
    sort_order = body.sort_order
    if sort_order is None:
        sort_order = (db.scalar(select(func.max(Competency.sort_order))) or 0) + 1
    c = Competency(**data, sort_order=sort_order, translations=clean_translations(Competency, body.translations))
    c.set_status(body.status)
    db.add(c)
    db.flush()
    audit(db, admin.id, "admin.competency_created", "competency", c.id, code=c.code, status=c.status.value)
    db.commit()
    return _comp_out(db, c.id)


@router.put("/competencies/{competency_id}", response_model=CompetencyAdminOut, summary="Edit a competency")
def update_competency(
    competency_id: int, body: CompetencyUpdate, admin: ContentManager, db: DB
) -> CompetencyAdminOut:
    c = _get_comp(db, competency_id)
    check_version(c, body.expected_version)
    before = snapshot(c, COMPETENCY_FIELDS)
    data = body.model_dump(exclude_unset=True, exclude={"expected_version", "translations", "status"})
    if data.get("area_id") is not None:
        _check_area(db, data["area_id"])
    for k, v in data.items():
        if v is None and k in ("area_id", "name", "short_name", "description", "importance", "learning_priority",
                               "default_target", "sort_order"):
            continue
        setattr(c, k, v)
    if "translations" in body.model_fields_set:
        c.translations = clean_translations(Competency, body.translations)
    if body.status is not None:
        c.set_status(body.status)
    _finish(db, admin, c, before, COMPETENCY_FIELDS, "competency")
    return _comp_out(db, c.id)


@router.post(
    "/competencies/{competency_id}/status", response_model=CompetencyAdminOut, summary="Publish, unpublish or archive"
)
def competency_status(competency_id: int, body: StatusIn, admin: ContentManager, db: DB) -> CompetencyAdminOut:
    c = _get_comp(db, competency_id)
    _set_status(db, admin, c, body, COMPETENCY_FIELDS, "competency")
    return _comp_out(db, c.id)


def _finish(db, admin: User, row, before: dict, fields: tuple[str, ...], entity: str, **extra) -> dict:
    """Audit the changed fields and commit; an edit that changes nothing is refused with NO_CHANGES."""
    after = snapshot(row, fields)
    diff = changes(before, after)
    if not diff:
        raise ValidationError("Nothing to change.", "NO_CHANGES")
    touch(row)
    db.flush()
    audit(db, admin.id, f"admin.{entity}_updated", entity, row.id, changes=diff, **extra)
    db.commit()
    return diff


def _set_status(db, admin: User, row, body: StatusIn, fields: tuple[str, ...], entity: str) -> None:
    check_version(row, body.expected_version)
    before = snapshot(row, fields)
    if row.status == body.status:
        return
    row.set_status(body.status)
    after = snapshot(row, fields)
    touch(row)
    db.flush()
    audit(db, admin.id, f"admin.{entity}_{body.status.value}", entity, row.id, changes=changes(before, after))
    db.commit()


# --- Questions -------------------------------------------------------------------------------------

QUESTION_FIELDS = (
    "assessment_id", "sort_order", "type", "section", "text", "help_text", "rubric", "reverse_scored", "min_length",
    "status", "translations",
)
# What a learner answered and how it was scored. Changing any of it on an answered question creates a new version.
QUESTION_CONTENT = tuple(f for f in QUESTION_FIELDS if f not in ("sort_order", "status"))


def _q_snapshot(q: Question) -> dict:
    snap = snapshot(q, QUESTION_FIELDS)
    snap["options"] = [[o.label, o.score, o.value, o.translations] for o in q.options]
    snap["competencies"] = sorted([link.competency_id, link.weight] for link in q.competency_links)
    return snap


def _q_content(snap: dict) -> dict:
    return {k: snap[k] for k in (*QUESTION_CONTENT, "options", "competencies")}


def _q_out(db, q: Question, replaced_id: int | None = None) -> QuestionAdminOut:
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
        status=q.status,
        lock_version=q.lock_version,
        version=q.version,
        previous_id=q.previous_id,
        translations=q.translations,
        translation_status=question_translation_status(q),
        options=[
            {"id": o.id, "label": o.label, "score": o.score, "value": o.value, "translations": o.translations,
             "translation_status": translation_status(o)}
            for o in q.options
        ],
        competencies=[{"competency_id": link.competency_id, "weight": link.weight} for link in q.competency_links],
        rubric=q.rubric or [],
        answer_count=question_answer_count(db, q.id),
        replaced_id=replaced_id,
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


@router.get("/questions", response_model=list[QuestionAdminOut], summary="Question bank (all versions)")
def questions(
    _: ContentManager,
    db: DB,
    assessment_id: int | None = None,
    status_filter: Annotated[ContentStatus | None, Query(alias="status")] = None,
) -> list[QuestionAdminOut]:
    stmt = select(Question).options(selectinload(Question.options), selectinload(Question.competency_links))
    if assessment_id:
        stmt = stmt.where(Question.assessment_id == assessment_id)
    if status_filter:
        stmt = stmt.where(Question.status == status_filter)
    return [_q_out(db, q) for q in db.scalars(stmt.order_by(Question.assessment_id, Question.sort_order, Question.id))]


def _validate_question(db, body: QuestionIn) -> None:
    comp_ids = set(db.scalars(select(Competency.id)))
    codes = set(db.scalars(select(Competency.code)))
    if any(link.competency_id not in comp_ids for link in body.competencies):
        raise ValidationError("Unknown competency in mapping.", "INVALID_COMPETENCY")
    if len({link.competency_id for link in body.competencies}) != len(body.competencies):
        raise ValidationError("Each competency may be mapped once.", "INVALID_COMPETENCY")
    if any(r.competency and r.competency not in codes for r in body.rubric):
        raise ValidationError("Unknown competency code in rubric.", "INVALID_COMPETENCY")
    if db.get(Assessment, body.assessment_id) is None:
        raise ValidationError("Unknown assessment.", "INVALID_ASSESSMENT")


def _apply_question(db, q: Question, body: QuestionIn, previous: Question | None = None) -> None:
    """Write the editor's content into `q` (a new row, a new version, or an unanswered question edited in place)."""
    source = previous or q
    old_options = [(o.label, o.translations) for o in source.options]
    old_translations = source.translations
    if previous is None and q.id is not None:
        # Remove the old child rows first, so the question row itself is written once (one lock_version step).
        q.options.clear()
        q.competency_links.clear()
        db.flush()
    q.assessment_id, q.type, q.section, q.text = body.assessment_id, body.type, body.section, body.text
    q.help_text, q.reverse_scored, q.min_length = body.help_text, body.reverse_scored, body.min_length
    q.rubric = [r.model_dump() for r in body.rubric] or None
    sent = "translations" in body.model_fields_set
    if sent:
        q.translations = clean_translations(Question, body.translations, rubric_len=len(body.rubric))
    elif previous is not None:
        q.translations = old_translations
    if previous is not None:
        # A new version is a new row (the flush hook only sees edits in place): translations of English fields that
        # changed are marked stale, and rubric translations follow their criterion.
        fields = (*Question.__translatable__, "rubric")
        q.translations = reconcile_translations(
            Question, old_translations, q.translations,
            {f: getattr(previous, f) for f in fields}, {f: getattr(q, f) for f in fields}, confirm_from_client=sent,
        )
    if body.sort_order is not None:
        q.sort_order = body.sort_order
    # The translation of an option follows its English label (reordering keeps it); an edited label keeps the old
    # translation of the option it replaced, marked stale. A changed score or value never touches translations.
    match = pair_by_key([label for label, _ in old_options], [o.label for o in body.options])
    for i, o in enumerate(body.options):
        k = match[i]
        client = o.translations is not None or "translations" in o.model_fields_set
        old_label, old_tr = old_options[k] if k is not None else (None, None)
        tr = clean_translations(QuestionOption, o.translations) if client else old_tr
        if k is not None:
            tr = reconcile_translations(
                QuestionOption, old_tr, tr, {"label": old_label}, {"label": o.label}, confirm_from_client=client
            )
        q.options.append(QuestionOption(sort_order=i, label=o.label, score=o.score, value=o.value, translations=tr))
    for link in body.competencies:
        q.competency_links.append(QuestionCompetency(competency_id=link.competency_id, weight=link.weight))


@router.post("/questions", response_model=QuestionAdminOut, status_code=status.HTTP_201_CREATED)
def create_question(body: QuestionIn, admin: ContentManager, db: DB) -> QuestionAdminOut:
    _validate_question(db, body)
    last = db.scalar(select(func.max(Question.sort_order)).where(Question.assessment_id == body.assessment_id)) or 0
    q = Question(
        sort_order=body.sort_order or last + 1,
        assessment_id=body.assessment_id,
        type=body.type,
        section=body.section,
        text=body.text,
    )
    q.set_status(resolve_status(body.status, body.is_active, None, ContentStatus.PUBLISHED))
    db.add(q)
    _apply_question(db, q, body)
    db.flush()
    audit(db, admin.id, "admin.question_created", "question", q.id, status=q.status.value)
    db.commit()
    return _q_out(db, _get_q(db, q.id))


@router.put("/questions/{question_id}", response_model=QuestionAdminOut, summary="Edit (versioned once answered)")
def update_question(question_id: int, body: QuestionIn, admin: ContentManager, db: DB) -> QuestionAdminOut:
    """An unanswered question is edited in place. Once learners answered it, a content change creates a new version
    (a new question id, `previous_id` → this one) used by new attempts, and this version is archived so completed
    attempts keep their exact questions and scores."""
    q = _get_q(db, question_id)
    check_version(q, body.expected_version)
    _validate_question(db, body)
    before = _q_snapshot(q)
    new_status = resolve_status(body.status, body.is_active, q.status, ContentStatus.PUBLISHED)
    if question_answer_count(db, q.id):
        draft = Question(sort_order=q.sort_order)
        _apply_question(db, draft, body, previous=q)
        if _q_content(_q_snapshot(draft)) != _q_content(before):
            draft.version, draft.previous_id = q.version + 1, q.id
            draft.set_status(new_status)
            q.set_status(ContentStatus.ARCHIVED)
            touch(q)
            db.add(draft)
            db.flush()
            diff = changes(before, _q_snapshot(draft))
            audit(db, admin.id, "admin.question_versioned", "question", draft.id, replaced_id=q.id,
                  version=draft.version, changes=diff)
            db.commit()
            return _q_out(db, _get_q(db, draft.id), replaced_id=q.id)
        # Same content: only the position or status changes, in place. (`draft` was never added to the session.)
        if body.sort_order is not None:
            q.sort_order = body.sort_order
    else:
        _apply_question(db, q, body)
    q.set_status(new_status)
    after = _q_snapshot(q)
    diff = changes(before, after)
    if not diff:
        raise ValidationError("Nothing to change.", "NO_CHANGES")
    touch(q)
    db.flush()
    audit(db, admin.id, "admin.question_updated", "question", q.id, changes=diff)
    db.commit()
    return _q_out(db, _get_q(db, q.id))


@router.post("/questions/{question_id}/status", response_model=QuestionAdminOut, summary="Publish or archive")
def question_status(question_id: int, body: StatusIn, admin: ContentManager, db: DB) -> QuestionAdminOut:
    q = _get_q(db, question_id)
    _set_status(db, admin, q, body, QUESTION_FIELDS, "question")
    db.expire_all()
    return _q_out(db, _get_q(db, question_id))


@router.delete("/questions/{question_id}", response_model=Message, summary="Archive (history is preserved)")
def archive_question(question_id: int, admin: ContentManager, db: DB) -> Message:
    q = _get_q(db, question_id)
    _set_status(db, admin, q, StatusIn(status=ContentStatus.ARCHIVED), QUESTION_FIELDS, "question")
    return Message(message="Question archived", code="QUESTION_ARCHIVED")


# --- Assessments -----------------------------------------------------------------------------------

ASSESSMENT_FIELDS = ("title", "description", "estimated_minutes", "is_active", "translations")


def _a_out(db, a: Assessment) -> AssessmentAdminOut:
    out = AssessmentAdminOut.model_validate(a)
    out.question_count = (
        db.scalar(select(func.count(Question.id)).where(*assessment_service.live_question_filter(a.id))) or 0
    )
    out.attempt_count = (
        db.scalar(select(func.count(AssessmentAttempt.id)).where(AssessmentAttempt.assessment_id == a.id)) or 0
    )
    return out


@router.get("/assessments", response_model=list[AssessmentAdminOut])
def assessments(_: ContentManager, db: DB) -> list[AssessmentAdminOut]:
    return [_a_out(db, a) for a in db.scalars(select(Assessment).order_by(Assessment.id))]


@router.post("/assessments", response_model=AssessmentAdminOut, status_code=status.HTTP_201_CREATED)
def create_assessment(body: AssessmentIn, admin: ContentManager, db: DB) -> AssessmentAdminOut:
    if db.scalar(select(Assessment.id).where(Assessment.code == body.code)):
        raise ConflictError("An assessment with this code exists.", "ASSESSMENT_CODE_TAKEN")
    a = Assessment(kind=AssessmentKind.FULL, **body.model_dump())
    db.add(a)
    db.flush()
    audit(db, admin.id, "admin.assessment_created", "assessment", a.id)
    db.commit()
    return _a_out(db, a)


@router.put("/assessments/{assessment_id}", response_model=AssessmentAdminOut)
def update_assessment(assessment_id: int, body: AssessmentUpdate, admin: ContentManager, db: DB) -> AssessmentAdminOut:
    a = db.get(Assessment, assessment_id)
    if a is None:
        raise NotFoundError("Assessment not found", "ASSESSMENT_NOT_FOUND")
    check_version(a, body.expected_version)
    before = snapshot(a, ASSESSMENT_FIELDS)
    for k, v in body.model_dump(exclude_unset=True, exclude={"expected_version", "translations"}).items():
        if v is not None:
            setattr(a, k, v)
    if "translations" in body.model_fields_set:
        a.translations = clean_translations(Assessment, body.translations)
    if changes(before, snapshot(a, ASSESSMENT_FIELDS)):
        a.version += 1
    _finish(db, admin, a, before, ASSESSMENT_FIELDS, "assessment")
    return _a_out(db, a)


# --- Resources & tasks -----------------------------------------------------------------------------

RESOURCE_FIELDS = (
    "slug", "competency_id", "title", "description", "type", "difficulty", "duration_minutes", "content", "url",
    "status", "translations",
)
TASK_FIELDS = (
    "slug", "competency_id", "title", "description", "instructions", "difficulty", "duration_minutes", "rubric",
    "min_length", "status", "translations",
)


def _check_comp(db, cid: int) -> None:
    if db.get(Competency, cid) is None:
        raise ValidationError("Unknown competency.", "INVALID_COMPETENCY")


def _plain_fields(body: ResourceIn | TaskIn) -> dict:
    return body.model_dump(exclude={"expected_version", "translations", "status", "is_published"})


def _get_resource(db, resource_id: int) -> LearningResource:
    r = db.get(LearningResource, resource_id)
    if r is None:
        raise NotFoundError("Resource not found", "RESOURCE_NOT_FOUND")
    return r


def _get_task(db, task_id: int) -> PracticalTask:
    t = db.get(PracticalTask, task_id)
    if t is None:
        raise NotFoundError("Task not found", "TASK_NOT_FOUND")
    return t


def _reloaded(db, row):
    db.expire_all()
    return db.get(type(row), row.id)


@router.get("/resources", response_model=list[ResourceAdminOut])
def resources(
    _: ContentManager, db: DB, status_filter: Annotated[ContentStatus | None, Query(alias="status")] = None
) -> list[LearningResource]:
    stmt = select(LearningResource)
    if status_filter:
        stmt = stmt.where(LearningResource.status == status_filter)
    return list(db.scalars(stmt.order_by(LearningResource.competency_id, LearningResource.id)))


@router.post("/resources", response_model=ResourceAdminOut, status_code=status.HTTP_201_CREATED)
def create_resource(body: ResourceIn, admin: ContentManager, db: DB) -> LearningResource:
    _check_comp(db, body.competency_id)
    if db.scalar(select(LearningResource.id).where(LearningResource.slug == body.slug)):
        raise ConflictError("A resource with this slug exists.", "SLUG_TAKEN")
    r = LearningResource(**_plain_fields(body), translations=clean_translations(LearningResource, body.translations))
    r.set_status(resolve_status(body.status, body.is_published, None, ContentStatus.PUBLISHED))
    db.add(r)
    db.flush()
    audit(db, admin.id, "admin.resource_created", "learning_resource", r.id, status=r.status.value)
    db.commit()
    return r


@router.put("/resources/{resource_id}", response_model=ResourceAdminOut)
def update_resource(resource_id: int, body: ResourceIn, admin: ContentManager, db: DB) -> LearningResource:
    r = _get_resource(db, resource_id)
    check_version(r, body.expected_version)
    _check_comp(db, body.competency_id)
    clash = db.scalar(
        select(LearningResource.id).where(LearningResource.slug == body.slug, LearningResource.id != r.id)
    )
    if clash:
        raise ConflictError("A resource with this slug exists.", "SLUG_TAKEN")
    before = snapshot(r, RESOURCE_FIELDS)
    for k, v in _plain_fields(body).items():
        setattr(r, k, v)
    if "translations" in body.model_fields_set:
        r.translations = clean_translations(LearningResource, body.translations)
    r.set_status(resolve_status(body.status, body.is_published, r.status, ContentStatus.PUBLISHED))
    _finish(db, admin, r, before, RESOURCE_FIELDS, "learning_resource")
    return _reloaded(db, r)


@router.post("/resources/{resource_id}/status", response_model=ResourceAdminOut, summary="Publish, unpublish, archive")
def resource_status(resource_id: int, body: StatusIn, admin: ContentManager, db: DB) -> LearningResource:
    r = _get_resource(db, resource_id)
    _set_status(db, admin, r, body, RESOURCE_FIELDS, "learning_resource")
    return _reloaded(db, r)


@router.delete("/resources/{resource_id}", response_model=Message, summary="Archive a resource (history is kept)")
def archive_resource(resource_id: int, admin: ContentManager, db: DB) -> Message:
    r = _get_resource(db, resource_id)
    _set_status(db, admin, r, StatusIn(status=ContentStatus.ARCHIVED), RESOURCE_FIELDS, "learning_resource")
    return Message(message="Resource archived", code="RESOURCE_ARCHIVED")


@router.get("/tasks", response_model=list[TaskAdminOut])
def tasks(
    _: ContentManager, db: DB, status_filter: Annotated[ContentStatus | None, Query(alias="status")] = None
) -> list[PracticalTask]:
    stmt = select(PracticalTask)
    if status_filter:
        stmt = stmt.where(PracticalTask.status == status_filter)
    return list(db.scalars(stmt.order_by(PracticalTask.competency_id, PracticalTask.id)))


def _task_rubric(body: TaskIn) -> list[dict]:
    return [r.model_dump() for r in body.rubric]


@router.post("/tasks", response_model=TaskAdminOut, status_code=status.HTTP_201_CREATED)
def create_task(body: TaskIn, admin: ContentManager, db: DB) -> PracticalTask:
    _check_comp(db, body.competency_id)
    if db.scalar(select(PracticalTask.id).where(PracticalTask.slug == body.slug)):
        raise ConflictError("A task with this slug exists.", "SLUG_TAKEN")
    t = PracticalTask(
        **{**_plain_fields(body), "rubric": _task_rubric(body)},
        translations=clean_translations(PracticalTask, body.translations, rubric_len=len(body.rubric)),
    )
    t.set_status(resolve_status(body.status, body.is_published, None, ContentStatus.PUBLISHED))
    db.add(t)
    db.flush()
    audit(db, admin.id, "admin.task_created", "practical_task", t.id, status=t.status.value)
    db.commit()
    return t


@router.put("/tasks/{task_id}", response_model=TaskAdminOut)
def update_task(task_id: int, body: TaskIn, admin: ContentManager, db: DB) -> PracticalTask:
    t = _get_task(db, task_id)
    check_version(t, body.expected_version)
    _check_comp(db, body.competency_id)
    clash = db.scalar(select(PracticalTask.id).where(PracticalTask.slug == body.slug, PracticalTask.id != t.id))
    if clash:
        raise ConflictError("A task with this slug exists.", "SLUG_TAKEN")
    before = snapshot(t, TASK_FIELDS)
    for k, v in {**_plain_fields(body), "rubric": _task_rubric(body)}.items():
        setattr(t, k, v)
    if "translations" in body.model_fields_set:
        t.translations = clean_translations(PracticalTask, body.translations, rubric_len=len(body.rubric))
    t.set_status(resolve_status(body.status, body.is_published, t.status, ContentStatus.PUBLISHED))
    _finish(db, admin, t, before, TASK_FIELDS, "practical_task")
    return _reloaded(db, t)


@router.post("/tasks/{task_id}/status", response_model=TaskAdminOut, summary="Publish, unpublish or archive")
def task_status(task_id: int, body: StatusIn, admin: ContentManager, db: DB) -> PracticalTask:
    t = _get_task(db, task_id)
    _set_status(db, admin, t, body, TASK_FIELDS, "practical_task")
    return _reloaded(db, t)


@router.delete("/tasks/{task_id}", response_model=Message, summary="Archive a task (submissions are kept)")
def archive_task(task_id: int, admin: ContentManager, db: DB) -> Message:
    t = _get_task(db, task_id)
    _set_status(db, admin, t, StatusIn(status=ContentStatus.ARCHIVED), TASK_FIELDS, "practical_task")
    return Message(message="Task archived", code="TASK_ARCHIVED")


# --- AI governance ---------------------------------------------------------------------------------


@router.get("/ai/evaluations", response_model=Page[AIEvaluationAdminOut], summary="AI evaluation log")
def ai_evaluations(
    _: AIViewer,
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


@router.get("/ai/analyses", summary="AI development analyses: processing status (no answer content)")
def ai_analyses(
    _: AIViewer,
    db: DB,
    status_filter: Annotated[str | None, Query(alias="status", pattern="^(pending|succeeded|failed)$")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> dict:
    stmt = select(AIAnalysis, User.email).join(User, User.id == AIAnalysis.user_id)
    if status_filter:
        stmt = stmt.where(AIAnalysis.status == status_filter)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(AIAnalysis.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    counts = dict(db.execute(select(AIAnalysis.status, func.count()).group_by(AIAnalysis.status)).all())
    items = [{
        "id": a.id, "attempt_id": a.attempt_id, "user_id": a.user_id, "user_email": email, "status": a.status,
        "language": a.language, "provider": a.provider, "model": a.model, "error_code": a.error_code, "runs": a.runs,
        "latency_ms": a.latency_ms, "created_at": a.created_at, "updated_at": a.updated_at,
        "completed_at": a.completed_at,
    } for a, email in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size,
            "counts": {k: counts.get(k, 0) for k in ("pending", "succeeded", "failed")}}


@router.post("/ai/analyses/{analysis_id}/retry", summary="Run a failed AI development analysis again")
def retry_ai_analysis(analysis_id: int, admin: AIManager, db: DB) -> dict:
    row = db.get(AIAnalysis, analysis_id)
    if row is None:
        raise NotFoundError("Analysis not found", "ANALYSIS_NOT_FOUND")
    att = db.get(AssessmentAttempt, row.attempt_id)
    owner = db.get(User, row.user_id)
    if att is None or owner is None:  # pragma: no cover - cascades delete analyses with their attempt/user
        raise NotFoundError("Analysis not found", "ANALYSIS_NOT_FOUND")
    if row.status != "failed":
        raise ConflictError("Only a failed analysis can be retried.", "ANALYSIS_NOT_FAILED")
    audit(db, admin.id, "admin.ai_analysis_retried", "ai_analysis", row.id, attempt_id=row.attempt_id)
    db.commit()
    # Written in the learner's language, not the administrator's.
    token = language_var.set(row.language)
    try:
        row = analysis_service.run_analysis(db, owner, att)
    finally:
        language_var.reset(token)
    return {"id": row.id, "status": row.status, "error_code": row.error_code, "runs": row.runs}


@router.get("/ai/prompts", response_model=list[PromptOut], summary="Prompt versions")
def prompts(_: AIViewer, db: DB) -> list[AIPromptVersion]:
    return list(db.scalars(select(AIPromptVersion).order_by(AIPromptVersion.key, AIPromptVersion.version.desc())))


_PLACEHOLDERS = {
    "answer_evaluation": dict(competency="c", question="q", rubric="r", answer="a"),
    "profile_insight": dict(facts="{}"),
    "development_analysis": dict(facts="{}"),
}


@router.post(
    "/ai/prompts", response_model=PromptOut, status_code=status.HTTP_201_CREATED, summary="Create a new prompt version"
)
def create_prompt(body: PromptIn, admin: AIManager, db: DB) -> AIPromptVersion:
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
def activate_prompt(prompt_id: int, admin: AIManager, db: DB) -> AIPromptVersion:
    pv = db.get(AIPromptVersion, prompt_id)
    if pv is None:
        raise NotFoundError("Prompt version not found", "PROMPT_NOT_FOUND")
    _activate(db, pv)
    audit(db, admin.id, "admin.prompt_activated", "ai_prompt_version", pv.id)
    db.commit()
    db.refresh(pv)
    return pv


# --- Translation completeness ----------------------------------------------------------------------------------------
#
# Publishing never requires translations: a learner sees the English base text of a field that has no translation in
# their language (fallback kk → ru → en). This report makes those gaps, and translations left outdated by an edit of
# the English text ("stale"), visible. Archived content is left out.

TRANSLATION_ENTITIES: dict[str, tuple[Any, str]] = {
    "area": (CompetencyArea, "name"),
    "competency": (Competency, "name"),
    "level": (CompetencyLevel, "name"),
    "goal": (GoalDefinition, "title"),
    "assessment": (Assessment, "title"),
    "question": (Question, "text"),
    "option": (QuestionOption, "label"),
    "resource": (LearningResource, "title"),
    "task": (PracticalTask, "title"),
    "plan": (SubscriptionPlan, "name"),
}
TRANSLATION_STATUSES = ("complete", "partial", "missing", "stale")


def _split(value: str | None, allowed: tuple[str, ...], what: str) -> list[str]:
    items = [v.strip() for v in (value or "").split(",") if v.strip()]
    unknown = sorted(set(items) - set(allowed))
    if unknown:
        raise ValidationError(f"Unknown {what}.", "INVALID_FILTER", {what: unknown, "allowed": list(allowed)})
    return items or list(allowed)


def _translation_rows(db, entity: str) -> list[tuple[int, str, dict]]:
    model, label_field = TRANSLATION_ENTITIES[entity]
    stmt: Any = select(model)
    if entity == "question":
        stmt = stmt.options(selectinload(Question.options))
    if entity == "option":
        stmt = stmt.join(Question, Question.id == QuestionOption.question_id).order_by(
            QuestionOption.question_id, QuestionOption.sort_order
        )
    if hasattr(model, "status") and entity not in ("plan", "option"):
        stmt = stmt.where(model.status != ContentStatus.ARCHIVED)
    if entity == "option":
        stmt = stmt.where(Question.status != ContentStatus.ARCHIVED)
    else:
        stmt = stmt.order_by(model.id)
    out = []
    for row in db.scalars(stmt):
        st = question_translation_status(row) if entity == "question" else translation_status(row)
        label = str(getattr(row, label_field) or "")
        out.append((row.id, label[:160], st))
    return out


@router.get("/translations/status", summary="Translation completeness of the content (ru, kk)")
def translations_status(
    _: ContentManager,
    db: DB,
    entity: Annotated[str | None, Query(description="Comma-separated: " + ", ".join(TRANSLATION_ENTITIES))] = None,
    language: Annotated[str | None, Query(description="Comma-separated: ru, kk")] = None,
    status_filter: Annotated[
        str | None, Query(alias="status", description="Comma-separated: complete, partial, missing, stale")
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    """`summary` counts every row of the selected entities per language and status (ignoring the status filter);
    `items` lists the rows whose status, in any selected language, is one of the selected statuses."""
    entities = _split(entity, tuple(TRANSLATION_ENTITIES), "entity")
    langs = _split(language, LANGS, "language")
    statuses = set(_split(status_filter, TRANSLATION_STATUSES, "status"))
    summary: dict[str, dict] = {}
    items: list[dict] = []
    for name in entities:
        counts = {lang: dict.fromkeys(TRANSLATION_STATUSES, 0) for lang in LANGS}
        for row_id, label, st in _translation_rows(db, name):
            for lang in LANGS:
                counts[lang][st[lang]["status"]] += 1
            if any(st[lang]["status"] in statuses for lang in langs):
                items.append({
                    "entity": name,
                    "id": row_id,
                    "label": label,
                    "status": {lang: st[lang]["status"] for lang in LANGS},
                    "missing": {lang: st[lang]["missing"] for lang in LANGS},
                    "stale": {lang: st[lang]["stale"] for lang in LANGS},
                })
        summary[name] = counts
    start = (page - 1) * page_size
    return {
        "summary": summary,
        "items": items[start : start + page_size],
        "total": len(items),
        "page": page,
        "page_size": page_size,
    }
