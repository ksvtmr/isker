"""CI guard: a migration whose upgrade() can destroy data must say so.

Production runs `alembic upgrade head` automatically on every deploy (docker-entrypoint.sh), so a destructive step
would reach real data without anyone looking. This check fails when upgrade() drops a table or column, or runs
DROP / DELETE / TRUNCATE SQL, unless the migration's docstring has a "Destructive steps" section explaining why it is
safe (what is copied first, how to back up). downgrade() is not checked: it is never run automatically.

    python scripts/check_migrations.py      # from backend/, exit code 1 on problems
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

VERSIONS = Path(__file__).resolve().parent.parent / "alembic" / "versions"
DESTRUCTIVE_OPS = {"drop_table", "drop_column", "drop_constraint_cascade"}
DESTRUCTIVE_SQL = re.compile(r"\b(DROP\s+(TABLE|COLUMN|SCHEMA)|DELETE\s+FROM|TRUNCATE)\b", re.IGNORECASE)


def destructive_calls(fn: ast.FunctionDef) -> list[str]:
    found = []
    for node in ast.walk(fn):
        if not isinstance(node, ast.Call):
            continue
        name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
        if name in DESTRUCTIVE_OPS:
            found.append(f"op.{name} (line {node.lineno})")
        if name == "execute":
            for arg in node.args:
                text = arg.value if isinstance(arg, ast.Constant) and isinstance(arg.value, str) else ""
                if DESTRUCTIVE_SQL.search(text):
                    found.append(f"SQL {DESTRUCTIVE_SQL.search(text).group(0)!r} (line {node.lineno})")
    return found


def main() -> int:
    problems = []
    files = sorted(VERSIONS.glob("*.py"))
    for path in files:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        doc = ast.get_docstring(tree) or ""
        upgrade = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade"), None)
        if upgrade is None:
            problems.append(f"{path.name}: no upgrade() function")
            continue
        found = destructive_calls(upgrade)
        if found and "destructive steps" not in doc.lower():
            steps = ", ".join(found)
            problems.append(f"{path.name}: destructive upgrade without a 'Destructive steps' section: {steps}")
    for p in problems:
        print(f"✖ {p}")
    print(f"Checked {len(files)} migrations: {'OK' if not problems else f'{len(problems)} problem(s)'}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
