"""Translations of database content (competencies, questions, resources, plans, …).

English is the base language and lives in the normal columns. Each translatable table has a `translations` JSON
column: {"ru": {"name": "…", "description": "…"}, "kk": {…}}. When an object is loaded during a request whose
content localization is on (see core/middleware.py), the translated values for the request language replace the
base values in memory with `set_committed_value`, so they are never marked dirty or written back. The English base
values of a localized object stay available through `base_text()`.

Fallback policy (field by field): kk → ru → en, ru → en. Russian is widely understood in Kazakhstan and is the
product default, so a Kazakh user sees the Russian text of a field that has no Kazakh translation yet, and English
only when neither exists. The server catalog (core/i18n.py `tr`) uses the same chain.

Rubrics (lists of {criterion, description, competency, keywords}) are translated position by position; keywords of
every language are merged so a rule-based evaluator recognises answers written in any supported language. When an
editor reorders or edits the English rubric, `reconcile_translations` realigns the translated rows by criterion.

Stale translations: when an English base field changes while a translation of it exists, the translation is kept
(it is still better than nothing) but recorded in `translations["_stale"] = {"ru": [fields], "kk": [fields]}` until
an editor replaces it or confirms it (by sending `_stale` without that field). `translation_status()` reports
missing and stale fields per language for the admin completeness report.
"""

from __future__ import annotations

import copy
import unicodedata
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, ClassVar

from sqlalchemy import JSON, event, inspect
from sqlalchemy.orm import Mapped, Session, mapped_column
from sqlalchemy.orm.attributes import set_committed_value

from app.core.context import content_localization_var, language_var

FALLBACK = {"kk": ("kk", "ru"), "ru": ("ru",), "en": ()}
LANGS = ("ru", "kk")
STALE = "_stale"
_BASE = "_i18n_base"


class Translatable:
    """Mixin: adds `translations` and swaps in the request language on load."""

    __translatable__: ClassVar[tuple[str, ...]] = ()
    __translatable_rubric__: ClassVar[bool] = False

    translations: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    @property
    def translation_status(self) -> dict[str, dict]:
        return translation_status(self)


def normalize(text: str | None) -> str:
    """Comparison key for criterion names and keywords: NFC, casefold, ё → е, single spaces."""
    t = unicodedata.normalize("NFC", text or "").casefold().replace("ё", "е")
    return " ".join(t.split())


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


def rubric_aliases(base_rubric: list | None, translations: dict | None) -> list[set[str]]:
    """Normalized names of each rubric criterion (by position) in English and every translation."""
    out = []
    for i, base in enumerate(base_rubric or []):
        names = {normalize(base.get("criterion"))}
        for lang in LANGS:
            rows = ((translations or {}).get(lang) or {}).get("rubric") or []
            if i < len(rows) and rows[i].get("criterion"):
                names.add(normalize(rows[i]["criterion"]))
        out.append(names)
    return out


def match_ratings(stored: list[dict], aliases: list[set[str]]) -> list[int | None]:
    """Stored criterion ratings mapped onto rubric positions.

    Matched by criterion name in any language first; a stored rating whose name matches no criterion falls back to its
    position (rule-based output of a rubric whose names were later edited)."""
    out: list[int | None] = [None] * len(aliases)
    used: set[int] = set()
    for k, c in enumerate(stored):
        name = normalize(c.get("criterion"))
        j = next((j for j, names in enumerate(aliases) if name in names and out[j] is None), None)
        if j is not None:
            out[j] = int(c.get("rating") or 0)
            used.add(k)
    for k, c in enumerate(stored):
        if k in used or k >= len(aliases) or out[k] is not None:
            continue
        if not any(normalize(c.get("criterion")) in names for names in aliases):
            out[k] = int(c.get("rating") or 0)
    return out


def apply(obj: Translatable, lang: str | None = None) -> None:
    lang = lang or language_var.get()
    chain = FALLBACK.get(lang, ())
    tr = obj.translations or {}
    base = obj.__dict__.setdefault(_BASE, {})
    if chain and tr:
        for field in obj.__translatable__:
            value = _pick(tr, field, chain)
            if value is not None:
                base.setdefault(field, obj.__dict__.get(field))
                set_committed_value(obj, field, value)
    if obj.__translatable_rubric__:
        base.setdefault("rubric", obj.__dict__.get("rubric"))
        set_committed_value(obj, "rubric", localize_rubric(obj.rubric, tr, chain))  # type: ignore[attr-defined]


