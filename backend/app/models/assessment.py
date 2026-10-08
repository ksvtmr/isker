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
from app.models.enums import AssessmentKind, AttemptScope, AttemptStatus, QuestionType, db_enum


class Assessment(TimestampMixin, Base):
    __tablename__ = "assessments"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(48), unique=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text)
    kind: Mapped[AssessmentKind] = mapped_column(db_enum(AssessmentKind, "assessment_kind"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    estimated_minutes: Mapped[int] = mapped_column(Integer, default=25)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    questions: Mapped[list[Question]] = relationship(
        back_populates="assessment", order_by="Question.sort_order", cascade="all, delete-orphan"
    )


class Question(TimestampMixin, Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer)
    type: Mapped[QuestionType] = mapped_column(db_enum(QuestionType, "question_type"))
    section: Mapped[str] = mapped_column(String(64))
    text: Mapped[str] = mapped_column(Text)
    help_text: Mapped[str | None] = mapped_column(Text)
    # Rubric used to score open/practical answers (criteria are scored 0–4 each).
    rubric: Mapped[list | None] = mapped_column(JSON)
    reverse_scored: Mapped[bool] = mapped_column(Boolean, default=False)
    min_length: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    assessment: Mapped[Assessment] = relationship(back_populates="questions")
    options: Mapped[list[QuestionOption]] = relationship(
        back_populates="question", order_by="QuestionOption.sort_order", cascade="all, delete-orphan"
    )
    competency_links: Mapped[list[QuestionCompetency]] = relationship(
        back_populates="question", cascade="all, delete-orphan"
    )


class QuestionOption(Base):
    __tablename__ = "question_options"
    __table_args__ = (CheckConstraint("score >= 0 AND score <= 100", name="score_range"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(Text)
    # Situational options: rubric-based score 0..100. Likert options: (value-1)/4*100.
    score: Mapped[int] = mapped_column(Integer)
    value: Mapped[int | None] = mapped_column(Integer)

    question: Mapped[Question] = relationship(back_populates="options")


class QuestionCompetency(Base):
    """Maps a question to one or more competencies with a weight."""

    __tablename__ = "question_competencies"
    __table_args__ = (
        UniqueConstraint("question_id", "competency_id"),
        CheckConstraint("weight > 0 AND weight <= 1", name="weight_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    competency_id: Mapped[int] = mapped_column(ForeignKey("competencies.id", ondelete="CASCADE"), index=True)
    weight: Mapped[float] = mapped_column(Float, default=1.0)

    question: Mapped[Question] = relationship(back_populates="competency_links")
    competency = relationship("Competency")


class AssessmentAttempt(TimestampMixin, Base):
    __tablename__ = "assessment_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id", ondelete="RESTRICT"), index=True)
    scope: Mapped[AttemptScope] = mapped_column(db_enum(AttemptScope, "attempt_scope"), default=AttemptScope.FULL)
    scope_competency_id: Mapped[int | None] = mapped_column(ForeignKey("competencies.id", ondelete="SET NULL"))
    status: Mapped[AttemptStatus] = mapped_column(
        db_enum(AttemptStatus, "attempt_status"), default=AttemptStatus.IN_PROGRESS, index=True
    )
    current_index: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    overall_score: Mapped[int | None] = mapped_column(Integer)
    sequence: Mapped[int] = mapped_column(Integer, default=1)

    assessment: Mapped[Assessment] = relationship()
    scope_competency = relationship("Competency")
    answers: Mapped[list[Answer]] = relationship(back_populates="attempt", cascade="all, delete-orphan")


class Answer(TimestampMixin, Base):
    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("attempt_id", "question_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("assessment_attempts.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    option_id: Mapped[int | None] = mapped_column(ForeignKey("question_options.id", ondelete="SET NULL"))
    text_response: Mapped[str | None] = mapped_column(Text)
    # Item score 0..100 after scoring (option score, or rubric-constrained AI score).
    item_score: Mapped[float | None] = mapped_column(Float)

    attempt: Mapped[AssessmentAttempt] = relationship(back_populates="answers")
    question: Mapped[Question] = relationship()
    option: Mapped[QuestionOption | None] = relationship()


class Reassessment(Base):
    """Links a reassessment attempt to the attempt it re-measures (history is never overwritten)."""

    __tablename__ = "reassessments"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("assessment_attempts.id", ondelete="CASCADE"), unique=True)
    previous_attempt_id: Mapped[int | None] = mapped_column(ForeignKey("assessment_attempts.id", ondelete="SET NULL"))
    competency_id: Mapped[int | None] = mapped_column(ForeignKey("competencies.id", ondelete="SET NULL"))
    reason: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    attempt: Mapped[AssessmentAttempt] = relationship(foreign_keys=[attempt_id])
