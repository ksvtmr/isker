"""Store the Russian and Kazakh translations from app/seed/translations.py in the `translations` columns.

Rows are matched by stable identifiers (codes, slugs, plan keys) or, for questions, options and rubric criteria, by
their English base text. Translations added later by administrators for other fields are kept.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.content_i18n import LANGS
from app.models import (
    Assessment,
    Competency,
    CompetencyArea,
    CompetencyLevel,
    GoalDefinition,
    LearningResource,
    PracticalTask,
    Question,
    QuestionOption,
    SubscriptionPlan,
)
from app.seed import translations as T


def _merge(row: Any, per_lang: dict[str, dict[str, Any]]) -> None:
    current = dict(row.translations or {})
    for lang, values in per_lang.items():
        clean = {k: v for k, v in values.items() if v not in (None, "", [])}
        current[lang] = {**(current.get(lang) or {}), **clean}
    row.translations = current


def _rubric(rubric: list | None) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for lang in LANGS:
        rows = []
        for item in rubric or []:
            name = item.get("criterion", "")
            tr = (T.RUBRIC.get(name) or {}).get(lang) or {}
            rows.append({"criterion": tr.get("criterion") or name, "description": tr.get("description") or "",
                         "keywords": (T.KEYWORDS.get(name) or {}).get(lang) or []})
        out[lang] = {"rubric": rows}
    return out


def _with_rubric(fields: dict[str, dict[str, Any]], rubric: list | None) -> dict[str, dict[str, Any]]:
    rub = _rubric(rubric) if rubric else {}
    return {lang: {**(fields.get(lang) or {}), **(rub.get(lang) or {})} for lang in LANGS}


def apply_content_translations(db: Session) -> int:
    n = 0
    for model, key, table in (
        (CompetencyArea, "code", T.AREAS),
        (Competency, "code", T.COMPETENCIES),
        (GoalDefinition, "code", T.GOALS),
        (CompetencyLevel, "name", getattr(T, "LEVELS", {})),
        (Assessment, "code", T.ASSESSMENTS),
        (LearningResource, "slug", T.RESOURCES),
        (SubscriptionPlan, "key", T.PLANS),
    ):
        for row in db.scalars(select(model)):
            entry = table.get(getattr(row, key))
            if entry:
                _merge(row, entry)
                n += 1
    for task in db.scalars(select(PracticalTask)):
        entry = T.TASKS.get(task.slug)
        if entry or task.rubric:
            _merge(task, _with_rubric(entry or {}, task.rubric))
            n += 1
    for q in db.scalars(select(Question)):
        entry = T.QUESTIONS.get(q.text) or {}
        fields = {
            lang: {**(entry.get(lang) or {}), "section": (T.SECTIONS.get(q.section) or {}).get(lang)} for lang in LANGS
        }
        _merge(q, _with_rubric(fields, q.rubric))
        n += 1
    for opt in db.scalars(select(QuestionOption)):
        entry = T.OPTIONS.get(opt.label)
        if entry:
            _merge(opt, {lang: {"label": entry.get(lang)} for lang in LANGS})
            n += 1
    return n
