from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.models.enums import AttemptScope, AttemptStatus, QuestionType


class SectionOut(BaseModel):
    name: str
    count: int


class AssessmentOut(BaseModel):
    id: int
    title: str
    description: str
    estimated_minutes: int
    question_count: int
    sections: list[SectionOut]


class CompetencyRef(BaseModel):
    id: int
    code: str
    name: str


class AttemptSummary(BaseModel):
    id: int
    scope: AttemptScope
    competency: CompetencyRef | None
    status: AttemptStatus
    current_index: int
    answered: int
    total: int
    sequence: int
    overall_score: int | None
    started_at: datetime
    completed_at: datetime | None


class AssessmentOverview(BaseModel):
    assessment: AssessmentOut
    in_progress: AttemptSummary | None
    completed: list[AttemptSummary]


class OptionOut(BaseModel):
    id: int
    label: str


class QuestionOut(BaseModel):
    """Question as shown to the learner. Never reveals which competency it measures (FR-14)."""

    id: int
    index: int
    type: QuestionType
    section: str
    text: str
    help_text: str | None
    min_length: int
    options: list[OptionOut]


class AnswerOut(BaseModel):
    question_id: int
    option_id: int | None
    text_response: str | None
    updated_at: datetime


class AttemptState(BaseModel):
    attempt: AttemptSummary
    questions: list[QuestionOut]
    answers: list[AnswerOut]


class StartAttemptIn(BaseModel):
    scope: AttemptScope = AttemptScope.FULL
    competency_id: int | None = None


class StartAttemptOut(BaseModel):
    attempt: AttemptSummary
    resumed: bool


class AnswerIn(BaseModel):
    option_id: int | None = None
    text_response: str | None = Field(default=None, max_length=4000)
    position: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _one(self) -> AnswerIn:
        if self.option_id is None and self.text_response is None:
            raise ValueError("Provide option_id or text_response")
        return self


class PositionIn(BaseModel):
    position: int = Field(ge=0)
