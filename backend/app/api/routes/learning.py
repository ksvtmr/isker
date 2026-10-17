from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.api.deps import DB, CurrentUser
from app.core.content_i18n import base_text
from app.core.database import utcnow
from app.core.errors import NotFoundError
from app.models import Competency, LearningResource, Recommendation, UserLearningProgress
from app.models.enums import ContentStatus, Difficulty, ProgressStatus, RecommendationStatus, ResourceType
from app.schemas.common import ERROR_RESPONSES, Page
from app.schemas.learning import ProgressIn, ResourceDetail, ResourceOut
from app.services import entitlements
from app.services import recommendations as rec_service
from app.services.audit import audit

router = APIRouter(prefix="/api/learning", tags=["learning"], responses=ERROR_RESPONSES)


def _recs(db, user_id: int) -> dict[int, Recommendation]:
    return {
        r.resource_id: r
        for r in db.scalars(
            select(Recommendation).where(
                Recommendation.user_id == user_id,
                Recommendation.status == RecommendationStatus.ACTIVE,
                Recommendation.resource_id.is_not(None),
            )
        )
    }


def _out(r: LearningResource, p: UserLearningProgress | None, recommended: bool) -> dict:
    return dict(
        id=r.id,
        slug=r.slug,
        title=r.title,
        description=r.description,
        type=r.type,
        difficulty=r.difficulty,
        duration_minutes=r.duration_minutes,
        competency_id=r.competency_id,
        competency_code=r.competency.code,
        competency_name=r.competency.name,
        status=p.status if p else ProgressStatus.NOT_STARTED,
        progress_pct=p.progress_pct if p else 0,
        recommended=recommended,
        started_at=p.started_at if p else None,
        completed_at=p.completed_at if p else None,
    )


