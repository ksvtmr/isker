from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import Difficulty, PracticeStatus, ProgressStatus, ResourceType


class ResourceOut(BaseModel):
    id: int
    slug: str
    title: str
    description: str
    type: ResourceType
    difficulty: Difficulty
    duration_minutes: int
    competency_id: int
    competency_code: str
    competency_name: str
    status: ProgressStatus
    progress_pct: int
    recommended: bool
    started_at: datetime | None
    completed_at: datetime | None


class ResourceDetail(ResourceOut):
    content: str
    url: str | None
    reason: str | None


class ProgressIn(BaseModel):
    progress_pct: int = Field(ge=0, le=100)


class TaskOut(BaseModel):
    id: int
    slug: str
    title: str
    description: str
    difficulty: Difficulty
    duration_minutes: int
    competency_id: int
    competency_code: str
    competency_name: str
    status: PracticeStatus | None
    recommended: bool
    feedback_score: int | None


class FeedbackOut(BaseModel):
    evaluation_id: int
    score: int
    level: str
    confidence: float | None
    criteria: list[dict]
    evidence: list[str]
    strengths: list[str]
    development_areas: list[str]
    explanation: str | None
    provider: str
    created_at: datetime


class TaskDetail(TaskOut):
    instructions: str
    rubric: list[dict]
    min_length: int
    response_text: str | None
    started_at: datetime | None
    submitted_at: datetime | None
    completed_at: datetime | None
    feedback: FeedbackOut | None
    reason: str | None


class SubmitIn(BaseModel):
    response_text: str = Field(min_length=1, max_length=6000)
