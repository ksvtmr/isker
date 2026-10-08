from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from app.api.deps import DB, CurrentUser
from app.core.database import as_utc, utcnow
from app.core.errors import NotFoundError
from app.models import (
    AIEvaluation,
    AssessmentAttempt,
    LearningActivity,
    LearningResource,
    Notification,
    PracticalTask,
    PracticeSubmission,
    ProgressSnapshot,
    Reassessment,
    UserLearningProgress,
)
from app.models.enums import (
    ActivityKind,
    ActivityStatus,
    AttemptScope,
    AttemptStatus,
    PracticeStatus,
    ProgressStatus,
)
from app.schemas.common import ERROR_RESPONSES, Message
from app.schemas.progress import (
    ActivityLogItem,
    CompetencyTrend,
    DashboardOut,
    NotificationOut,
    ProgressOverview,
    SnapshotOut,
)
from app.services import assessments as assessment_service
from app.services import recommendations as rec_service
from app.services import views
from app.services.profile import history

router = APIRouter(responses=ERROR_RESPONSES)
REASSESS_AFTER_DAYS = 30


def _label(att: AssessmentAttempt) -> str:
    if att.scope == AttemptScope.COMPETENCY and att.scope_competency:
        return f"Reassessment {att.sequence} · {att.scope_competency.short_name}"
    return f"Assessment {att.sequence}"


def _counts(db, user_id: int) -> tuple[int, int, int, int]:
    res = (
        db.scalar(
            select(func.count(UserLearningProgress.id)).where(
                UserLearningProgress.user_id == user_id, UserLearningProgress.status == ProgressStatus.COMPLETED
            )
        )
        or 0
    )
    tasks = (
        db.scalar(
            select(func.count(PracticeSubmission.id)).where(
                PracticeSubmission.user_id == user_id, PracticeSubmission.status == PracticeStatus.COMPLETED
            )
        )
        or 0
    )
    refl = (
        db.scalar(
            select(func.count(LearningActivity.id)).where(
                LearningActivity.user_id == user_id,
                LearningActivity.kind == ActivityKind.REFLECT,
                LearningActivity.status == ActivityStatus.DONE,
            )
        )
        or 0
    )
    reas = (
        db.scalar(
            select(func.count(Reassessment.id))
            .join(AssessmentAttempt, AssessmentAttempt.id == Reassessment.attempt_id)
            .where(Reassessment.user_id == user_id, AssessmentAttempt.status == AttemptStatus.COMPLETED)
        )
        or 0
    )
    return res, tasks, refl, reas


@router.get(
    "/api/progress",
    response_model=ProgressOverview,
    tags=["progress"],
    summary="Longitudinal development: snapshots, competency trends, activity counts",
)
def progress(user: CurrentUser, db: DB) -> ProgressOverview:
    snaps = db.execute(
        select(ProgressSnapshot, AssessmentAttempt)
        .join(AssessmentAttempt, AssessmentAttempt.id == ProgressSnapshot.attempt_id)
        .where(ProgressSnapshot.user_id == user.id)
        .options(joinedload(AssessmentAttempt.scope_competency))
        .order_by(AssessmentAttempt.completed_at)
    ).all()
    snapshots = [
        SnapshotOut(
            attempt_id=a.id,
            label=_label(a),
            scope=a.scope.value,
            competency_name=a.scope_competency.name if a.scope_competency else None,
            date=a.completed_at,
            overall=s.overall_score,
            ideas=s.ideas_score,
            resources=s.resources_score,
            action=s.action_score,
            level=s.level,
            completed_resources=s.completed_resources,
            completed_tasks=s.completed_tasks,
        )
        for s, a in snaps
    ]
    comps = {c.id: c for c in views.competencies(db)}
    trends = []
    for cid, pts in history(db, user.id).items():
        scores = [s.score for s, _ in pts]
        trends.append(
            CompetencyTrend(
                competency_id=cid,
                code=comps[cid].code,
                name=comps[cid].name,
                area_code=comps[cid].area.code,
                first=scores[0],
                previous=scores[-2] if len(scores) > 1 else None,
                current=scores[-1],
                change_since_previous=(scores[-1] - scores[-2]) if len(scores) > 1 else None,
                change_since_first=scores[-1] - scores[0],
                points=scores,
            )
        )
    trends.sort(key=lambda t: comps[t.competency_id].sort_order)
    res, tasks, refl, reas = _counts(db, user.id)

    recent: list[ActivityLogItem] = []
    for p, r in db.execute(
        select(UserLearningProgress, LearningResource)
        .join(LearningResource)
        .options(joinedload(LearningResource.competency))
        .where(UserLearningProgress.user_id == user.id, UserLearningProgress.status == ProgressStatus.COMPLETED)
    ).all():
        recent.append(
            ActivityLogItem(
                title=r.title, competency=r.competency.name, type=views.TYPE_LABEL[r.type.value], date=p.completed_at
            )
        )
    for s, t in db.execute(
        select(PracticeSubmission, PracticalTask)
        .join(PracticalTask)
        .options(joinedload(PracticalTask.competency))
        .where(PracticeSubmission.user_id == user.id, PracticeSubmission.status == PracticeStatus.COMPLETED)
    ).all():
        recent.append(
            ActivityLogItem(title=t.title, competency=t.competency.name, type="Practical task", date=s.completed_at)
        )
    for a in db.scalars(
        select(LearningActivity).where(
            LearningActivity.user_id == user.id,
            LearningActivity.kind == ActivityKind.REFLECT,
            LearningActivity.status == ActivityStatus.DONE,
        )
    ):
        comp = comps[a.recommendation.competency_id]
        recent.append(
            ActivityLogItem(
                title=f"Reflection: {comp.short_name}", competency=comp.name, type="Reflection", date=a.completed_at
            )
        )
    recent = sorted([r for r in recent if r.date], key=lambda r: r.date, reverse=True)[:8]
    overall = [s.overall for s in snapshots]
    return ProgressOverview(
        snapshots=snapshots,
        trends=trends,
        overall_first=overall[0] if overall else None,
        overall_previous=overall[-2] if len(overall) > 1 else None,
        overall_current=overall[-1] if overall else None,
        completed_resources=res,
        completed_tasks=tasks,
        reflections=refl,
        reassessments=reas,
        recent=recent,
    )


