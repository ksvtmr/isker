from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, utcnow
from app.models.enums import AccountStatus, ExperienceLevel, LearningFormat, db_enum


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(120))
    status: Mapped[AccountStatus] = mapped_column(
        db_enum(AccountStatus, "account_status"), default=AccountStatus.ACTIVE, index=True
    )
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    terms_version: Mapped[str | None] = mapped_column(String(16))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status_reason: Mapped[str | None] = mapped_column(String(500))
    deletion_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    profile: Mapped[UserProfile | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    goals: Mapped[list[UserGoal]] = relationship(back_populates="user", cascade="all, delete-orphan")
    role_links = relationship(
        "UserRole", foreign_keys="UserRole.user_id", cascade="all, delete-orphan", back_populates="user"
    )

    @property
    def is_active(self) -> bool:
        return self.status == AccountStatus.ACTIVE

    @property
    def role_keys(self) -> list[str]:
        return sorted(link.role.key for link in self.role_links)


class UserProfile(TimestampMixin, Base):
    __tablename__ = "user_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    education: Mapped[str | None] = mapped_column(String(120))
    background: Mapped[str | None] = mapped_column(Text)
    entrepreneurial_experience: Mapped[ExperienceLevel] = mapped_column(
        db_enum(ExperienceLevel, "experience_level"), default=ExperienceLevel.NONE
    )
    business_experience: Mapped[str | None] = mapped_column(Text)
    preferred_learning_format: Mapped[LearningFormat] = mapped_column(
        db_enum(LearningFormat, "learning_format"), default=LearningFormat.MIXED
    )
    weekly_learning_minutes: Mapped[int] = mapped_column(Integer, default=60)
    language: Mapped[str] = mapped_column(String(8), default="en")
    notify_reassessment: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_weekly_summary: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User] = relationship(back_populates="profile")


class GoalDefinition(Base):
    """Catalogue of entrepreneurial goals a user can pick. Goals change gap priorities."""

    __tablename__ = "goal_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(48), unique=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    competency_weights: Mapped[list[GoalCompetencyWeight]] = relationship(
        back_populates="goal", cascade="all, delete-orphan"
    )


class GoalCompetencyWeight(Base):
    """How relevant a competency is to a goal (0..1). Used in gap prioritisation."""

    __tablename__ = "goal_competency_weights"
    __table_args__ = (UniqueConstraint("goal_id", "competency_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goal_definitions.id", ondelete="CASCADE"), index=True)
    competency_id: Mapped[int] = mapped_column(ForeignKey("competencies.id", ondelete="CASCADE"), index=True)
    weight: Mapped[float] = mapped_column(Float)

    goal: Mapped[GoalDefinition] = relationship(back_populates="competency_weights")


class UserGoal(Base):
    __tablename__ = "user_goals"
    __table_args__ = (UniqueConstraint("user_id", "goal_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goal_definitions.id", ondelete="RESTRICT"))
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="goals")
    goal: Mapped[GoalDefinition] = relationship()
