"""Optimistic locking and field-level change tracking for administrator edits."""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any

from app.core.errors import VERSION_CONFLICT_MESSAGE, VersionConflict

# Never written to the audit log, not even as "changed" with values.
SECRET_FIELDS = frozenset({"password", "password_hash", "token", "token_hash", "secret", "code_verifier", "nonce"})


def check_version(row: Any, expected: int | None) -> None:
    """Reject the change if the client edited an older version than the one stored (409 VERSION_CONFLICT)."""
    if expected is not None and expected != row.lock_version:
        raise VersionConflict(VERSION_CONFLICT_MESSAGE, details={"current_version": row.lock_version})


def _plain(v: Any) -> Any:
    if isinstance(v, Enum):
        return v.value
    if isinstance(v, datetime | date):
        return v.isoformat()
    if isinstance(v, str) and len(v) > 200:
        return v[:200] + "…"
    return v


def snapshot(row: Any, fields: list[str] | tuple[str, ...]) -> dict[str, Any]:
    return {f: _plain(getattr(row, f, None)) for f in fields}


def changes(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """{"field": {"from": old, "to": new}} for changed fields; secrets are reported as changed without values."""
    out: dict[str, dict[str, Any]] = {}
    for k in after:
        if before.get(k) != after.get(k):
            out[k] = {"changed": True} if k in SECRET_FIELDS else {"from": before.get(k), "to": after.get(k)}
    return out