@router.get(
    "/api/dashboard",
    response_model=DashboardOut,
    tags=["progress"],
    summary="Everything the dashboard needs in one call",
)
def dashboard(user: CurrentUser, db: DB) -> DashboardOut:
    profile = views.profile_overview(db, user.id)
    recs = rec_service.active_recommendations(db, user.id)
    done, total, pct = rec_service.plan_progress(recs)
    current = assessment_service.in_progress_attempt(db, user.id)
    next_re = None
    ready = next(
        (
            r
            for r in recs
            if rec_service.reassess_unlocked(r)
            and any(a.kind == ActivityKind.REASSESS and a.status != ActivityStatus.DONE for a in r.activities)
        ),
        None,
    )
    if ready is not None:
        c = next(x for x in views.competencies(db) if x.id == ready.competency_id)
        next_re = {"ready": True, "days": 0, "competency_id": c.id, "competency_name": c.name}
    elif profile.assessed_at is not None:
        due = as_utc(profile.assessed_at) + timedelta(days=REASSESS_AFTER_DAYS)
        days = max(0, (due - utcnow()).days)
        focus = profile.priority_gaps[0] if profile.priority_gaps else None
        next_re = {
            "ready": days == 0,
            "days": days,
            "competency_id": focus.competency_id if focus else None,
            "competency_name": focus.name if focus else None,
        }
    unread = (
        db.scalar(
            select(func.count(Notification.id)).where(Notification.user_id == user.id, Notification.is_read.is_(False))
        )
        or 0
    )
    return DashboardOut(
        user_name=user.full_name.split(" ")[0],
        onboarding_completed=user.onboarding_completed,
        profile=profile,
        plan_progress_pct=pct,
        plan_done=done,
        plan_total=total,
        top_recommendation=views.recommendation_out(db, recs[0]) if recs else None,
        in_progress_attempt_id=current.id if current else None,
        next_reassessment=next_re,
        insight=profile.insight,
        unread_notifications=unread,
    )


@router.get("/api/notifications", response_model=list[NotificationOut], tags=["notifications"])
def notifications(user: CurrentUser, db: DB) -> list[Notification]:
    return list(
        db.scalars(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(Notification.created_at.desc())
            .limit(50)
        )
    )


@router.post("/api/notifications/{notification_id}/read", response_model=Message, tags=["notifications"])
def mark_read(notification_id: int, user: CurrentUser, db: DB) -> Message:
    n = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id))
    if n is None:
        raise NotFoundError("Notification not found")
    n.is_read = True
    db.commit()
    return Message(message="ok")


@router.get("/api/ai/status", tags=["ai"], summary="Which AI provider is active (never exposes keys)")
def ai_status(user: CurrentUser) -> dict:
    from app.ai.providers import get_provider

    p = get_provider()
    return {"provider": p.name, "model": p.model, "mock": p.name == "mock"}


@router.get("/api/ai/evaluations/{evaluation_id}", tags=["ai"], summary="One of your AI evaluations (explainability)")
def my_evaluation(evaluation_id: int, user: CurrentUser, db: DB) -> dict:
    ev = db.scalar(
        select(AIEvaluation)
        .where(AIEvaluation.id == evaluation_id, AIEvaluation.user_id == user.id)
        .options(joinedload(AIEvaluation.prompt_version))
    )
    if ev is None:
        raise NotFoundError("Evaluation not found", "EVALUATION_NOT_FOUND")
    return {
        "id": ev.id,
        "input_type": ev.input_type.value,
        "provider": ev.provider,
        "model": ev.model,
        "status": ev.status.value,
        "prompt_version": ev.prompt_version.version if ev.prompt_version else None,
        "score": ev.score,
        "level": ev.level,
        "confidence": ev.confidence,
        "output": ev.output,
        "created_at": ev.created_at,
    }
