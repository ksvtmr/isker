"""Assessment engine: start/resume attempts, autosave answers, submit → score → gaps → plan → snapshot."""

from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
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
    ContentStatus,
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


def _published_competencies():
    return select(Competency.id).where(Competency.status == ContentStatus.PUBLISHED)


def live_question_filter(assessment_id: int) -> tuple:
    """Questions offered in new attempts: published, and measuring at least one published competency."""
    return (
        Question.assessment_id == assessment_id,
        Question.status == ContentStatus.PUBLISHED,
        Question.id.in_(
            select(QuestionCompetency.question_id).where(
                QuestionCompetency.competency_id.in_(_published_competencies())
            )
        ),
    )


def questions_for(db: Session, attempt: AssessmentAttempt) -> list[Question]:
    """The questions of an attempt.

    A completed attempt is defined by the questions it answered (their versions are frozen, see admin question
    versioning), so its results stay reproducible after the bank changes. An open attempt uses the published
    questions that measure at least one published competency; where it already answered an older version of a
    question that has since been replaced, it keeps that version so the answer is not lost.
    """
    opts = (selectinload(Question.options), selectinload(Question.competency_links))
    order = (Question.sort_order, Question.id)
    answered = select(Answer.question_id).where(Answer.attempt_id == attempt.id)
    if attempt.status == AttemptStatus.COMPLETED:
        return list(db.scalars(select(Question).where(Question.id.in_(answered)).options(*opts).order_by(*order)))
    q = select(Question).where(*live_question_filter(attempt.assessment_id)).options(*opts).order_by(*order)
    if attempt.scope == AttemptScope.COMPETENCY and attempt.scope_competency_id:
        q = q.where(
            Question.id.in_(
                select(QuestionCompetency.question_id).where(
                    QuestionCompetency.competency_id == attempt.scope_competency_id
                )
            )
        )
    live = list(db.scalars(q))
    if attempt.id is None:
        return live
    live_ids = {x.id for x in live}
    stale = set(db.scalars(answered)) - live_ids
    if not stale:
        return live
    # Map each replaced version to its successor, then swap the newest live version for the answered one.
    successor = {
        prev: qid
        for qid, prev in db.execute(
            select(Question.id, Question.previous_id).where(
                Question.assessment_id == attempt.assessment_id, Question.previous_id.is_not(None)
            )
        )
    }
    swap: dict[int, int] = {}
    for old in stale:
        cur, seen = old, set()
        while cur in successor and cur not in seen:
            seen.add(cur)
            cur = successor[cur]
            if cur in live_ids:
                swap[cur] = old
                break
    if not swap:
        return live
    olds = {x.id: x for x in db.scalars(select(Question).where(Question.id.in_(swap.values())).options(*opts))}
    return [olds[swap[x.id]] if x.id in swap else x for x in live]


def scope_competency_ids(db: Session, attempt: AssessmentAttempt, questions: list[Question]) -> list[int]:
    if attempt.scope == AttemptScope.COMPETENCY and attempt.scope_competency_id:
        return [attempt.scope_competency_id]
    ids = {link.competency_id for q in questions for link in q.competency_links}
    return [
        c.id
        for c in db.scalars(
            select(Competency).where(Competency.status == ContentStatus.PUBLISHED).order_by(Competency.sort_order)
        )
        if c.id in ids
    ]


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
        comp = db.get(Competency, competency_id) if competency_id is not None else None
        if comp is None or comp.status != ContentStatus.PUBLISHED:
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
        db.flush()  # leave the "one open attempt per user" index before the new attempt enters it
    assessment = active_assessment(db)
    att = AssessmentAttempt(
        user_id=user.id, assessment_id=assessment.id, scope=scope, scope_competency_id=competency_id
    )
    # Two concurrent starts: the partial unique index (one in_progress attempt per user) lets only one insert win;
    # the other resumes the attempt that won instead of failing.
    try:
        with db.begin_nested():
            db.add(att)
            db.flush()
    except IntegrityError:
        winner = in_progress_attempt(db, user.id)
        if winner is None:  # pragma: no cover - defensive
            raise
        return winner, True
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
        # Two autosaves for the same question can race; the unique constraint decides, the loser re-reads.
        try:
            with db.begin_nested():
                ans = Answer(attempt_id=attempt.id, question_id=q.id)
                db.add(ans)
                db.flush()
            attempt.answers.append(ans)
        except IntegrityError:
            ans = db.scalar(select(Answer).where(Answer.attempt_id == attempt.id, Answer.question_id == q.id))
            if ans is None:  # pragma: no cover - defensive
                raise
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


def claim_for_submit(db: Session, attempt: AssessmentAttempt, now) -> None:
    """Atomically move the attempt out of `in_progress` (conditional UPDATE). Of two concurrent submits only one
    matches the row: on PostgreSQL the second waits for the first to commit and then finds nothing to update. The
    loser gets 409 ATTEMPT_NOT_IN_PROGRESS instead of a unique-constraint error on competency_scores. If the
    winner's transaction fails, its claim is rolled back with it and the attempt stays open."""
    result = db.execute(
        update(AssessmentAttempt)
        .where(AssessmentAttempt.id == attempt.id, AssessmentAttempt.status == AttemptStatus.IN_PROGRESS)
        .values(status=AttemptStatus.COMPLETED, completed_at=now)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise ConflictError("This assessment is already finished.", "ATTEMPT_NOT_IN_PROGRESS")


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

    now = utcnow()
    claim_for_submit(db, attempt, now)

    comp_ids = scope_competency_ids(db, attempt, questions)
    score_attempt(db, attempt, questions, comp_ids)

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
    refs = {
        "strongest": best.competency_id,
        "strongest_score": best.score,
        "top_gap": top_gap.competency_id if top_gap else None,
        "gap_score": top_gap.current_score if top_gap else None,
        "gap_target": top_gap.target_score if top_gap else None,
        "top_resource": recs[0].resource_id if recs and recs[0].resource_id else None,
    }
    generate_insight(db, user_id=user_id, facts=facts, attempt_id=attempt.id, refs=refs)
