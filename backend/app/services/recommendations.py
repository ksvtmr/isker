"""Recommendation engine (rule-based, explainable — AI is not asked "what should this user learn?").

Input:  user profile (format, weekly time) + stored gaps (priority) + goals + current level + progress
Output: one Recommendation per priority competency, each with a 4-step plan
        Learn (resource) → Practice (task) → Reflect (prompt) → Reassess

Resource ranking for a competency:
    +5 not completed yet · +3 difficulty matches level (+1 adjacent) · +2 matches preferred format
    +1 fits in half the weekly learning time · +1 already in progress (continue)
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AssessmentAttempt,
    Competency,
    CompetencyGap,
    LearningActivity,
    LearningResource,
    PracticalTask,
    PracticeSubmission,
    Recommendation,
    UserGoal,
    UserLearningProgress,
    UserProfile,
)
from app.models.enums import (
    ActivityKind,
    ActivityStatus,
    Difficulty,
    LearningFormat,
    PracticeStatus,
    ProgressStatus,
    RecommendationStatus,
    ResourceType,
)
from app.services.levels import level_rank_for
from app.services.profile import Relevance, goal_relevance, relevance_for

TOP_N = 3
GOAL_MENTION_THRESHOLD = 0.6
DIFF_ORDER = [Difficulty.BEGINNER, Difficulty.INTERMEDIATE, Difficulty.ADVANCED]
FORMAT_TYPES = {
    LearningFormat.ARTICLE: {ResourceType.ARTICLE, ResourceType.CASE_STUDY, ResourceType.TEMPLATE},
    LearningFormat.VIDEO: {ResourceType.VIDEO},
    LearningFormat.COURSE: {ResourceType.COURSE},
}


def difficulty_for_score(score: int) -> Difficulty:
    rank = level_rank_for(score)
    return Difficulty.BEGINNER if rank <= 2 else Difficulty.INTERMEDIATE if rank == 3 else Difficulty.ADVANCED


def _diff_points(item: Difficulty, wanted: Difficulty) -> int:
    d = abs(DIFF_ORDER.index(item) - DIFF_ORDER.index(wanted))
    return 3 if d == 0 else 1 if d == 1 else 0


@dataclass
class LearnerContext:
    preferred_format: LearningFormat
    weekly_minutes: int
    completed_resources: set[int]
    in_progress_resources: set[int]
    completed_tasks: set[int]


def rank_resources(resources: list[LearningResource], score: int, ctx: LearnerContext) -> list[LearningResource]:
    wanted = difficulty_for_score(score)
    fmt_types = FORMAT_TYPES.get(ctx.preferred_format)

    def pts(r: LearningResource) -> tuple[int, int]:
        p = 0
        p += 5 if r.id not in ctx.completed_resources else 0
        p += _diff_points(r.difficulty, wanted)
        p += 2 if (fmt_types is None or r.type in fmt_types) else 0
        p += 1 if r.duration_minutes <= max(10, ctx.weekly_minutes // 2) else 0
        p += 1 if r.id in ctx.in_progress_resources else 0
        return (p, -r.id)

    return sorted(resources, key=pts, reverse=True)


def rank_tasks(tasks: list[PracticalTask], score: int, ctx: LearnerContext) -> list[PracticalTask]:
    wanted = difficulty_for_score(score)
    return sorted(
        tasks,
        key=lambda t: ((5 if t.id not in ctx.completed_tasks else 0) + _diff_points(t.difficulty, wanted), -t.id),
        reverse=True,
    )


def build_reason(gap: CompetencyGap, comp: Competency, rel: Relevance, stretch: bool = False) -> str:
    if stretch:
        text = (
            f"Score {gap.current_score} meets your target of {gap.target_score}; "
            "this is your lowest area, so it is a stretch goal"
        )
    else:
        text = f"Score {gap.current_score} is {gap.gap} points below your target of {gap.target_score}"
    if rel.goal is not None and rel.value >= GOAL_MENTION_THRESHOLD:
        text += f", and it matters for your goal “{rel.goal.title}”"
    elif comp.importance >= 0.8:
        text += f", and {comp.name} has a large effect on early-stage ventures"
    return text + "."


def learner_context(db: Session, user_id: int) -> LearnerContext:
    prof = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    progress = list(db.scalars(select(UserLearningProgress).where(UserLearningProgress.user_id == user_id)))
    subs = db.scalars(
        select(PracticeSubmission).where(
            PracticeSubmission.user_id == user_id, PracticeSubmission.status == PracticeStatus.COMPLETED
        )
    )
    return LearnerContext(
        preferred_format=prof.preferred_learning_format if prof else LearningFormat.MIXED,
        weekly_minutes=prof.weekly_learning_minutes if prof else 60,
        completed_resources={p.resource_id for p in progress if p.status == ProgressStatus.COMPLETED},
        in_progress_resources={p.resource_id for p in progress if p.status == ProgressStatus.IN_PROGRESS},
        completed_tasks={s.task_id for s in subs},
    )


def active_recommendations(db: Session, user_id: int) -> list[Recommendation]:
    return list(
        db.scalars(
            select(Recommendation)
            .where(Recommendation.user_id == user_id, Recommendation.status == RecommendationStatus.ACTIVE)
            .options(selectinload(Recommendation.activities))
            .order_by(Recommendation.priority, Recommendation.id)
        )
    )


def _all_done(rec: Recommendation) -> bool:
    return bool(rec.activities) and all(a.status == ActivityStatus.DONE for a in rec.activities)


def _create(
    db: Session,
    user_id: int,
    attempt: AssessmentAttempt,
    gap: CompetencyGap,
    comp: Competency,
    rel: Relevance,
    ctx: LearnerContext,
    priority: int,
    stretch: bool,
) -> Recommendation:
    resources = list(
        db.scalars(
            select(LearningResource).where(
                LearningResource.competency_id == comp.id, LearningResource.is_published.is_(True)
            )
        )
    )
    tasks = list(
        db.scalars(
            select(PracticalTask).where(PracticalTask.competency_id == comp.id, PracticalTask.is_published.is_(True))
        )
    )
    ranked_res = rank_resources(resources, gap.current_score, ctx)
    ranked_tasks = rank_tasks(tasks, gap.current_score, ctx)
    res = ranked_res[0] if ranked_res else None
    task = ranked_tasks[0] if ranked_tasks else None
    rec = Recommendation(
        user_id=user_id,
        attempt_id=attempt.id,
        gap_id=gap.id,
        competency_id=comp.id,
        goal_id=rel.goal.id if rel.goal is not None and rel.value >= GOAL_MENTION_THRESHOLD else None,
        resource_id=res.id if res else None,
        task_id=task.id if task else None,
        priority=priority,
        priority_score=gap.priority_score,
        reason=build_reason(gap, comp, rel, stretch),
    )
    db.add(rec)
    db.flush()
    steps = []
    if res is not None:
        done = res.id in ctx.completed_resources
        steps.append(
            LearningActivity(
                kind=ActivityKind.LEARN,
                title=res.title,
                resource_id=res.id,
                status=ActivityStatus.DONE if done else ActivityStatus.TODO,
            )
        )
    if task is not None:
        done = task.id in ctx.completed_tasks
        steps.append(
            LearningActivity(
                kind=ActivityKind.PRACTICE,
                title=task.title,
                task_id=task.id,
                status=ActivityStatus.DONE if done else ActivityStatus.TODO,
            )
        )
    steps.append(
        LearningActivity(
            kind=ActivityKind.REFLECT,
            title="Reflect on what you learned",
            prompt=comp.reflection_prompt or f"What did you learn about {comp.name}?",
        )
    )
    steps.append(LearningActivity(kind=ActivityKind.REASSESS, title=f"Reassess {comp.name}"))
    for i, a in enumerate(steps):
        a.sort_order = i
        a.user_id = user_id
        a.recommendation_id = rec.id
        db.add(a)
    db.flush()
    db.refresh(rec)
    return rec


def refresh(db: Session, attempt: AssessmentAttempt, gaps: list[CompetencyGap]) -> list[Recommendation]:
    """Regenerate the plan after an attempt, keeping in-progress recommendations that are still relevant."""
    user_id = attempt.user_id
    comps = {c.id: c for c in db.scalars(select(Competency))}
    rel = goal_relevance(db, user_id)
    has_goals = db.scalar(select(UserGoal.id).where(UserGoal.user_id == user_id).limit(1)) is not None
    ctx = learner_context(db, user_id)

    ordered = sorted(gaps, key=lambda g: g.priority_rank)
    desired = [g for g in ordered if g.gap > 0][:TOP_N]
    stretch = False
    if not desired:
        desired = sorted(gaps, key=lambda g: (g.current_score, g.competency_id))[:2]
        stretch = True
    desired_by_comp = {g.competency_id: g for g in desired}

    kept: dict[int, Recommendation] = {}
    for rec in active_recommendations(db, user_id):
        if _all_done(rec):
            rec.status = RecommendationStatus.COMPLETED
            rec.completed_at = attempt.completed_at
        elif rec.competency_id in desired_by_comp and rec.competency_id not in kept:
            g = desired_by_comp[rec.competency_id]
            rec.gap_id, rec.priority_score = g.id, g.priority_score
            rec.reason = build_reason(
                g, comps[g.competency_id], relevance_for(rel, g.competency_id, has_goals), stretch
            )
            kept[rec.competency_id] = rec
        else:
            rec.status = RecommendationStatus.SUPERSEDED
    out: list[Recommendation] = []
    for priority, g in enumerate(desired, start=1):
        existing = kept.get(g.competency_id)
        if existing is not None:
            existing.priority = priority
            rec = existing
        else:
            rec = _create(
                db,
                user_id,
                attempt,
                g,
                comps[g.competency_id],
                relevance_for(rel, g.competency_id, has_goals),
                ctx,
                priority,
                stretch,
            )
        out.append(rec)
    db.flush()
    return out


# --- Activity sync hooks -------------------------------------------------------------------------


def _active_activities(db: Session, user_id: int, kind: ActivityKind) -> list[LearningActivity]:
    return list(
        db.scalars(
            select(LearningActivity)
            .join(Recommendation)
            .where(
                LearningActivity.user_id == user_id,
                LearningActivity.kind == kind,
                Recommendation.status == RecommendationStatus.ACTIVE,
            )
        )
    )


def on_resource_completed(db: Session, user_id: int, resource_id: int, when) -> None:
    for a in _active_activities(db, user_id, ActivityKind.LEARN):
        if a.resource_id == resource_id and a.status != ActivityStatus.DONE:
            a.status, a.completed_at = ActivityStatus.DONE, when


def on_resource_started(db: Session, user_id: int, resource_id: int) -> None:
    for a in _active_activities(db, user_id, ActivityKind.LEARN):
        if a.resource_id == resource_id and a.status == ActivityStatus.TODO:
            a.status = ActivityStatus.IN_PROGRESS


def on_task_started(db: Session, user_id: int, task_id: int) -> None:
    for a in _active_activities(db, user_id, ActivityKind.PRACTICE):
        if a.task_id == task_id and a.status == ActivityStatus.TODO:
            a.status = ActivityStatus.IN_PROGRESS


def on_task_completed(db: Session, user_id: int, task_id: int, when) -> None:
    for a in _active_activities(db, user_id, ActivityKind.PRACTICE):
        if a.task_id == task_id and a.status != ActivityStatus.DONE:
            a.status, a.completed_at = ActivityStatus.DONE, when


def reassess_unlocked(rec: Recommendation) -> bool:
    return all(a.status == ActivityStatus.DONE for a in rec.activities if a.kind != ActivityKind.REASSESS)


def on_reassessed(db: Session, user_id: int, competency_ids: set[int], when) -> None:
    for rec in active_recommendations(db, user_id):
        if rec.competency_id in competency_ids and reassess_unlocked(rec):
            for a in rec.activities:
                if a.kind == ActivityKind.REASSESS:
                    a.status, a.completed_at = ActivityStatus.DONE, when


def plan_progress(recs: list[Recommendation]) -> tuple[int, int, int]:
    acts = [a for r in recs for a in r.activities]
    done = sum(1 for a in acts if a.status == ActivityStatus.DONE)
    return done, len(acts), (round(done / len(acts) * 100) if acts else 0)
