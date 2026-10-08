from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, utcnow
from app.models.enums import (
    ActivityKind,
    ActivityStatus,
    Difficulty,
    PracticeStatus,
    ProgressStatus,
    RecommendationStatus,
    ResourceType,
    db_enum,
)


class LearningResource(TimestampMixin, Base):
    __tablename__ = "learning_resources"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    competency_id: Mapped[int] = mapped_column(ForeignKey("competencies.id", ondelete="RESTRICT"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    type: Mapped[ResourceType] = mapped_column(db_enum(ResourceType, "resource_type"))
    difficulty: Mapped[Difficulty] = mapped_column(db_enum(Difficulty, "difficulty"))
    duration_minutes: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(String(500))
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)

    competency = relationship("Competency")


class PracticalTask(TimestampMixin, Base):
    __tablename__ = "practical_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    competency_id: Mapped[int] = mapped_column(ForeignKey("competencies.id", ondelete="RESTRICT"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    instructions: Mapped[str] = mapped_column(Text)
    difficulty: Mapped[Difficulty] = mapped_column(db_enum(Difficulty, "difficulty"))
    duration_minutes: Mapped[int] = mapped_column(Integer)
    rubric: Mapped[list] = mapped_column(JSON)
    min_length: Mapped[int] = mapped_column(Integer, default=80)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)

    competency = relationship("Competency")


class PracticeSubmission(TimestampMixin, Base):
    __tablename__ = "practice_submissions"
    __table_args__ = (UniqueConstraint("user_id", "task_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("practical_tasks.id", ondelete="CASCADE"), index=True)
    status: Mapped[PracticeStatus] = mapped_column(db_enum(PracticeStatus, "practice_status"))
    response_text: Mapped[str | None] = mapped_column(Text)
    feedback_score: Mapped[int | None] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    task: Mapped[PracticalTask] = relationship()


class UserLearningProgress(TimestampMixin, Base):
    __tablename__ = "user_learning_progress"
    __table_args__ = (
        UniqueConstraint("user_id", "resource_id"),
        CheckConstraint("progress_pct >= 0 AND progress_pct <= 100", name="pct_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    resource_id: Mapped[int] = mapped_column(ForeignKey("learning_resources.id", ondelete="CASCADE"), index=True)
    status: Mapped[ProgressStatus] = mapped_column(db_enum(ProgressStatus, "progress_status"))
    progress_pct: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    resource: Mapped[LearningResource] = relationship()


class Recommendation(Base):
    """Output of the recommendation engine, traceable to gap, competency, goal and resource/task."""

    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("assessment_attempts.id", ondelete="CASCADE"), index=True)
    gap_id: Mapped[int] = mapped_column(ForeignKey("competency_gaps.id", ondelete="CASCADE"))
    competency_id: Mapped[int] = mapped_column(ForeignKey("competencies.id", ondelete="CASCADE"), index=True)
    goal_id: Mapped[int | None] = mapped_column(ForeignKey("goal_definitions.id", ondelete="SET NULL"))
    resource_id: Mapped[int | None] = mapped_column(ForeignKey("learning_resources.id", ondelete="SET NULL"))
    task_id: Mapped[int | None] = mapped_column(ForeignKey("practical_tasks.id", ondelete="SET NULL"))
    priority: Mapped[int] = mapped_column(Integer)
    priority_score: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[RecommendationStatus] = mapped_column(
        db_enum(RecommendationStatus, "recommendation_status"), default=RecommendationStatus.ACTIVE, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    competency = relationship("Competency")
    gap = relationship("CompetencyGap")
    goal = relationship("GoalDefinition")
    resource: Mapped[LearningResource | None] = relationship()
    task: Mapped[PracticalTask | None] = relationship()
    activities: Mapped[list[LearningActivity]] = relationship(
        back_populates="recommendation", order_by="LearningActivity.sort_order", cascade="all, delete-orphan"
    )


class LearningActivity(Base):
    """One step of the development plan: Learn → Practice → Reflect → Reassess."""

    __tablename__ = "learning_activities"
    __table_args__ = (UniqueConstraint("recommendation_id", "kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    recommendation_id: Mapped[int] = mapped_column(ForeignKey("recommendations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[ActivityKind] = mapped_column(db_enum(ActivityKind, "activity_kind"))
    sort_order: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    resource_id: Mapped[int | None] = mapped_column(ForeignKey("learning_resources.id", ondelete="SET NULL"))
    task_id: Mapped[int | None] = mapped_column(ForeignKey("practical_tasks.id", ondelete="SET NULL"))
    prompt: Mapped[str | None] = mapped_column(Text)
    response_text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ActivityStatus] = mapped_column(
        db_enum(ActivityStatus, "activity_status"), default=ActivityStatus.TODO
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    recommendation: Mapped[Recommendation] = relationship(back_populates="activities")