def base_text(obj: Any, field: str) -> Any:
    """The stored English value of `field`, even when `obj` was loaded in a localized request."""
    if obj is None:
        return None
    base = obj.__dict__.get(_BASE) or {}
    return base[field] if field in base else getattr(obj, field)


@contextmanager
def base_language() -> Iterator[None]:
    """Compose stored texts in the base language (English) and load content rows untranslated."""
    t1 = language_var.set("en")
    t2 = content_localization_var.set(False)
    try:
        yield
    finally:
        content_localization_var.reset(t2)
        language_var.reset(t1)


@event.listens_for(Translatable, "load", propagate=True)
def _on_load(target: Translatable, _context: object) -> None:
    if content_localization_var.get():
        apply(target)


@event.listens_for(Translatable, "refresh", propagate=True)
def _on_refresh(target: Translatable, _context: object, attrs: object) -> None:
    target.__dict__.pop(_BASE, None)
    if content_localization_var.get():
        apply(target)


# --- Completeness ------------------------------------------------------------------------------------------------


def _filled(v: Any) -> bool:
    return v not in (None, "", [], {}) and not (isinstance(v, str) and not v.strip())


def _rubric_complete(base_rows: list, tr_rows: list) -> bool:
    for i, b in enumerate(base_rows):
        row = tr_rows[i] if i < len(tr_rows) and isinstance(tr_rows[i], dict) else {}
        for f in ("criterion", "description"):
            if _filled(b.get(f)) and not _filled(row.get(f)):
                return False
    return True


def stale_fields(translations: dict | None, lang: str) -> list[str]:
    return list(((translations or {}).get(STALE) or {}).get(lang) or [])


def _status(missing: list[str], stale: list[str], total: int) -> str:
    if stale:
        return "stale"
    if not missing:
        return "complete"
    return "missing" if len(missing) >= total else "partial"


def translation_status(row: Any, extra: dict[str, dict[str, list[str]]] | None = None) -> dict[str, dict]:
    """Per language: {"status": complete|partial|missing|stale, "missing": [fields], "stale": [fields]}.

    Only fields with English base text count. `extra` adds pseudo-fields ({"missing": {lang: [..]}, "stale": ...}),
    e.g. a question's "options". Base values are read with `base_text`, so a localized load reports correctly.
    """
    tr = row.translations or {}
    fields = [f for f in row.__translatable__ if _filled(base_text(row, f))]
    rubric = list(base_text(row, "rubric") or []) if getattr(row, "__translatable_rubric__", False) else []
    if rubric:
        fields.append("rubric")
    extra = extra or {}
    out: dict[str, dict] = {}
    for lang in LANGS:
        values = tr.get(lang) or {}
        missing = [
            f for f in fields
            if (f == "rubric" and not _rubric_complete(rubric, values.get("rubric") or []))
            or (f != "rubric" and not _filled(values.get(f)))
        ]
        stale = [f for f in stale_fields(tr, lang) if f in fields and f not in missing]
        extra_missing = (extra.get("missing") or {}).get(lang, [])
        extra_stale = (extra.get("stale") or {}).get(lang, [])
        missing += [f for f in extra_missing if f not in missing]
        stale += [f for f in extra_stale if f not in stale and f not in missing]
        total = len(fields) + len({*extra_missing, *extra_stale})
        out[lang] = {"status": _status(missing, stale, total), "missing": missing, "stale": stale}
    return out


def merge_status(own: dict[str, dict], children: list[dict[str, dict]], name: str) -> dict[str, dict[str, list[str]]]:
    """Fold child rows' statuses (e.g. options of a question) into one pseudo-field `name` for `translation_status`."""
    extra: dict[str, dict[str, list[str]]] = {"missing": {}, "stale": {}}
    for lang in LANGS:
        if any(c[lang]["missing"] for c in children):
            extra["missing"][lang] = [name]
        elif any(c[lang]["stale"] for c in children):
            extra["stale"][lang] = [name]
    return extra


# --- Stale tracking when the English base text changes ----------------------------------------------------------


def pair_by_key(old: list[str], new: list[str]) -> list[int | None]:
    """For each new item, the index of the old item it continues: same key (normalized) first; the items left over on
    both sides are then paired in order (an edited label or criterion). None: a brand-new item."""
    old_n, new_n = [normalize(k) for k in old], [normalize(k) for k in new]
    out: list[int | None] = [None] * len(new)
    used: set[int] = set()
    for j, key in enumerate(new_n):
        i = next((i for i, k in enumerate(old_n) if k == key and i not in used), None)
        if i is not None:
            out[j] = i
            used.add(i)
    left = [i for i in range(len(old)) if i not in used]
    for j in range(len(new)):
        if out[j] is None and left:
            out[j] = left.pop(0)
    return out


