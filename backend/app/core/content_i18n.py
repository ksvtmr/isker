"""Translations of database content (competencies, questions, resources, plans, …).

English is the base language and lives in the normal columns. Each translatable table has a `translations` JSON
column: {"ru": {"name": "…", "description": "…"}, "kk": {…}}. When an object is loaded during a request whose
content localization is on (see core/middleware.py), the translated values for the request language replace the
base values in memory with `set_committed_value`, so they are never marked dirty or written back. Missing texts fall
back kk → ru → en, field by field.

Rubrics (lists of {criterion, description, competency, keywords}) are translated position by position; keywords of
every language are merged so a rule-based evaluator recognises answers written in any supported language.
"""

from __future__ import annotations

from typing import Any, ClassVar

from sqlalchemy import JSON, event
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.orm.attributes import set_committed_value

from app.core.context import content_localization_var, language_var

FALLBACK = {"kk": ("kk", "ru"), "ru": ("ru",), "en": ()}
LANGS = ("ru", "kk")


class Translatable:
    """Mixin: adds `translations` and swaps in the request language on load."""

    __translatable__: ClassVar[tuple[str, ...]] = ()
    __translatable_rubric__: ClassVar[bool] = False

    translations: Mapped[dict | None] = mapped_column(JSON, nullable=True)


def _pick(translations: dict, field: str, chain: tuple[str, ...]) -> Any:
    for lang in chain:
        value = (translations.get(lang) or {}).get(field)
        if value not in (None, ""):
            return value
    return None


def localize_rubric(rubric: list | None, translations: dict | None, chain: tuple[str, ...]) -> list | None:
    if not rubric:
        return rubric
    translations = translations or {}
    out = []
    for i, base in enumerate(rubric):
        item = dict(base)
        keywords = list(base.get("keywords") or [])
        for lang in LANGS:
            rows = (translations.get(lang) or {}).get("rubric") or []
            if i < len(rows):
                keywords += [k for k in rows[i].get("keywords") or [] if k not in keywords]
        for field in ("criterion", "description"):
            for lang in chain:
                rows = (translations.get(lang) or {}).get("rubric") or []
                if i < len(rows) and rows[i].get(field):
                    item[field] = rows[i][field]
                    break
        item["keywords"] = keywords
        out.append(item)
    return out


def apply(obj: Translatable, lang: str | None = None) -> None:
    lang = lang or language_var.get()
    chain = FALLBACK.get(lang, ())
    tr = obj.translations or {}
    if chain and tr:
        for field in obj.__translatable__:
            value = _pick(tr, field, chain)
            if value is not None:
                set_committed_value(obj, field, value)
    if obj.__translatable_rubric__:
        set_committed_value(obj, "rubric", localize_rubric(obj.rubric, tr, chain))  # type: ignore[attr-defined]


@event.listens_for(Translatable, "load", propagate=True)
def _on_load(target: Translatable, _context: object) -> None:
    if content_localization_var.get():
        apply(target)


@event.listens_for(Translatable, "refresh", propagate=True)
def _on_refresh(target: Translatable, _context: object, attrs: object) -> None:
    if content_localization_var.get():
        apply(target)
