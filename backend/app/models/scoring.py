from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, utcnow
from app.models.enums import GapBand, db_enum


class CompetencyScore(Base):
    """Score of one competency in one attempt. Immutable history: never overwritten."""

    __tablename__ = "competency_scores"
    __table_args__ = (
        UniqueConstraint("attempt_id", "competency_id"),
        CheckConstraint("score >= 0 AND score <= 100", name="score_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("assessment_attempts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    competency_id: Mapped[int] = mapped_column(ForeignKey("competencies.id", ondelete="RESTRICT"), index=True)
    raw_score: Mapped[float] = mapped_column(Float)
    max_raw_score: Mapped[float] = mapped_column(Float)
    score: Mapped[int] = mapped_column(Integer)
    level_id: Mapped[int] = mapped_column(ForeignKey("competency_levels.id", ondelete="RESTRICT"))
    self_score: Mapped[float | None] = mapped_column(Float)
    situational_score: Mapped[float | None] = mapped_column(Float)
    open_score: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    explanation: Mapped[str] = mapped_column(Text)
    # Answers behind the score: [{"question_id", "answer_id", "type", "weight", "item_score"}] (no answer text).
    evidence: Mapped[list | None] = mapped_column(JSON)
    # How much evidence there is: "sufficient" | "limited" | "insufficient" (services/scoring.evidence_level).
    evidence_level: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    competency = relationship("Competency")
    level = relationship("CompetencyLevel")


class CompetencyGap(Base):
    """Gap analysis result per competency for a given attempt (stored, history preserved)."""

    __tablename__ = "competency_gaps"
    __table_args__ = (UniqueConstraint("attempt_id", "competency_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("assessment_attempts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    competency_id: Mapped[int] = mapped_column(ForeignKey("competencies.id", ondelete="RESTRICT"), index=True)
    current_score: Mapped[int] = mapped_column(Integer)
    target_score: Mapped[int] = mapped_column(Integer)
    gap: Mapped[int] = mapped_column(Integer)
    band: Mapped[GapBand] = mapped_column(db_enum(GapBand, "gap_band"))
    goal_relevance: Mapped[float] = mapped_column(Float)
    importance: Mapped[float] = mapped_column(Float)
    learning_priority: Mapped[float] = mapped_column(Float)
    priority_score: Mapped[float] = mapped_column(Float)
    priority_rank: Mapped[int] = mapped_column(Integer)
    priority_label: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    competency = relationship("Competency")
