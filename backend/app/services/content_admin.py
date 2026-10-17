"""Shared rules for the content editor: translation validation, status resolution and version bumps."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.content_i18n import LANGS, STALE, merge_status, translation_status
from app.core.database import utcnow
from app.core.errors import ValidationError
from app.models import Answer
from app.models.enums import ContentStatus

MAX_TRANSLATION = 20_000
RUBRIC_FIELDS = ("criterion", "description")


def _bad(message: str, **details: Any) -> ValidationError:
    return ValidationError(message, "INVALID_TRANSLATIONS", details or None)


def _clean_rubric(rows: Any, lang: str, rubric_len: int) -> list[dict]:
    if not isinstance(rows, list):
        raise _bad("Rubric translations must be a list.", language=lang)
    if len(rows) > rubric_len:
        raise _bad("There are more rubric translations than rubric criteria.", language=lang)
    out = []
    for row in rows:
        if not isinstance(row, dict) or set(row) - {*RUBRIC_FIELDS, "keywords"}:
            raise _bad("Each rubric translation has only criterion, description and keywords.", language=lang)
        item: dict[str, Any] = {}
        for f in RUBRIC_FIELDS:
            v = row.get(f)
            if v is not None and not isinstance(v, str):
                raise _bad("Rubric texts must be strings.", language=lang)
            if v and v.strip():
                item[f] = v.strip()[:MAX_TRANSLATION]
        kws = row.get("keywords") or []
        if not isinstance(kws, list) or not all(isinstance(k, str) for k in kws):
            raise _bad("Rubric keywords must be a list of strings.", language=lang)
        kws = [k.strip() for k in kws if k.strip()]
        if kws:
            item["keywords"] = kws[:50]
        out.append(item)
    # Rubric translations are matched by position, so empty rows in the middle are kept and only the tail trimmed.
    while out and not out[-1]:
        out.pop()
    return out


def clean_translations(model: type, data: Any, rubric_len: int = 0) -> dict | None:
    """Validate {"ru": {field: text}, "kk": {...}} against the model's translatable fields; drop empty texts.

    English is the base text and lives in the normal columns, so "en" is not accepted here. `_stale` (the list of
    translations marked outdated, see core/content_i18n.py) may be sent back; leaving a field out of it confirms that
    translation as still correct.
    """
    if data is None:
        return None
    if not isinstance(data, dict):
        raise _bad("Translations must be an object keyed by language.")
    stale = _clean_stale(data.get(STALE), model) if STALE in data else None
    data = {k: v for k, v in data.items() if k != STALE}
    unknown_langs = sorted(set(data) - set(LANGS))
    if unknown_langs:
        raise _bad("Translations are accepted for ru and kk only.", languages=unknown_langs)
    allowed = set(model.__translatable__)
    rubric = bool(getattr(model, "__translatable_rubric__", False))
    out: dict[str, dict] = {}
    for lang in LANGS:
        fields = data.get(lang)
        if fields is None:
            continue
        if not isinstance(fields, dict):
            raise _bad("Translations of a language must be an object.", language=lang)
        unknown = sorted(set(fields) - allowed - ({"rubric"} if rubric else set()))
        if unknown:
            raise _bad("These fields can't be translated.", language=lang, fields=unknown)
        clean: dict[str, Any] = {}
        for k, v in fields.items():
            if k == "rubric":
                rows = _clean_rubric(v, lang, rubric_len)
                if rows:
                    clean["rubric"] = rows
                continue
            if v is None:
                continue
            if not isinstance(v, str):
                raise _bad("Translated texts must be strings.", language=lang, field=k)
            if v.strip():
                if len(v) > MAX_TRANSLATION:
                    raise _bad("A translated text is too long.", language=lang, field=k)
                clean[k] = v.strip()
        if clean:
            out[lang] = clean
    if stale is not None:
        # Kept even when empty: it tells the save that the editor confirmed the stale translations it left out.
        out[STALE] = stale
    return out or None


def _clean_stale(value: Any, model: type) -> dict[str, list[str]]:
    """`_stale` sent back by the editor: {"ru": [fields], "kk": [...]}. It can only confirm (remove) entries."""
    if value is None:
        return {}
    if not isinstance(value, dict) or set(value) - set(LANGS):
        raise _bad("_stale must be an object keyed by ru/kk.")
    allowed = {*model.__translatable__, "rubric"}
    out = {}
    for lang, fields in value.items():
        if not isinstance(fields, list) or not all(isinstance(f, str) for f in fields):
            raise _bad("_stale lists field names.", language=lang)
        out[lang] = [f for f in fields if f in allowed]
    return out


def resolve_status(
    status: ContentStatus | None, legacy_flag: bool | None, current: ContentStatus | None, default: ContentStatus
) -> ContentStatus:
    """Status from a request: an explicit `status` wins; older clients send only the boolean (published/active)."""
    if status is not None:
        return status
    if legacy_flag is None:
        return current or default
    if legacy_flag:
        return ContentStatus.PUBLISHED
    return current if current in (ContentStatus.DRAFT, ContentStatus.ARCHIVED) else ContentStatus.DRAFT


def touch(row: Any) -> None:
    """Force an UPDATE of the row itself, so `lock_version` moves even when only child rows changed."""
    row.updated_at = utcnow()


def question_answer_count(db: Session, question_id: int) -> int:
    return db.scalar(select(func.count(Answer.id)).where(Answer.question_id == question_id)) or 0


def question_translation_status(q: Any) -> dict[str, dict]:
    """A question's status includes its options as the pseudo-field "options"."""
    children = [translation_status(o) for o in q.options]
    return translation_status(q, merge_status(translation_status(q), children, "options"))
