"""Strict schemas for AI output. Anything the model returns is validated against these."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class CriterionRating(BaseModel):
    model_config = ConfigDict(extra="ignore")

    criterion: str = Field(min_length=1, max_length=200)
    rating: int = Field(ge=0, le=4, description="0 = absent … 4 = excellent, per rubric")
    evidence: str = Field(default="", max_length=600)


class EvaluationOutput(BaseModel):
    """Structured evaluation of an open answer / practical submission against a rubric.

    The final score is NOT taken from `score`: the scoring engine recomputes it from the
    rubric `criteria` ratings so the model cannot set an unconstrained score.
    """

    model_config = ConfigDict(extra="ignore")

    competency: str = Field(min_length=1, max_length=120)
    score: int = Field(ge=0, le=100)
    level: str = Field(default="", max_length=32)
    confidence: float = Field(ge=0, le=1)
    criteria: list[CriterionRating] = Field(min_length=1, max_length=12)
    evidence: list[str] = Field(default_factory=list, max_length=8)
    strengths: list[str] = Field(default_factory=list, max_length=8)
    development_areas: list[str] = Field(default_factory=list, max_length=8)
    explanation: str = Field(default="", max_length=1200)


class InsightOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    headline: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=800)
    next_step: str = Field(min_length=1, max_length=300)
    confidence: float = Field(ge=0, le=1)


class RubricCriterion(BaseModel):
    """Rubric criterion definition stored on questions/tasks."""

    criterion: str
    description: str
    competency: str | None = None
    keywords: list[str] = Field(default_factory=list)
