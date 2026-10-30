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

from app.core.database import Base, utcnow
from app.models.enums import AIEvalStatus, AIInputType, db_enum


class AIPromptVersion(Base):
    """Versioned prompt templates. Exactly one active version per key."""

    __tablename__ = "ai_prompt_versions"
    __table_args__ = (UniqueConstraint("key", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer)
    system_prompt: Mapped[str] = mapped_column(Text)
    user_template: Mapped[str] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AIAnalysis(Base):
    """AI development analysis of one completed attempt (app/ai/analysis.py): one row per attempt, so retries update
    it instead of adding results. `output` is the validated DevelopmentAnalysis; it never changes scores.
    status: pending (queued) → processing → completed | failed."""

    __tablename__ = "ai_analyses"
    __table_args__ = (
        UniqueConstraint("attempt_id"),
        CheckConstraint("status IN ('pending', 'processing', 'completed', 'failed')", name="status_valid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("assessment_attempts.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(16), index=True)
    language: Mapped[str] = mapped_column(String(8))
    provider: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(64))
    prompt_version_id: Mapped[int | None] = mapped_column(ForeignKey("ai_prompt_versions.id", ondelete="SET NULL"))
    output: Mapped[dict | None] = mapped_column(JSON)
    # Stable code for the last failure (provider_unavailable, rate_limited, invalid_output, wrong_language); the
    # detail stays in the server log without request data.
    error_code: Mapped[str | None] = mapped_column(String(32))
    runs: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    # Tokens reported by the provider for the last run (all tries); NULL for the rule-based provider.
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    # sha256 of facts + prompt + provider + model of the stored output: an unchanged regeneration is not re-run.
    input_digest: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    prompt_version: Mapped[AIPromptVersion | None] = relationship()


class AIEvaluation(Base):
    """Every AI call is recorded for governance: prompt version, model, I/O, confidence, errors."""

    __tablename__ = "ai_evaluations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[int | None] = mapped_column(ForeignKey("assessment_attempts.id", ondelete="CASCADE"), index=True)
    answer_id: Mapped[int | None] = mapped_column(ForeignKey("answers.id", ondelete="CASCADE"), index=True)
    practice_submission_id: Mapped[int | None] = mapped_column(
        ForeignKey("practice_submissions.id", ondelete="CASCADE"), index=True
    )
    competency_id: Mapped[int | None] = mapped_column(ForeignKey("competencies.id", ondelete="SET NULL"))
    prompt_version_id: Mapped[int | None] = mapped_column(ForeignKey("ai_prompt_versions.id", ondelete="SET NULL"))
    input_type: Mapped[AIInputType] = mapped_column(db_enum(AIInputType, "ai_input_type"))
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    status: Mapped[AIEvalStatus] = mapped_column(db_enum(AIEvalStatus, "ai_eval_status"))
    input_excerpt: Mapped[str | None] = mapped_column(Text)
    output: Mapped[dict | None] = mapped_column(JSON)
    score: Mapped[int | None] = mapped_column(Integer)
    level: Mapped[str | None] = mapped_column(String(32))
    confidence: Mapped[float | None] = mapped_column(Float)
    evidence: Mapped[list | None] = mapped_column(JSON)
    strengths: Mapped[list | None] = mapped_column(JSON)
    development_areas: Mapped[list | None] = mapped_column(JSON)
    explanation: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    # Language the free texts were generated in ("ru" | "kk" | "en"); NULL for rows written before it was recorded.
    language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    prompt_version: Mapped[AIPromptVersion | None] = relationship()
    competency = relationship("Competency")
