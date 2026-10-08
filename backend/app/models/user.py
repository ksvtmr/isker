from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, utcnow
from app.models.enums import ExperienceLevel, LearningFormat, UserRole, db_enum


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[UserRole] = mapped_column(db_enum(UserRole, "user_role"), default=UserRole.USER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    profile: Mapped[UserProfile | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    goals: Mapped[list[UserGoal]] = relationship(back_populates="user", cascade="all, delete-orphan")


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


class RevokedToken(Base):
    """JWT denylist so that logout invalidates the token server-side."""

    __tablename__ = "revoked_tokens"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
