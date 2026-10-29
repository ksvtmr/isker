from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DB, CurrentUser
from app.core.errors import NotFoundError
from app.models import CharacterStageEvent
from app.schemas.character import CharacterBasis, CharacterOut, StageBand, StageEventOut
from app.schemas.common import ERROR_RESPONSES, Message
from app.services import character as character_service

router = APIRouter(prefix="/api/character", tags=["progress"], responses=ERROR_RESPONSES)


def _event_out(ev: CharacterStageEvent) -> StageEventOut:
    return StageEventOut(
        id=ev.id, sequence=ev.sequence, stage=ev.stage, previous_stage=ev.previous_stage, direction=ev.direction,
        score=ev.score, assessment_score=ev.assessment_score, practice_score=ev.practice_score,
        practice_tasks=ev.practice_tasks, trigger=ev.trigger, attempt_id=ev.attempt_id,
        rules_version=ev.rules_version, confirmed_at=ev.confirmed_at, seen=ev.seen_at is not None,
    )


@router.get("", response_model=CharacterOut, summary="Character stage, the data it rests on, and its history")
def get_character(user: CurrentUser, db: DB) -> CharacterOut:
    result = character_service.get_character_stage(character_service.collect_progress(db, user.id))
    if character_service.ensure_baseline(db, user.id, result) is not None:
        db.commit()
    events = character_service.history(db, user.id)
    last = events[-1] if events else None
    stage = last.stage if last else None
    pct, nxt, to_next = result.progress_pct, result.next_stage, result.points_to_next
    if last is not None and result.score is not None and result.stage != last.stage:
        # The live rule disagrees with the last confirmed stage (content changed since, e.g. a competency was
        # unpublished): the confirmed stage is shown, progress is measured within it, and the stage itself only
        # changes with the next confirmed result.
        pct, nxt, to_next = character_service.progress_in_band(result.score, last.stage)
    pending = next((e for e in reversed(events) if e.seen_at is None and e.direction != "initial"), None)
    # Once a stage is confirmed it stays visible, even if the live rule has too little data (e.g. content changed).
    status = "ready" if last is not None else result.status
    basis = result.basis
    return CharacterOut(
        status=status,
        stage=stage,
        stage_key=character_service.STAGE_BANDS[stage - 1][1] if stage else None,
        score=result.score if result.score is not None else (last.score if last else None),
        assessment_score=result.assessment_score,
        practice_score=result.practice_score,
        practice_tasks=result.practice_tasks,
        practice_counted=result.practice_counted,
        progress_pct=pct if result.score is not None else None,
        next_stage=nxt if result.score is not None else None,
        points_to_next=to_next if result.score is not None else None,
        rules_version=character_service.RULES_VERSION,
        bands=[StageBand(stage=s, key=k, min=lo, max=hi) for s, k, lo, hi in character_service.STAGE_BANDS],
        basis=CharacterBasis(
            competencies_assessed=basis["competencies_assessed"], competencies_total=basis["competencies_total"],
            competencies_with_evidence=basis["competencies_with_evidence"], practice_weight=basis["practice_weight"],
            practice_min_tasks=basis["practice_min_tasks"], attempt_id=basis["attempt_id"],
        ),
        pending_event=_event_out(pending) if pending else None,
        history=[_event_out(e) for e in events],
    )


@router.post("/events/{event_id}/seen", response_model=Message, summary="Record that a stage change was shown")
def mark_seen(event_id: int, user: CurrentUser, db: DB) -> Message:
    if character_service.mark_seen(db, user.id, event_id) is None:
        raise NotFoundError("Stage event not found", "STAGE_EVENT_NOT_FOUND")
    db.commit()
    return Message(message="Stage change marked as shown.", code="STAGE_EVENT_SEEN")
