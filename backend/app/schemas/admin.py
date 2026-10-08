from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.models.enums import AIEvalStatus, AIInputType, Difficulty, QuestionType, ResourceType, UserRole
from app.schemas.common import ORM


class AdminStats(BaseModel):
    users: int
    onboarded_users: int
    completed_attempts: int
    in_progress_attempts: int
    average_overall: float | None
    ai_evaluations: int
    ai_fallbacks: int
    resources_completed: int
    tasks_completed: int
    competency_averages: list[dict]


class AdminUserOut(ORM):
    id: int
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    onboarding_completed: bool
    created_at: datetime
    last_login_at: datetime | None
    completed_attempts: int = 0
    latest_overall: int | None = None


class CompetencyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    short_name: str | None = Field(default=None, min_length=2, max_length=40)
    description: str | None = Field(default=None, min_length=10)
    hint: str | None = None
    reflection_prompt: str | None = None
    importance: float | None = Field(default=None, ge=0, le=1)
    learning_priority: float | None = Field(default=None, ge=0, le=1)
    default_target: int | None = Field(default=None, ge=40, le=100)


class OptionIn(BaseModel):
    label: str = Field(min_length=1, max_length=500)
    score: int = Field(ge=0, le=100)
    value: int | None = None


class CompetencyLinkIn(BaseModel):
    competency_id: int
    weight: float = Field(gt=0, le=1)


class RubricIn(BaseModel):
    criterion: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=2, max_length=500)
    competency: str | None = None
    keywords: list[str] = Field(default_factory=list)


class QuestionIn(BaseModel):
    assessment_id: int
    type: QuestionType
    section: str = Field(min_length=2, max_length=64)
    text: str = Field(min_length=10, max_length=2000)
    help_text: str | None = Field(default=None, max_length=1000)
    sort_order: int | None = None
    reverse_scored: bool = False
    min_length: int = Field(default=0, ge=0, le=2000)
    is_active: bool = True
    options: list[OptionIn] = Field(default_factory=list)
    competencies: list[CompetencyLinkIn] = Field(min_length=1)
    rubric: list[RubricIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _shape(self) -> QuestionIn:
        if self.type in (QuestionType.LIKERT, QuestionType.SITUATIONAL) and len(self.options) < 2:
            raise ValueError("Choice questions need at least two options")
        if self.type in (QuestionType.OPEN, QuestionType.PRACTICAL) and not self.rubric:
            raise ValueError("Open and practical questions need a scoring rubric")
        return self


class QuestionAdminOut(BaseModel):
    id: int
    assessment_id: int
    sort_order: int
    type: QuestionType
    section: str
    text: str
    help_text: str | None
    reverse_scored: bool
    min_length: int
    is_active: bool
    options: list[dict]
    competencies: list[dict]
    rubric: list[dict]
    answer_count: int


class AssessmentIn(BaseModel):
    code: str = Field(min_length=2, max_length=48, pattern=r"^[a-z0-9_-]+$")
    title: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=10)
    estimated_minutes: int = Field(ge=1, le=240)
    is_active: bool = True


class AssessmentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=160)
    description: str | None = Field(default=None, min_length=10)
    estimated_minutes: int | None = Field(default=None, ge=1, le=240)
    is_active: bool | None = None


class AssessmentAdminOut(ORM):
    id: int
    code: str
    title: str
    description: str
    estimated_minutes: int
    version: int
    is_active: bool
    question_count: int = 0
    attempt_count: int = 0


class ResourceIn(BaseModel):
    slug: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9-]+$")
    competency_id: int
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10)
    type: ResourceType
    difficulty: Difficulty
    duration_minutes: int = Field(ge=1, le=600)
    content: str = Field(min_length=20)
    url: str | None = Field(default=None, max_length=500, pattern=r"^https?://")
    is_published: bool = True


class ResourceAdminOut(ORM):
    id: int
    slug: str
    competency_id: int
    title: str
    description: str
    type: ResourceType
    difficulty: Difficulty
    duration_minutes: int
    content: str
    url: str | None
    is_published: bool


class TaskIn(BaseModel):
    slug: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9-]+$")
    competency_id: int
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10)
    instructions: str = Field(min_length=10)
    difficulty: Difficulty
    duration_minutes: int = Field(ge=1, le=600)
    rubric: list[RubricIn] = Field(min_length=1)
    min_length: int = Field(default=80, ge=0, le=2000)
    is_published: bool = True


class TaskAdminOut(ORM):
    id: int
    slug: str
    competency_id: int
    title: str
    description: str
    instructions: str
    difficulty: Difficulty
    duration_minutes: int
    rubric: list[dict]
    min_length: int
    is_published: bool


class AIEvaluationAdminOut(ORM):
    id: int
    user_id: int | None
    input_type: AIInputType
    provider: str
    model: str
    status: AIEvalStatus
    competency_id: int | None
    prompt_version_id: int | None
    score: int | None
    level: str | None
    confidence: float | None
    attempts: int
    latency_ms: int | None
    error: str | None
    input_excerpt: str | None
    output: dict | None
    created_at: datetime


class PromptIn(BaseModel):
    key: str = Field(pattern=r"^(answer_evaluation|profile_insight)$")
    system_prompt: str = Field(min_length=20)
    user_template: str = Field(min_length=10)
    notes: str | None = None
    activate: bool = False


class PromptOut(ORM):
    id: int
    key: str
    version: int
    system_prompt: str
    user_template: str
    notes: str | None
    is_active: bool
    created_at: datetime
