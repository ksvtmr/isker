from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import joinedload

from app.api.deps import DB, CurrentUser
from app.core.database import utcnow
from app.core.errors import NotFoundError
from app.models import Competency, LearningResource, Recommendation, UserLearningProgress
from app.models.enums import Difficulty, ProgressStatus, RecommendationStatus, ResourceType
from app.schemas.common import ERROR_RESPONSES, Page
from app.schemas.learning import ProgressIn, ResourceDetail, ResourceOut
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
    stmt = select(LearningResource).join(Competency).where(LearningResource.is_published.is_(True))
    if competency:
        stmt = stmt.where(Competency.code == competency)
    if type:
        stmt = stmt.where(LearningResource.type == type)
    if difficulty:
        stmt = stmt.where(LearningResource.difficulty == difficulty)
    if max_minutes:
        stmt = stmt.where(LearningResource.duration_minutes <= max_minutes)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(LearningResource.title.ilike(like), LearningResource.description.ilike(like)))
    progress = {
        p.resource_id: p
        for p in db.scalars(select(UserLearningProgress).where(UserLearningProgress.user_id == user.id))
    }
    recs = _recs(db, user.id)
    rows = list(db.scalars(stmt.options(joinedload(LearningResource.competency))))
    if status:
        rows = [
            r for r in rows if (progress[r.id].status if r.id in progress else ProgressStatus.NOT_STARTED) == status
        ]
    rows.sort(key=lambda r: (r.id not in recs, r.competency.sort_order, r.id))
    total = len(rows)
    rows = rows[(page - 1) * page_size : page * page_size]
    return Page[ResourceOut](
        items=[ResourceOut(**_out(r, progress.get(r.id), r.id in recs)) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


def _get(db, rid: int) -> LearningResource:
    r = db.scalar(
        select(LearningResource)
        .where(LearningResource.id == rid, LearningResource.is_published.is_(True))
        .options(joinedload(LearningResource.competency))
    )
    if r is None:
        raise NotFoundError("Learning resource not found", "RESOURCE_NOT_FOUND")
    return r


def _progress(db, user_id: int, rid: int) -> UserLearningProgress | None:
    return db.scalar(
        select(UserLearningProgress).where(
            UserLearningProgress.user_id == user_id, UserLearningProgress.resource_id == rid
        )
    )


def _detail(db, user_id: int, r: LearningResource) -> ResourceDetail:
    recs = _recs(db, user_id)
    rec = recs.get(r.id)
    return ResourceDetail(
        **_out(r, _progress(db, user_id, r.id), rec is not None),
        content=r.content,
        url=r.url,
        reason=rec.reason if rec else None,
    )


@router.get("/resources/{resource_id}", response_model=ResourceDetail, summary="Resource content and progress")
def get_resource(resource_id: int, user: CurrentUser, db: DB) -> ResourceDetail:
    r = _get(db, resource_id)
    p = _progress(db, user.id, r.id)
    if p is not None:
        p.last_accessed_at = utcnow()
        db.commit()
    return _detail(db, user.id, r)


@router.post("/resources/{resource_id}/start", response_model=ResourceDetail, summary="Start (or continue)")
def start(resource_id: int, user: CurrentUser, db: DB) -> ResourceDetail:
    r = _get(db, resource_id)
    p = _progress(db, user.id, r.id)
    now = utcnow()
    if p is None:
        p = UserLearningProgress(
            user_id=user.id, resource_id=r.id, status=ProgressStatus.IN_PROGRESS, progress_pct=0, started_at=now
        )
        db.add(p)
        audit(db, user.id, "learning.started", "learning_resource", r.id)
    p.last_accessed_at = now
    rec_service.on_resource_started(db, user.id, r.id)
    db.commit()
    return _detail(db, user.id, r)


@router.put("/resources/{resource_id}/progress", response_model=ResourceDetail, summary="Update reading progress")
def update_progress(resource_id: int, body: ProgressIn, user: CurrentUser, db: DB) -> ResourceDetail:
    r = _get(db, resource_id)
    p = _progress(db, user.id, r.id)
    now = utcnow()
    if p is None:
        p = UserLearningProgress(
            user_id=user.id, resource_id=r.id, status=ProgressStatus.IN_PROGRESS, progress_pct=0, started_at=now
        )
        db.add(p)
    if p.status != ProgressStatus.COMPLETED:
        p.progress_pct = max(p.progress_pct, body.progress_pct)
    p.last_accessed_at = now
    db.commit()
    return _detail(db, user.id, r)


@router.post("/resources/{resource_id}/complete", response_model=ResourceDetail, summary="Mark as completed")
def complete(resource_id: int, user: CurrentUser, db: DB) -> ResourceDetail:
    r = _get(db, resource_id)
    p = _progress(db, user.id, r.id)
    now = utcnow()
    if p is None:
        p = UserLearningProgress(user_id=user.id, resource_id=r.id, started_at=now, status=ProgressStatus.COMPLETED)
        db.add(p)
    if p.status != ProgressStatus.COMPLETED or p.completed_at is None:
        p.status, p.progress_pct, p.completed_at = ProgressStatus.COMPLETED, 100, now
        audit(db, user.id, "learning.completed", "learning_resource", r.id)
    p.last_accessed_at = now
    rec_service.on_resource_completed(db, user.id, r.id, now)
    db.commit()
    return _detail(db, user.id, r)
