from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.content_i18n import Translatable
from app.core.database import Base, TimestampMixin, Versioned
from app.models.content import Publishable


class CompetencyArea(Translatable, Base):
    """EntreComp area: Ideas & Opportunities, Resources, Into Action."""

    __tablename__ = "competency_areas"
    __translatable__ = ("name",)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    color_token: Mapped[str] = mapped_column(String(48))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    competencies: Mapped[list[Competency]] = relationship(back_populates="area", order_by="Competency.sort_order")


class Competency(Publishable, Versioned, Translatable, TimestampMixin, Base):
    __tablename__ = "competencies"
    __translatable__ = ("name", "short_name", "description", "hint", "reflection_prompt")

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("competency_areas.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    short_name: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(Text)
    hint: Mapped[str | None] = mapped_column(Text)
    reflection_prompt: Mapped[str | None] = mapped_column(Text)
    importance: Mapped[float] = mapped_column(Float, default=0.5)
    learning_priority: Mapped[float] = mapped_column(Float, default=0.5)
    default_target: Mapped[int] = mapped_column(Integer, default=70)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    area: Mapped[CompetencyArea] = relationship(back_populates="competencies")


class CompetencyLevel(Translatable, Base):
    """Five proficiency levels with score bands (Foundation 0–39 … Proficient 90–100)."""

    __tablename__ = "competency_levels"
    __translatable__ = ("description",)
    __table_args__ = (UniqueConstraint("rank"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    rank: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(32), unique=True)
    min_score: Mapped[int] = mapped_column(Integer)
    max_score: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text)
