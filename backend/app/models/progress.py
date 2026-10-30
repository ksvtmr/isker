from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, utcnow


class ProgressSnapshot(Base):
    """Point-in-time snapshot written after every completed attempt. Never updated."""

    __tablename__ = "progress_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("assessment_attempts.id", ondelete="CASCADE"), unique=True)
    overall_score: Mapped[int] = mapped_column(Integer)
    ideas_score: Mapped[int] = mapped_column(Integer)
    resources_score: Mapped[int] = mapped_column(Integer)
    action_score: Mapped[int] = mapped_column(Integer)
    level: Mapped[str] = mapped_column(String(32))
    completed_resources: Mapped[int] = mapped_column(Integer, default=0)
    completed_tasks: Mapped[int] = mapped_column(Integer, default=0)
    plan_progress_pct: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(48))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(255))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    """Append-only audit trail. No API updates or deletes rows; on PostgreSQL a trigger rejects UPDATE/DELETE.

    `actor_id` and `target_id` are plain integers (no foreign keys) so that history survives account deletion
    and is never rewritten. Never store passwords, tokens or secrets in `details`.
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str | None] = mapped_column(String(64))
    target_id: Mapped[int | None] = mapped_column(Integer, index=True)
    outcome: Mapped[str] = mapped_column(String(16), default="success", index=True)
    reason: Mapped[str | None] = mapped_column(String(500))
    request_id: Mapped[str | None] = mapped_column(String(64))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class CharacterStageEvent(Base):
    """Append-only history of the learner's character stage (services/character.py). A row is written only when a
    confirmed result (submitted assessment, completed practical task) moves the profile to another stage, or once as
    a baseline for profiles that existed before stages did. Never updated, except `seen_at` (the congratulation was
    shown)."""

    __tablename__ = "character_stage_events"
    __table_args__ = (
        UniqueConstraint("user_id", "sequence"),
        CheckConstraint("stage >= 1 AND stage <= 4", name="stage_range"),
        CheckConstraint("direction IN ('initial', 'up', 'down')", name="direction_valid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    stage: Mapped[int] = mapped_column(Integer)
    previous_stage: Mapped[int | None] = mapped_column(Integer)
    direction: Mapped[str] = mapped_column(String(8))
    score: Mapped[int] = mapped_column(Integer)
    assessment_score: Mapped[int] = mapped_column(Integer)
    practice_score: Mapped[int | None] = mapped_column(Integer)
    practice_tasks: Mapped[int] = mapped_column(Integer, default=0)
    # What the stage rests on: competencies assessed / with evidence, weights, attempt (no answer text).
    basis: Mapped[dict | None] = mapped_column(JSON)
    rules_version: Mapped[str] = mapped_column(String(16))
    trigger: Mapped[str] = mapped_column(String(16))  # assessment | practice | baseline
    attempt_id: Mapped[int | None] = mapped_column(ForeignKey("assessment_attempts.id", ondelete="SET NULL"))
    practice_submission_id: Mapped[int | None] = mapped_column(
        ForeignKey("practice_submissions.id", ondelete="SET NULL")
    )
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
