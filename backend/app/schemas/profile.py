from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.enums import ExperienceLevel, LearningFormat
from app.schemas.common import ORM


class GoalOut(ORM):
    code: str
    title: str
    description: str | None = None


class ProfileOut(BaseModel):
    full_name: str
    email: str
    education: str | None
    background: str | None
    entrepreneurial_experience: ExperienceLevel
    business_experience: str | None
    preferred_learning_format: LearningFormat
    weekly_learning_minutes: int
    language: str
    notify_reassessment: bool
    notify_weekly_summary: bool
    goals: list[GoalOut]
    onboarding_completed: bool


class OnboardingIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    education: str = Field(min_length=1, max_length=120)
    background: str | None = Field(default=None, max_length=1000)
    entrepreneurial_experience: ExperienceLevel
    business_experience: str | None = Field(default=None, max_length=1000)
    goal_codes: list[str] = Field(min_length=1, max_length=6)
    preferred_learning_format: LearningFormat
    weekly_learning_minutes: int = Field(ge=15, le=600)


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    education: str | None = Field(default=None, max_length=120)
    background: str | None = Field(default=None, max_length=1000)
    entrepreneurial_experience: ExperienceLevel | None = None
    business_experience: str | None = Field(default=None, max_length=1000)
    goal_codes: list[str] | None = Field(default=None, max_length=6)
    preferred_learning_format: LearningFormat | None = None
    weekly_learning_minutes: int | None = Field(default=None, ge=15, le=600)
    language: str | None = Field(default=None, pattern="^(en|ru|kk)$")
    notify_reassessment: bool | None = None
    notify_weekly_summary: bool | None = None
