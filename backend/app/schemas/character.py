from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class StageBand(BaseModel):
    stage: int
    key: str
    min: int
    max: int


class StageEventOut(BaseModel):
    id: int
    sequence: int
    stage: int
    previous_stage: int | None
    direction: str
    score: int
    assessment_score: int
    practice_score: int | None
    practice_tasks: int
    trigger: str
    attempt_id: int | None
    rules_version: str
    confirmed_at: datetime
    seen: bool


class CharacterBasis(BaseModel):
    competencies_assessed: int
    competencies_total: int
    competencies_with_evidence: int
    practice_weight: float
    practice_min_tasks: int
    attempt_id: int | None


class CharacterOut(BaseModel):
    """The learner's character stage. `stage` is the last confirmed stage (from the history); `score` and the progress
    fields are the current value of the stage rule, so progress inside a stage shows before the next stage is
    reached. Read-only: no request can set a stage."""

    status: str  # no_assessment | insufficient_data | ready
    stage: int | None
    stage_key: str | None
    score: int | None
    assessment_score: int | None
    practice_score: int | None
    practice_tasks: int
    practice_counted: bool
    progress_pct: int | None
    next_stage: int | None
    points_to_next: int | None
    rules_version: str
    bands: list[StageBand]
    basis: CharacterBasis
    pending_event: StageEventOut | None
    history: list[StageEventOut]
