from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.deps import DB, CurrentUser
from app.core.errors import NotFoundError
from app.models import AssessmentAttempt, Question
from app.models.enums import AttemptStatus
from app.schemas.assessment import (
    AnswerIn,
    AnswerOut,
    AssessmentOut,
    AssessmentOverview,
    AttemptState,
    AttemptSummary,
    OptionOut,
    PositionIn,
    QuestionOut,
    SectionOut,
    StartAttemptIn,
    StartAttemptOut,
)
from app.schemas.common import ERROR_RESPONSES
from app.schemas.results import AttemptResults
from app.services import assessments as svc
from app.services import views

router = APIRouter(prefix="/api/assessments", tags=["assessments"], responses=ERROR_RESPONSES)


def _assessment_out(db, a) -> AssessmentOut:
    qs = list(
        db.scalars(
            select(Question)
            .where(Question.assessment_id == a.id, Question.is_active.is_(True))
            .order_by(Question.sort_order)
        )
    )
    counts = Counter(q.section for q in qs)
    order = list(dict.fromkeys(q.section for q in qs))
    return AssessmentOut(
        id=a.id,
        title=a.title,
        description=a.description,
        estimated_minutes=a.estimated_minutes,
        question_count=len(qs),
        sections=[SectionOut(name=s, count=counts[s]) for s in order],
    )


@router.get("", response_model=AssessmentOverview, summary="Active assessment, resumable attempt and history")
def overview(user: CurrentUser, db: DB) -> AssessmentOverview:
    a = svc.active_assessment(db)
    current = svc.in_progress_attempt(db, user.id)
    done = db.scalars(
        select(AssessmentAttempt)
        .where(AssessmentAttempt.user_id == user.id, AssessmentAttempt.status == AttemptStatus.COMPLETED)
        .order_by(AssessmentAttempt.completed_at.desc())
    )
    return AssessmentOverview(
        assessment=_assessment_out(db, a),
        in_progress=views.attempt_summary(db, current) if current else None,
        completed=[views.attempt_summary(db, x) for x in done],
    )


@router.post(
    "/attempts",
    response_model=StartAttemptOut,
    status_code=status.HTTP_201_CREATED,
    summary="Start (or resume) a full assessment or a single-competency reassessment",
)
def start(body: StartAttemptIn, user: CurrentUser, db: DB) -> StartAttemptOut:
    att, resumed = svc.start_attempt(db, user, body.scope, body.competency_id)
    db.commit()
    db.refresh(att)
    return StartAttemptOut(attempt=views.attempt_summary(db, att), resumed=resumed)


@router.get(
    "/attempts/{attempt_id}",
    response_model=AttemptState,
    summary="Attempt state: questions (one per screen), saved answers, position",
)
def get_state(attempt_id: int, user: CurrentUser, db: DB) -> AttemptState:
    att = svc.get_attempt(db, user, attempt_id)
    qs = svc.questions_for(db, att)
    return AttemptState(
        attempt=views.attempt_summary(db, att, len(qs)),
        questions=[
            QuestionOut(
                id=q.id,
                index=i,
                type=q.type,
                section=q.section,
                text=q.text,
                help_text=q.help_text,
                min_length=q.min_length,
                options=[OptionOut(id=o.id, label=o.label) for o in q.options],
            )
            for i, q in enumerate(qs)
        ],
        answers=[
            AnswerOut(
                question_id=a.question_id, option_id=a.option_id, text_response=a.text_response, updated_at=a.updated_at
            )
            for a in att.answers
        ],
    )


@router.put("/attempts/{attempt_id}/answers/{question_id}", response_model=AnswerOut, summary="Autosave an answer")
def save_answer(attempt_id: int, question_id: int, body: AnswerIn, user: CurrentUser, db: DB) -> AnswerOut:
    att = svc.get_attempt(db, user, attempt_id)
    ans = svc.save_answer(db, att, question_id, body.option_id, body.text_response, body.position)
    db.commit()
    return AnswerOut(
        question_id=ans.question_id, option_id=ans.option_id, text_response=ans.text_response, updated_at=ans.updated_at
    )


@router.put("/attempts/{attempt_id}/position", response_model=AttemptSummary, summary="Save current question")
def save_position(attempt_id: int, body: PositionIn, user: CurrentUser, db: DB) -> AttemptSummary:
    att = svc.get_attempt(db, user, attempt_id)
    if att.status == AttemptStatus.IN_PROGRESS:
        att.current_index = min(body.position, max(0, len(svc.questions_for(db, att)) - 1))
        db.commit()
    return views.attempt_summary(db, att)


@router.post(
    "/attempts/{attempt_id}/submit",
    response_model=AttemptResults,
    summary="Finish: score, AI-evaluate open answers, gap analysis, recommendations, snapshot",
)
def submit(attempt_id: int, user: CurrentUser, db: DB) -> AttemptResults:
    att = svc.get_attempt(db, user, attempt_id)
    svc.submit(db, user, att)
    db.commit()
    return results_for(db, user.id, att)


@router.post("/attempts/{attempt_id}/abandon", response_model=AttemptSummary, summary="Discard an attempt")
def abandon(attempt_id: int, user: CurrentUser, db: DB) -> AttemptSummary:
    att = svc.get_attempt(db, user, attempt_id)
    if att.status == AttemptStatus.IN_PROGRESS:
        att.status = AttemptStatus.ABANDONED
        db.commit()
    return views.attempt_summary(db, att)


@router.get("/attempts/{attempt_id}/results", response_model=AttemptResults, summary="Results of an attempt")
def results(attempt_id: int, user: CurrentUser, db: DB) -> AttemptResults:
    att = svc.get_attempt(db, user, attempt_id)
    if att.status != AttemptStatus.COMPLETED:
        raise NotFoundError("Results are available after you finish the assessment.", "RESULTS_NOT_READY")
    return results_for(db, user.id, att)


def results_for(db, user_id: int, att: AssessmentAttempt) -> AttemptResults:
    profile = views.profile_overview(db, user_id, as_of_attempt=att)
    from app.models import CompetencyScore

    measured_ids = set(db.scalars(select(CompetencyScore.competency_id).where(CompetencyScore.attempt_id == att.id)))
    return AttemptResults(
        attempt=views.attempt_summary(db, att),
        profile=profile,
        measured=[c for c in profile.competencies if c.competency_id in measured_ids],
    )
