from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import ActivityKind, ActivityStatus, GapBand, RecommendationStatus
from app.schemas.assessment import AttemptSummary
from app.schemas.competency import CompetencyScoreOut


class InsightOut(BaseModel):
    headline: str
    body: str
    next_step: str
    confidence: float | None
    provider: str
    evaluation_id: int
    generated_at: datetime


class AreaScore(BaseModel):
    code: str
    name: str
    color_token: str
    score: int | None


class ProfileOverview(BaseModel):
    has_profile: bool
    overall: int | None
    level: str | None
    previous_overall: int | None
    change: int | None
    assessed_at: datetime | None
    attempt_id: int | None
    areas: list[AreaScore]
    competencies: list[CompetencyScoreOut]
    strengths: list[CompetencyScoreOut]
    priority_gaps: list[CompetencyScoreOut]
    insight: InsightOut | None


class AttemptResults(BaseModel):
    attempt: AttemptSummary
    profile: ProfileOverview
    measured: list[CompetencyScoreOut]


class GapOut(BaseModel):
    competency_id: int
    code: str
    name: str
    area_name: str
    current: int
    target: int
    gap: int
    band: GapBand
    priority_rank: int
    priority_label: str
    priority_score: float
    goal_relevance: float
    importance: float
    learning_priority: float


class ActivityOut(BaseModel):
    id: int
    kind: ActivityKind
    title: str
    status: ActivityStatus
    locked: bool
    resource_id: int | None
    task_id: int | None
    prompt: str | None
    response_text: str | None
    duration_minutes: int | None
    type: str | None
    completed_at: datetime | None


class RecommendationOut(BaseModel):
    id: int
    priority: int
    priority_score: float
    status: RecommendationStatus
    competency_id: int
    competency_code: str
    competency_name: str
    current: int
    target: int
    gap: int
    band: GapBand
    reason: str
    goal: str | None
    resource: dict | None
    task: dict | None
    activities: list[ActivityOut]
    progress_pct: int
    created_at: datetime


class PlanOut(BaseModel):
    recommendations: list[RecommendationOut]
    completed: list[RecommendationOut]
    done: int
    total: int
    progress_pct: int


class ReflectionIn(BaseModel):
    text: str = Field(min_length=10, max_length=2000)
