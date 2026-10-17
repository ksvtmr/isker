"""Plans, entitlements, the user's own subscription, payment webhooks and personal data export."""

from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.api.deps import DB, CurrentUser
from app.core.database import utcnow
from app.core.errors import ValidationError
from app.models import (
    AssessmentAttempt,
    CompetencyScore,
    GoalDefinition,
    PracticeSubmission,
    Recommendation,
    SubscriptionEvent,
    SubscriptionPlan,
    UserGoal,
    UserLearningProgress,
    UserSubscription,
)
from app.schemas.billing import EntitlementOut, MySubscriptionOut, PlanOut, SubscriptionEventOut, SubscriptionOut
from app.schemas.common import ERROR_RESPONSES
from app.services import entitlements as ent
from app.services import payments
from app.services import recommendations as rec_service
from app.services import subscriptions as subs
from app.services.audit import audit

router = APIRouter(tags=["billing"], responses=ERROR_RESPONSES)


@router.get("/api/plans", response_model=list[PlanOut], summary="Active subscription plans (public)")
def list_plans(db: DB) -> list[SubscriptionPlan]:
    subs.ensure_default_plans(db)
    db.commit()
    return list(db.scalars(select(SubscriptionPlan).where(SubscriptionPlan.is_active.is_(True))
                           .order_by(SubscriptionPlan.sort_order, SubscriptionPlan.id)))


@router.get("/api/entitlements/me", response_model=list[EntitlementOut], summary="What my plan allows, with usage")
def my_entitlements(user: CurrentUser, db: DB) -> list[dict]:
    out = [e.as_dict() for e in ent.entitlements_for(db, user).values()]
    db.commit()  # lazy expiry may have written events
    return out


@router.get("/api/subscription/me", response_model=MySubscriptionOut, summary="My plan, subscription and history")
def my_subscription(user: CurrentUser, db: DB) -> MySubscriptionOut:
    sub = subs.current_subscription(db, user.id)
    plan = sub.plan if sub else subs.default_plan(db)
    history = db.scalars(select(SubscriptionEvent).where(SubscriptionEvent.user_id == user.id)
                         .order_by(SubscriptionEvent.id.desc()).limit(50))
    out = MySubscriptionOut(
        plan=PlanOut.model_validate(plan),
        subscription=SubscriptionOut.model_validate(sub) if sub else None,
        entitlements=[EntitlementOut(**e.as_dict()) for e in ent.entitlements_for(db, user).values()],
        history=[SubscriptionEventOut.model_validate(h) for h in history],
        payments=payments.status(),
    )
    db.commit()
    return out


@router.post("/api/billing/webhooks/{provider}", summary="Signed payment-provider webhook (idempotent)",
             responses={503: {"description": "Payments are not configured"}})
async def payment_webhook(provider: str, request: Request, db: DB) -> JSONResponse:
    body = await request.body()
    payments.verify_signature(provider, body, request.headers.get("x-isker-signature"))
    try:
        payload = json.loads(body)
    except ValueError as e:
        raise ValidationError("Webhook body must be JSON.", "INVALID_PAYLOAD") from e
    if not isinstance(payload, dict):
        raise ValidationError("Webhook body must be a JSON object.", "INVALID_PAYLOAD")
    status, duplicate = payments.handle_webhook(db, provider, payload)
    return JSONResponse({"status": status, "duplicate": duplicate})


def _dt(v):
    return v.isoformat() if v else None


@router.get("/api/export/me", summary="Download all my data as JSON (requires the export.data entitlement)")
def export_me(user: CurrentUser, db: DB) -> JSONResponse:
    ent.require(db, user, "export.data", consume=0)
    p = user.profile
    attempts = db.scalars(select(AssessmentAttempt).where(AssessmentAttempt.user_id == user.id)
                          .order_by(AssessmentAttempt.id))
    data = {
        "exported_at": utcnow().isoformat(),
        "account": {"id": user.id, "email": user.email, "full_name": user.full_name, "status": user.status.value,
                    "roles": user.role_keys, "created_at": _dt(user.created_at),
                    "email_verified_at": _dt(user.email_verified_at),
                    "terms_accepted_at": _dt(user.terms_accepted_at), "terms_version": user.terms_version},
        "profile": None if p is None else {
            "education": p.education, "background": p.background,
            "entrepreneurial_experience": p.entrepreneurial_experience.value,
            "business_experience": p.business_experience,
            "preferred_learning_format": p.preferred_learning_format.value,
            "weekly_learning_minutes": p.weekly_learning_minutes, "language": p.language},
        "goals": list(db.scalars(select(GoalDefinition.code).join(UserGoal, UserGoal.goal_id == GoalDefinition.id)
                                 .where(UserGoal.user_id == user.id))),
        "assessment_attempts": [
            {"id": a.id, "scope": a.scope.value, "status": a.status.value, "started_at": _dt(a.started_at),
             "completed_at": _dt(a.completed_at), "overall_score": a.overall_score,
             "answers": [{"question_id": x.question_id, "option_id": x.option_id, "text": x.text_response,
                          "item_score": x.item_score} for x in a.answers]}
            for a in attempts],
        "competency_scores": [
            {"attempt_id": s.attempt_id, "competency_id": s.competency_id, "score": s.score,
             "confidence": s.confidence, "created_at": _dt(s.created_at)}
            for s in db.scalars(select(CompetencyScore).where(CompetencyScore.user_id == user.id))],
        "recommendations": [
            # Texts are rendered in the language of this request (the stored reason is the English base text).
            {"id": r.id, "competency_id": r.competency_id, "competency": r.competency.name if r.competency else None,
             "status": r.status.value, "reason": rec_service.localized_reason(r),
             "created_at": _dt(r.created_at)}
            for r in db.scalars(select(Recommendation).where(Recommendation.user_id == user.id))],
        "learning_progress": [
            {"resource_id": lp.resource_id, "status": lp.status.value, "progress_pct": lp.progress_pct,
             "completed_at": _dt(lp.completed_at)}
            for lp in db.scalars(select(UserLearningProgress).where(UserLearningProgress.user_id == user.id))],
        "practice_submissions": [
            {"task_id": ps.task_id, "status": ps.status.value, "response": ps.response_text,
             "feedback_score": ps.feedback_score, "submitted_at": _dt(ps.submitted_at)}
            for ps in db.scalars(select(PracticeSubmission).where(PracticeSubmission.user_id == user.id))],
        "subscriptions": [
            {"plan": s.plan.key, "status": s.status.value, "source": s.source.value, "started_at": _dt(s.started_at),
             "expires_at": _dt(s.expires_at), "ended_at": _dt(s.ended_at)}
            for s in db.scalars(select(UserSubscription).where(UserSubscription.user_id == user.id))],
    }
    audit(db, user.id, "user.data_exported", "user", user.id)
    db.commit()
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="isker-export.json"'})
