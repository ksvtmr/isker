from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentUser
from app.core.errors import VERSION_CONFLICT_MESSAGE, ValidationError, VersionConflict
from app.models import GoalDefinition, User, UserGoal, UserProfile
from app.schemas.common import ERROR_RESPONSES
from app.schemas.profile import GoalOut, OnboardingIn, ProfileOut, ProfileUpdate
from app.services.audit import audit
from app.services.locking import changes, snapshot

router = APIRouter(tags=["profile"], responses=ERROR_RESPONSES)

# Recorded old → new in the audit log (free-text background fields are only reported as changed by length cap).
PROFILE_AUDIT_FIELDS = ("education", "entrepreneurial_experience", "preferred_learning_format",
                        "weekly_learning_minutes", "language", "notify_reassessment", "notify_weekly_summary")


def _profile(db, user: User) -> UserProfile:
    """The user's profile, created on first use. Two concurrent first requests can both try to create it: the unique
    user_id decides, and the loser reads the row the winner created."""
    if user.profile is not None:
        return user.profile
    try:
        with db.begin_nested():
            db.add(UserProfile(user_id=user.id))
            db.flush()
    except IntegrityError:
        pass  # created by a concurrent request
    db.expire(user, ["profile"])
    return user.profile


def _out(db, user: User) -> ProfileOut:
    p = _profile(db, user)
    goals = db.scalars(
        select(GoalDefinition)
        .join(UserGoal, UserGoal.goal_id == GoalDefinition.id)
        .where(UserGoal.user_id == user.id)
        .order_by(GoalDefinition.sort_order)
    )
    return ProfileOut(
        full_name=user.full_name,
        email=user.email,
        education=p.education,
        background=p.background,
        entrepreneurial_experience=p.entrepreneurial_experience,
        business_experience=p.business_experience,
        preferred_learning_format=p.preferred_learning_format,
        weekly_learning_minutes=p.weekly_learning_minutes,
        language=p.language,
        notify_reassessment=p.notify_reassessment,
        notify_weekly_summary=p.notify_weekly_summary,
        goals=[GoalOut.model_validate(g) for g in goals],
        onboarding_completed=user.onboarding_completed,
    )


def _set_goals(db, user: User, codes: list[str]) -> None:
    goals = list(db.scalars(select(GoalDefinition).where(GoalDefinition.code.in_(codes))))
    unknown = set(codes) - {g.code for g in goals}
    if unknown:
        raise ValidationError("Unknown goal selected.", "INVALID_GOAL", {"codes": sorted(unknown)})
    # Replace the selection. A concurrent save of the same user's goals can insert the same rows between our delete
    # and insert; the (user_id, goal_id) unique constraint then fails our insert, so delete again and retry once.
    for attempt in range(2):
        try:
            with db.begin_nested():
                db.execute(delete(UserGoal).where(UserGoal.user_id == user.id))
                db.add_all([UserGoal(user_id=user.id, goal_id=g.id) for g in goals])
                db.flush()
            return
        except IntegrityError:
            if attempt:
                raise VersionConflict(VERSION_CONFLICT_MESSAGE) from None


@router.get("/api/goals", response_model=list[GoalOut], summary="Goal catalogue for onboarding/profile")
def list_goals(db: DB) -> list[GoalDefinition]:
    return list(db.scalars(select(GoalDefinition).order_by(GoalDefinition.sort_order)))


@router.get("/api/profile", response_model=ProfileOut, summary="Current user's profile, goals and preferences")
def get_profile(user: CurrentUser, db: DB) -> ProfileOut:
    out = _out(db, user)
    db.commit()
    return out


@router.post("/api/profile/onboarding", response_model=ProfileOut, summary="Complete onboarding")
def onboarding(body: OnboardingIn, user: CurrentUser, db: DB) -> ProfileOut:
    p = _profile(db, user)
    user.full_name = " ".join(body.full_name.split())
    p.education, p.background = body.education, body.background
    p.entrepreneurial_experience, p.business_experience = body.entrepreneurial_experience, body.business_experience
    p.preferred_learning_format, p.weekly_learning_minutes = (
        body.preferred_learning_format,
        body.weekly_learning_minutes,
    )
    _set_goals(db, user, body.goal_codes)
    user.onboarding_completed = True
    audit(db, user.id, "profile.onboarding_completed", "user", user.id, goals=body.goal_codes)
    db.commit()
    return _out(db, user)


@router.put("/api/profile", response_model=ProfileOut, summary="Update profile, goals and preferences")
def update_profile(body: ProfileUpdate, user: CurrentUser, db: DB) -> ProfileOut:
    p = _profile(db, user)
    before = {"full_name": user.full_name, **snapshot(p, PROFILE_AUDIT_FIELDS)}
    data = body.model_dump(exclude_unset=True)
    if "full_name" in data and data["full_name"]:
        user.full_name = " ".join(data.pop("full_name").split())
    data.pop("full_name", None)
    codes = data.pop("goal_codes", None)
    if codes is not None:
        if not codes:
            raise ValidationError("Choose at least one goal.", "GOAL_REQUIRED")
        _set_goals(db, user, codes)
    for k, v in data.items():
        if v is not None or k in ("background", "business_experience", "education"):
            setattr(p, k, v)
    diff = changes(before, {"full_name": user.full_name, **snapshot(p, PROFILE_AUDIT_FIELDS)})
    audit(db, user.id, "profile.updated", "user", user.id, fields=sorted(body.model_fields_set), changes=diff)
    db.commit()
    return _out(db, user)
