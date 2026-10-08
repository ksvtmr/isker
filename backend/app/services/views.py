"""Builds API response objects from database state (shared by several routes)."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    AIEvaluation,
    AssessmentAttempt,
    Competency,
    CompetencyArea,
    CompetencyGap,
    CompetencyScore,
    LearningResource,
    PracticalTask,
    Recommendation,
)
from app.models.enums import ActivityKind, AIInputType, AttemptStatus
from app.schemas.assessment import AttemptSummary, CompetencyRef
from app.schemas.competency import CompetencyScoreOut
from app.schemas.results import ActivityOut, AreaScore, InsightOut, ProfileOverview, RecommendationOut
from app.services import gaps as gap_service
from app.services import recommendations as rec_service
from app.services.levels import DEFAULT_TARGET, gap_band, level_name_for
from app.services.profile import area_scores, completed_attempts, current_scores, history, overall_score

TYPE_LABEL = {
    "article": "Article",
    "video": "Video",
    "course": "Course",
    "exercise": "Exercise",
    "case_study": "Case study",
    "template": "Template",
}


def competencies(db: Session) -> list[Competency]:
    return list(db.scalars(select(Competency).options(joinedload(Competency.area)).order_by(Competency.sort_order)))


def attempt_summary(db: Session, att: AssessmentAttempt, total: int | None = None) -> AttemptSummary:
    from app.services.assessments import is_answered, questions_for

    qs = questions_for(db, att)
    answers = {a.question_id: a for a in att.answers}
    comp = att.scope_competency
    return AttemptSummary(
        id=att.id,
        scope=att.scope,
        status=att.status,
        current_index=att.current_index,
        competency=CompetencyRef(id=comp.id, code=comp.code, name=comp.name) if comp else None,
        answered=sum(1 for q in qs if is_answered(q, answers.get(q.id))),
        total=total if total is not None else len(qs),
        sequence=att.sequence,
        overall_score=att.overall_score,
        started_at=att.started_at,
        completed_at=att.completed_at,
    )


def insight_out(ev: AIEvaluation | None) -> InsightOut | None:
    if ev is None or not ev.output:
        return None
    o = ev.output
    return InsightOut(
        headline=o.get("headline", ""),
        body=o.get("body", ""),
        next_step=o.get("next_step", ""),
        confidence=ev.confidence,
        provider=ev.provider,
        evaluation_id=ev.id,
        generated_at=ev.created_at,
    )


def latest_insight(db: Session, user_id: int, attempt_id: int | None = None) -> AIEvaluation | None:
    q = select(AIEvaluation).where(
        AIEvaluation.user_id == user_id, AIEvaluation.input_type == AIInputType.PROFILE_INSIGHT
    )
    if attempt_id is not None:
        q = q.where(AIEvaluation.attempt_id == attempt_id)
    return db.scalar(q.order_by(AIEvaluation.id.desc()))


def score_out(
    c: Competency, s: CompetencyScore | None, g: CompetencyGap | None, change: int | None = None
) -> CompetencyScoreOut:
    target = g.target_score if g else c.default_target or DEFAULT_TARGET
    gap = (g.gap if g else max(0, target - s.score)) if s else None
    return CompetencyScoreOut(
        competency_id=c.id,
        code=c.code,
        name=c.name,
        short_name=c.short_name,
        area_code=c.area.code,
        area_name=c.area.name,
        description=c.description,
        score=s.score if s else None,
        level=level_name_for(s.score) if s else None,
        target=target,
        gap=gap,
        gap_band=gap_band(gap) if gap is not None else None,
        priority_label=g.priority_label if g else None,
        priority_rank=g.priority_rank if g else None,
        confidence=s.confidence if s else None,
        explanation=s.explanation if s else None,
        assessed_at=s.created_at if s else None,
        change=change,
    )


def profile_overview(db: Session, user_id: int, as_of_attempt: AssessmentAttempt | None = None) -> ProfileOverview:
    attempts = completed_attempts(db, user_id)
    areas = list(db.scalars(select(CompetencyArea).order_by(CompetencyArea.sort_order)))
    comps = competencies(db)
    if not attempts:
        return ProfileOverview(
            has_profile=False,
            overall=None,
            level=None,
            previous_overall=None,
            change=None,
            assessed_at=None,
            attempt_id=None,
            areas=[AreaScore(code=a.code, name=a.name, color_token=a.color_token, score=None) for a in areas],
            competencies=[score_out(c, None, None) for c in comps],
            strengths=[],
            priority_gaps=[],
            insight=None,
        )
    current_att = as_of_attempt or attempts[-1]
    idx = next(i for i, a in enumerate(attempts) if a.id == current_att.id)
    prev_att = attempts[idx - 1] if idx > 0 else None
    scores = current_scores(db, user_id, up_to_attempt_id=current_att.id)
    prev_scores = current_scores(db, user_id, up_to_attempt_id=prev_att.id) if prev_att else {}
    gaps = {
        g.competency_id: g for g in db.scalars(select(CompetencyGap).where(CompetencyGap.attempt_id == current_att.id))
    }
    if not gaps and as_of_attempt is None:
        gaps = {g.competency_id: g for g in gap_service.latest_gaps(db, user_id)}
    a_scores = area_scores(db, scores)
    overall = current_att.overall_score if current_att.overall_score is not None else overall_score(scores)
    prev_overall = prev_att.overall_score if prev_att else None
    items = []
    for c in comps:
        s = scores.get(c.id)
        p = prev_scores.get(c.id)
        items.append(score_out(c, s, gaps.get(c.id), (s.score - p.score) if s and p else None))
    measured = [i for i in items if i.score is not None]
    strengths = sorted(measured, key=lambda i: (-(i.score or 0), i.competency_id))[:3]
    pgaps = sorted([i for i in measured if (i.gap or 0) >= 10], key=lambda i: (i.priority_rank or 99, -(i.gap or 0)))[
        :3
    ]
    return ProfileOverview(
        has_profile=True,
        overall=overall,
        level=level_name_for(overall) if overall is not None else None,
        previous_overall=prev_overall,
        change=(overall - prev_overall) if prev_overall is not None and overall is not None else None,
        assessed_at=current_att.completed_at,
        attempt_id=current_att.id,
        areas=[
            AreaScore(code=a.code, name=a.name, color_token=a.color_token, score=a_scores.get(a.code)) for a in areas
        ],
        competencies=items,
        strengths=strengths,
        priority_gaps=pgaps,
        insight=insight_out(
            latest_insight(db, user_id, current_att.id)
            or (latest_insight(db, user_id) if as_of_attempt is None else None)
        ),
    )


def recommendation_out(db: Session, rec: Recommendation) -> RecommendationOut:
    comp = db.get(Competency, rec.competency_id)
    gap = db.get(CompetencyGap, rec.gap_id)
    assert comp is not None and gap is not None
    res = db.get(LearningResource, rec.resource_id) if rec.resource_id else None
    task = db.get(PracticalTask, rec.task_id) if rec.task_id else None
    unlocked = rec_service.reassess_unlocked(rec)
    acts = []
    for a in rec.activities:
        dur, typ = None, None
        if a.kind == ActivityKind.LEARN and res:
            dur, typ = res.duration_minutes, TYPE_LABEL.get(res.type.value, res.type.value)
        elif a.kind == ActivityKind.PRACTICE and task:
            dur, typ = task.duration_minutes, "Practical task"
        acts.append(
            ActivityOut(
                id=a.id,
                kind=a.kind,
                title=a.title,
                status=a.status,
                locked=a.kind == ActivityKind.REASSESS and not unlocked and a.status.value != "done",
                resource_id=a.resource_id,
                task_id=a.task_id,
                prompt=a.prompt,
                response_text=a.response_text,
                duration_minutes=dur,
                type=typ,
                completed_at=a.completed_at,
            )
        )
    done = sum(1 for a in rec.activities if a.status.value == "done")
    return RecommendationOut(
        id=rec.id,
        priority=rec.priority,
        priority_score=rec.priority_score,
        status=rec.status,
        competency_id=comp.id,
        competency_code=comp.code,
        competency_name=comp.name,
        current=gap.current_score,
        target=gap.target_score,
        gap=gap.gap,
        band=gap.band,
        reason=rec.reason,
        goal=rec.goal.title if rec.goal else None,
        resource=(
            {
                "id": res.id,
                "title": res.title,
                "description": res.description,
                "type": TYPE_LABEL.get(res.type.value),
                "duration_minutes": res.duration_minutes,
                "difficulty": res.difficulty.value,
            }
            if res
            else None
        ),
        task=(
            {
                "id": task.id,
                "title": task.title,
                "duration_minutes": task.duration_minutes,
                "difficulty": task.difficulty.value,
            }
            if task
            else None
        ),
        activities=acts,
        progress_pct=round(done / len(rec.activities) * 100) if rec.activities else 0,
        created_at=rec.created_at,
    )


def attempt_count(db: Session, user_id: int) -> int:
    return (
        db.scalar(
            select(func.count(AssessmentAttempt.id)).where(
                AssessmentAttempt.user_id == user_id, AssessmentAttempt.status == AttemptStatus.COMPLETED
            )
        )
        or 0
    )


__all__ = [
    "attempt_summary",
    "competencies",
    "history",
    "insight_out",
    "latest_insight",
    "profile_overview",
    "recommendation_out",
    "score_out",
]