@router.get("/resources", response_model=Page[ResourceOut], summary="Browse learning resources (filterable)")
def list_resources(
    user: CurrentUser,
    db: DB,
    competency: str | None = None,
    type: ResourceType | None = None,  # noqa: A002
    difficulty: Difficulty | None = None,
    max_minutes: Annotated[int | None, Query(ge=1, le=600)] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    status: ProgressStatus | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 24,
) -> Page[ResourceOut]:
    stmt = (
        select(LearningResource)
        .join(Competency)
        .where(LearningResource.status == ContentStatus.PUBLISHED, Competency.status == ContentStatus.PUBLISHED)
    )
    if competency:
        stmt = stmt.where(Competency.code == competency)
    if type:
        stmt = stmt.where(LearningResource.type == type)
    if difficulty:
        stmt = stmt.where(LearningResource.difficulty == difficulty)
    if max_minutes:
        stmt = stmt.where(LearningResource.duration_minutes <= max_minutes)
    progress = {
        p.resource_id: p
        for p in db.scalars(select(UserLearningProgress).where(UserLearningProgress.user_id == user.id))
    }
    recs = _recs(db, user.id)
    rows = list(db.scalars(stmt.options(joinedload(LearningResource.competency))))
    if q:
        # Search the text the learner sees (already localized on load) and the English base text.
        needle = q.strip().casefold()
        rows = [
            r for r in rows
            if any(needle in (v or "").casefold() for v in (
                r.title, r.description, base_text(r, "title"), base_text(r, "description")))
        ]
    if status:
        rows = [
            r for r in rows if (progress[r.id].status if r.id in progress else ProgressStatus.NOT_STARTED) == status
        ]
    rows.sort(key=lambda r: (r.id not in recs, r.competency.sort_order, r.id))
    adv = entitlements.allows(db, user, "learning.advanced_resources")
    total = len(rows)
    rows = rows[(page - 1) * page_size : page * page_size]
    return Page[ResourceOut](
        items=[
            ResourceOut(
                **_out(r, progress.get(r.id), r.id in recs), locked=r.difficulty == Difficulty.ADVANCED and not adv
            )
            for r in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


def _in_active_plan(db, user_id: int, rid: int) -> bool:
    return db.scalar(
        select(Recommendation.id).where(
            Recommendation.user_id == user_id,
            Recommendation.status == RecommendationStatus.ACTIVE,
            Recommendation.resource_id == rid,
        ).limit(1)
    ) is not None


def _get(db, rid: int, history_user_id: int | None = None, plan_user_id: int | None = None) -> LearningResource:
    """A published resource. With `history_user_id`, an unpublished one the user already worked on is readable too
    (their progress history stays reachable), but nothing new can be started on it. With `plan_user_id`, an
    archived resource that is still a step of that user's active plan stays fully usable, so the plan (and the
    reassessment it unlocks) can be completed; it is replaced when the plan is next regenerated."""
    r = db.scalar(
        select(LearningResource).where(LearningResource.id == rid).options(joinedload(LearningResource.competency))
    )
    in_plan = (r is not None and plan_user_id is not None and r.status == ContentStatus.ARCHIVED
               and _in_active_plan(db, plan_user_id, r.id))
    if r is None or (r.status != ContentStatus.PUBLISHED and not in_plan and (
        history_user_id is None or _progress(db, history_user_id, r.id) is None
    )):
        raise NotFoundError("Learning resource not found", "RESOURCE_NOT_FOUND")
    return r


def _get_for(db, user, rid: int, read_only: bool = False) -> LearningResource:
    """Load a resource the user's plan allows (advanced resources need learning.advanced_resources)."""
    r = _get(db, rid, user.id if read_only else None, plan_user_id=user.id)
    if r.difficulty == Difficulty.ADVANCED:
        entitlements.require(db, user, "learning.advanced_resources", consume=0)
    return r


def _progress(db, user_id: int, rid: int) -> UserLearningProgress | None:
    return db.scalar(
        select(UserLearningProgress).where(
            UserLearningProgress.user_id == user_id, UserLearningProgress.resource_id == rid
        )
    )


def _ensure_progress(db, user_id: int, rid: int, **values) -> tuple[UserLearningProgress, bool]:
    """The user's progress row, created when missing. Two concurrent first requests may both try to insert it: the
    loser's insert hits the (user_id, resource_id) unique constraint inside a savepoint and re-reads the winner's row,
    instead of failing with a 500. Returns (row, created)."""
    p = _progress(db, user_id, rid)
    if p is not None:
        return p, False
    try:
        with db.begin_nested():
            p = UserLearningProgress(user_id=user_id, resource_id=rid, **values)
            db.add(p)
            db.flush()
        return p, True
    except IntegrityError:
        p = _progress(db, user_id, rid)
        if p is None:  # pragma: no cover - the conflicting row vanished again
            raise
        return p, False


def _detail(db, user_id: int, r: LearningResource) -> ResourceDetail:
    recs = _recs(db, user_id)
    rec = recs.get(r.id)
    return ResourceDetail(
        **_out(r, _progress(db, user_id, r.id), rec is not None),
        content=r.content,
        url=r.url,
        reason=rec_service.localized_reason(rec) if rec else None,
    )


@router.get("/resources/{resource_id}", response_model=ResourceDetail, summary="Resource content and progress")
def get_resource(resource_id: int, user: CurrentUser, db: DB) -> ResourceDetail:
    r = _get_for(db, user, resource_id, read_only=True)
    p = _progress(db, user.id, r.id)
    if p is not None:
        p.last_accessed_at = utcnow()
        db.commit()
    return _detail(db, user.id, r)


@router.post("/resources/{resource_id}/start", response_model=ResourceDetail, summary="Start (or continue)")
def start(resource_id: int, user: CurrentUser, db: DB) -> ResourceDetail:
    r = _get_for(db, user, resource_id)
    now = utcnow()
    p, created = _ensure_progress(
        db, user.id, r.id, status=ProgressStatus.IN_PROGRESS, progress_pct=0, started_at=now
    )
    if created:
        audit(db, user.id, "learning.started", "learning_resource", r.id)
    p.last_accessed_at = now
    rec_service.on_resource_started(db, user.id, r.id)
    db.commit()
    return _detail(db, user.id, r)


@router.put("/resources/{resource_id}/progress", response_model=ResourceDetail, summary="Update reading progress")
def update_progress(resource_id: int, body: ProgressIn, user: CurrentUser, db: DB) -> ResourceDetail:
    r = _get_for(db, user, resource_id)
    now = utcnow()
    p, _ = _ensure_progress(db, user.id, r.id, status=ProgressStatus.IN_PROGRESS, progress_pct=0, started_at=now)
    if p.status != ProgressStatus.COMPLETED:
        p.progress_pct = max(p.progress_pct, body.progress_pct)
    p.last_accessed_at = now
    db.commit()
    return _detail(db, user.id, r)


@router.post("/resources/{resource_id}/complete", response_model=ResourceDetail, summary="Mark as completed")
def complete(resource_id: int, user: CurrentUser, db: DB) -> ResourceDetail:
    r = _get_for(db, user, resource_id)
    now = utcnow()
    p, _ = _ensure_progress(db, user.id, r.id, started_at=now, status=ProgressStatus.IN_PROGRESS, progress_pct=0)
    if p.status != ProgressStatus.COMPLETED or p.completed_at is None:
        p.status, p.progress_pct, p.completed_at = ProgressStatus.COMPLETED, 100, now
        audit(db, user.id, "learning.completed", "learning_resource", r.id)
    p.last_accessed_at = now
    rec_service.on_resource_completed(db, user.id, r.id, now)
    db.commit()
    return _detail(db, user.id, r)
