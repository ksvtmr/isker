from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.models.enums import GapBand
from app.schemas.common import ORM


class AreaOut(ORM):
    code: str
    name: str
    color_token: str


class CompetencyOut(ORM):
    id: int
    code: str
    name: str
    short_name: str
    description: str
    hint: str | None = None
    importance: float
    default_target: int
    area: AreaOut


class LevelOut(ORM):
    rank: int
    name: str
    min_score: int
    max_score: int
    description: str


class CompetencyCatalog(BaseModel):
    areas: list[AreaOut]
    competencies: list[CompetencyOut]
    levels: list[LevelOut]


class CompetencyScoreOut(BaseModel):
    """A competency in the user's current profile (latest measurement)."""

    competency_id: int
    code: str
    name: str
    short_name: str
    area_code: str
    area_name: str
    description: str
    score: int | None
    level: str | None
    target: int
    gap: int | None
    gap_band: GapBand | None
    priority_label: str | None = None
    priority_rank: int | None = None
    confidence: float | None = None
    explanation: str | None = None
    assessed_at: datetime | None = None
    change: int | None = None


class EvidenceOut(BaseModel):
    source: str
    question: str
    excerpt: str
    tag: str
    positive: bool


class CriterionOut(BaseModel):
    criterion: str
    score: int


class HistoryPoint(BaseModel):
    attempt_id: int
    label: str
    date: datetime
    score: int


class AIExplanationOut(BaseModel):
    evaluation_id: int
    confidence: float | None
    provider: str
    model: str
    prompt_version: int | None
    strengths: list[str]
    development_areas: list[str]
    explanation: str | None


class RecommendedItem(BaseModel):
    id: int
    kind: str  # resource | task
    title: str
    type: str
    duration_minutes: int
    difficulty: str
    status: str | None = None


class CompetencyDetail(BaseModel):
    competency: CompetencyOut
    current: CompetencyScoreOut
    method_scores: dict[str, float | None]
    explanation: str | None
    evidence: list[EvidenceOut]
    criteria: list[CriterionOut]
    ai: list[AIExplanationOut]
    history: list[HistoryPoint]
    resources: list[RecommendedItem]
    tasks: list[RecommendedItem]
    recommendation_id: int | None
    reassess_question_count: int
