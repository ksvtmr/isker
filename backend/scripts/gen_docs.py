"""Regenerate docs/openapi.json, the endpoint tables in docs/api.md and the table reference in docs/database.md.

    cd backend && python scripts/gen_docs.py

Hand-written text above the "## Endpoints" / "## Tables" headings is kept; everything below is regenerated.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import CheckConstraint, UniqueConstraint  # noqa: E402

import app.models  # noqa: E402,F401
from app.core.database import Base  # noqa: E402
from app.main import TAGS, app  # noqa: E402

DOCS = Path(__file__).resolve().parents[2] / "docs"


def keep_head(path: Path, marker: str) -> str:
    text = path.read_text(encoding="utf-8")
    return text.split(marker, 1)[0].rstrip() + "\n\n"


def api_docs(spec: dict) -> str:
    by_tag: dict[str, list[tuple[str, str, str]]] = {}
    for p, ops in spec["paths"].items():
        for method, op in ops.items():
            tag = (op.get("tags") or ["other"])[0]
            by_tag.setdefault(tag, []).append((method.upper(), p, op.get("summary", "")))
    out = ["## Endpoints\n"]
    for t in [t["name"] for t in TAGS] + sorted(set(by_tag) - {t["name"] for t in TAGS}):
        if t not in by_tag:
            continue
        desc = next((x["description"] for x in TAGS if x["name"] == t), "")
        out.append(f"### {t}\n\n{desc}\n\n| Method | Path | Description |\n|---|---|---|")
        out += [f"| `{m}` | `{p}` | {s} |" for m, p, s in by_tag[t]]
        out.append("")
    return "\n".join(out)


def db_docs() -> str:
    out = ["## Tables\n"]
    for table in Base.metadata.sorted_tables:
        out.append(f"### `{table.name}`\n\n| Column | Type | Null | Notes |\n|---|---|---|---|")
        for c in table.columns:
            notes = []
            if c.primary_key:
                notes.append("PK")
            for fk in c.foreign_keys:
                notes.append(f"FK → `{fk.target_fullname}` ({fk.ondelete or 'NO ACTION'})")
            if c.unique:
                notes.append("unique")
            if c.index:
                notes.append("indexed")
            out.append(f"| `{c.name}` | {c.type} | {'yes' if c.nullable else 'no'} | {', '.join(notes)} |")
        uniques = [u for u in table.constraints if isinstance(u, UniqueConstraint) and len(u.columns) > 1]
        checks = [c for c in table.constraints if isinstance(c, CheckConstraint) and " IN (" not in str(c.sqltext)]
        if uniques:
            out.append("\nUnique: " + "; ".join("(" + ", ".join(col.name for col in u.columns) + ")" for u in uniques))
        if checks:
            out.append("\nChecks: " + "; ".join(f"`{c.sqltext}`" for c in checks))
        out.append("")
    return "\n".join(out)


def main() -> None:
    spec = app.openapi()
    (DOCS / "openapi.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    api = DOCS / "api.md"
    api.write_text(keep_head(api, "## Endpoints") + api_docs(spec), encoding="utf-8")
    db = DOCS / "database.md"
    db.write_text(keep_head(db, "## Tables") + db_docs(), encoding="utf-8")
    print(f"{len(spec['paths'])} paths, {len(Base.metadata.tables)} tables")


if __name__ == "__main__":
    main()