def _realign_rubric(old_base: list, new_base: list, rows: list) -> tuple[list, bool]:
    """Move translated rubric rows to follow their English criterion. Returns (rows, any_row_outdated)."""
    match = pair_by_key([r.get("criterion") or "" for r in old_base], [r.get("criterion") or "" for r in new_base])
    out: list[dict] = []
    outdated = False
    for j, nb in enumerate(new_base):
        i = match[j]
        row: dict = {}
        if i is not None:
            row = dict(rows[i]) if i < len(rows) and isinstance(rows[i], dict) else {}
            ob = old_base[i]
            if (row.get("criterion") or row.get("description")) and (
                ob.get("criterion") != nb.get("criterion") or ob.get("description") != nb.get("description")
            ):
                outdated = True
        out.append(row)
    while out and not out[-1]:
        out.pop()
    return out, outdated


def reconcile_translations(
    cls: type,
    old_tr: dict | None,
    new_tr: dict | None,
    old_base: dict[str, Any],
    new_base: dict[str, Any],
    confirm_from_client: bool = True,
) -> dict | None:
    """New `translations` value after a change of English base fields and/or translations.

    - A translation whose text changed counts as replaced: it is no longer stale.
    - `_stale` sent by the client can only remove entries (confirming a translation as still correct).
    - An English field that changed marks its existing, untouched translations stale.
    - Rubric translation rows follow their criterion when the English rubric is reordered or edited.
    """
    old_tr = old_tr or {}
    new = copy.deepcopy(new_tr or {})
    old_stale = old_tr.get(STALE) or {}
    sent = new.pop(STALE, None)
    stale: dict[str, set[str]] = {}
    for lang in LANGS:
        cur = set(old_stale.get(lang) or [])
        if confirm_from_client and isinstance(sent, dict):
            cur &= set(sent.get(lang) or [])
        stale[lang] = cur
    rubric = ["rubric"] if getattr(cls, "__translatable_rubric__", False) else []
    fields = [*getattr(cls, "__translatable__", ()), *rubric]
    for lang in LANGS:
        old_vals = old_tr.get(lang) or {}
        new_vals = new.get(lang)
        if new_vals is None:
            new_vals = {}
        for f in fields:
            changed_tr = old_vals.get(f) != new_vals.get(f)
            if changed_tr:
                stale[lang].discard(f)
                continue
            base_changed = f in old_base and f in new_base and old_base[f] != new_base[f] and _filled(old_base[f])
            if not base_changed:
                continue
            if f == "rubric":
                rows, outdated = _realign_rubric(old_base[f] or [], new_base[f] or [], new_vals.get("rubric") or [])
                if rows:
                    new_vals["rubric"] = rows
                else:
                    new_vals.pop("rubric", None)
                if outdated:
                    stale[lang].add(f)
            elif _filled(new_vals.get(f)):
                stale[lang].add(f)
        if new_vals:
            new[lang] = new_vals
        else:
            new.pop(lang, None)
    stale_out = {lang: sorted(v) for lang, v in stale.items() if v}
    if stale_out:
        new[STALE] = stale_out
    return new or None


def _history_old(state: Any, field: str) -> tuple[bool, Any]:
    hist = state.attrs[field].history
    if not hist.has_changes() or not hist.deleted:
        return False, None
    return True, hist.deleted[0]


@event.listens_for(Session, "before_flush")
def _track_stale(session: Session, _ctx: object, _instances: object) -> None:
    for obj in list(session.new):
        tr = getattr(obj, "translations", None) if isinstance(obj, Translatable) else None
        if tr and STALE in tr and not any((tr.get(STALE) or {}).values()):
            obj.translations = {k: v for k, v in tr.items() if k != STALE} or None
    for obj in list(session.dirty):
        if not isinstance(obj, Translatable) or obj.__dict__.get(_BASE):
            continue  # localized copies are never written back
        state = inspect(obj)
        fields = [*obj.__translatable__, *(["rubric"] if obj.__translatable_rubric__ else [])]
        old_base, new_base = {}, {}
        for f in fields:
            changed, old = _history_old(state, f)
            if changed:
                old_base[f], new_base[f] = old, getattr(obj, f)
        tr_changed, old_tr = _history_old(state, "translations")
        if not old_base and not tr_changed:
            continue
        if not tr_changed:
            old_tr = obj.translations
        result = reconcile_translations(type(obj), old_tr, obj.translations, old_base, new_base, tr_changed)
        if result != obj.translations:
            obj.translations = result
