"""String enums shared by models and schemas. Stored as VARCHAR + CHECK constraint (portable)."""

from __future__ import annotations

from enum import StrEnum

from sqlalchemy import Enum as SAEnum


def db_enum(enum_cls: type[StrEnum], name: str) -> SAEnum:
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=32,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )


class AccountStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"  # blocked by staff; reversible
    DEACTIVATED = "deactivated"  # closed by the user or staff; eligible for controlled deletion


class SubscriptionStatus(StrEnum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    EXPIRED = "expired"
    INCOMPLETE = "incomplete"


class BillingInterval(StrEnum):
    NONE = "none"
    MONTH = "month"
    YEAR = "year"


class SubscriptionSource(StrEnum):
    SYSTEM = "system"
    ADMIN = "admin"
    PAYMENT = "payment"
    TRIAL = "trial"


class AuditOutcome(StrEnum):
    SUCCESS = "success"
    FAILURE = "failure"
    DENIED = "denied"


class LearningFormat(StrEnum):
    ARTICLE = "article"
    VIDEO = "video"
    COURSE = "course"
    MIXED = "mixed"


class ExperienceLevel(StrEnum):
    NONE = "none"
    SIDE_PROJECT = "side_project"
    STARTUP_TEAM = "startup_team"
    RUNNING_BUSINESS = "running_business"


class QuestionType(StrEnum):
    LIKERT = "likert"
    SITUATIONAL = "situational"
    OPEN = "open"
    PRACTICAL = "practical"


class AssessmentKind(StrEnum):
    FULL = "full"


class AttemptScope(StrEnum):
    FULL = "full"
    COMPETENCY = "competency"


class AttemptStatus(StrEnum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


class GapBand(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AIInputType(StrEnum):
    OPEN_ANSWER = "open_answer"
    PRACTICAL_ANSWER = "practical_answer"
    PRACTICE_SUBMISSION = "practice_submission"
    PROFILE_INSIGHT = "profile_insight"


class AIEvalStatus(StrEnum):
    SUCCESS = "success"
    RETRIED = "retried"
    FALLBACK = "fallback"


class ResourceType(StrEnum):
    ARTICLE = "article"
    VIDEO = "video"
    COURSE = "course"
    EXERCISE = "exercise"
    CASE_STUDY = "case_study"
    TEMPLATE = "template"


class Difficulty(StrEnum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class ProgressStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class PracticeStatus(StrEnum):
    STARTED = "started"
    SUBMITTED = "submitted"
    COMPLETED = "completed"


class RecommendationStatus(StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"
    SUPERSEDED = "superseded"


class ActivityKind(StrEnum):
    LEARN = "learn"
    PRACTICE = "practice"
    REFLECT = "reflect"
    REASSESS = "reassess"


class ActivityStatus(StrEnum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class ContentStatus(StrEnum):
    """Lifecycle of editable content. Only `published` content is visible on the learner platform."""

    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"
