from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentUser
from app.core.database import utcnow
from app.core.errors import ConflictError, NotFoundError
from app.models import LearningActivity, Recommendation
from app.models.enums import ActivityKind, ActivityStatus, RecommendationStatus
from app.schemas.common import ERROR_RESPONSES
from app.schemas.results import ActivityOut, PlanOut, RecommendationOut, ReflectionIn
from app.services import gaps as gap_service
from app.services import recommendations as rec_service
from app.services import views
from app.services.audit import audit
from app.services.profile import completed_attempts

router = APIRouter(tags=["recommendations"], responses=ERROR_RESPONSES)


@router.get(
    "/api/recommendations",
    response_model=list[RecommendationOut],
    summary="Active recommendations (each linked to competency, gap, goal and resource/task)",
)
def list_recommendations(user: CurrentUser, db: DB) -> list[RecommendationOut]:
    return [views.recommendation_out(db, r) for r in rec_service.active_recommendations(db, user.id)]


@router.post(
    "/api/recommendations/regenerate",
    response_model=list[RecommendationOut],
    summary="Re-run the recommendation engine on the latest gap analysis",
)
def regenerate(user: CurrentUser, db: DB) -> list[RecommendationOut]:
    attempts = completed_attempts(db, user.id)
    if not attempts:
        raise NotFoundError("Complete an assessment first.", "PROFILE_NOT_FOUND")
    recs = rec_service.refresh(db, attempts[-1], gap_service.latest_gaps(db, user.id))
    audit(db, user.id, "recommendations.regenerated")
    db.commit()
    return [views.recommendation_out(db, r) for r in recs]


@router.get(
    "/api/plan",
    response_model=PlanOut,
    tags=["plan"],
    summary="Development plan: Learn → Practice → Reflect → Reassess per priority",
)
def plan(user: CurrentUser, db: DB) -> PlanOut:
    active = rec_service.active_recommendations(db, user.id)
    completed = list(
        db.scalars(
            select(Recommendation)
            .where(Recommendation.user_id == user.id, Recommendation.status == RecommendationStatus.COMPLETED)
            .options(selectinload(Recommendation.activities))
            .order_by(Recommendation.completed_at.desc())
            .limit(10)
        )
    )
    done, total, pct = rec_service.plan_progress(active)
    return PlanOut(
        recommendations=[views.recommendation_out(db, r) for r in active],
        completed=[views.recommendation_out(db, r) for r in completed],
        done=done,
        total=total,
        progress_pct=pct,
    )


def _activity(db, user, activity_id: int) -> LearningActivity:
    a = db.scalar(
        select(LearningActivity).where(LearningActivity.id == activity_id, LearningActivity.user_id == user.id)
    )
    if a is None:
        raise NotFoundError("Plan activity not found", "ACTIVITY_NOT_FOUND")
    return a


@router.post(
    "/api/plan/activities/{activity_id}/reflection",
    response_model=ActivityOut,
    tags=["plan"],
    summary="Save a reflection (Reflect step)",
)
def reflect(activity_id: int, body: ReflectionIn, user: CurrentUser, db: DB) -> ActivityOut:
    a = _activity(db, user, activity_id)
    if a.kind != ActivityKind.REFLECT:
        raise ConflictError("Only reflection steps accept a reflection.", "NOT_A_REFLECTION")
    a.response_text = body.text.strip()
    a.status, a.completed_at = ActivityStatus.DONE, utcnow()
    audit(db, user.id, "plan.reflection_saved", "learning_activity", a.id)
    db.commit()
    rec = a.recommendation
    db.refresh(rec)
    return next(x for x in views.recommendation_out(db, rec).activities if x.id == a.id)
