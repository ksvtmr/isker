"""The Isker API running inside the browser (Pyodide), for the GitHub Pages demo that has no server.

The same FastAPI application, models, scoring, seed data and permission checks as the real server, with SQLite instead
of PostgreSQL. The interface calls `handle()` instead of fetch(); requests never leave the browser. Data is saved in
the visitor's browser only (see frontend/src/standalone/), so every visitor has a private copy of the platform.

Differences from the real server:
- Pyodide has no threads, so FastAPI's thread pool runs synchronous endpoints inline (one request at a time).
- No email is sent (EMAIL_BACKEND=console); AI feedback uses the built-in mock provider.
"""

from __future__ import annotations

import json
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit

_app = None


def _inline_thread_pool() -> None:
    import anyio.to_thread

    async def run_sync(func, *args, abandon_on_cancel=False, cancellable=None, limiter=None):  # noqa: ARG001
        return func(*args)

    anyio.to_thread.run_sync = run_sync


def setup(data_dir: str) -> dict:
    """Configures and starts the API on a SQLite database in `data_dir`; creates and seeds it on first use."""
    global _app
    data = Path(data_dir)
    data.mkdir(parents=True, exist_ok=True)
    secret_file = data / "jwt-secret"
    if not secret_file.exists():
        secret_file.write_text(secrets.token_urlsafe(48))
    db_file = data / "isker.db"
    first_run = not db_file.exists()
    os.environ.update({
        "DATABASE_URL": f"sqlite:///{db_file}",
        "ENVIRONMENT": "development",
        "JWT_SECRET": secret_file.read_text().strip(),
        "MOCK_AI": "true",
        "EMAIL_BACKEND": "console",
        "API_DOCS_ENABLED": "false",
        "RATE_LIMIT_ENABLED": "false",
        "APP_BASE_URL": os.environ.get("APP_BASE_URL", "http://localhost"),
    })
    _inline_thread_pool()

    import app.models  # noqa: F401 - registers every table on Base.metadata
    from app.core.database import Base, engine
    from app.main import app
    from app.seed.run import run as seed

    Base.metadata.create_all(engine)
    if first_run:
        seed(with_demo=True)
    _app = app
    return {"first_run": first_run}


async def handle(method: str, url: str, headers_json: str, body: str) -> str:
    """One HTTP request through the ASGI app; returns {"status", "headers", "body"} as JSON."""
    assert _app is not None, "setup() first"
    parts = urlsplit(url)
    raw = body.encode() if isinstance(body, str) else b""
    headers = [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in json.loads(headers_json).items()]
    headers.append((b"host", b"isker.local"))
    if raw:
        headers.append((b"content-length", str(len(raw)).encode()))
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method.upper(),
        "scheme": "https", "path": parts.path, "raw_path": parts.path.encode(), "root_path": "",
        "query_string": parts.query.encode(), "headers": headers,
        "client": ("127.0.0.1", 0), "server": ("isker.local", 443),
    }
    sent = False

    async def receive() -> dict:
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": raw, "more_body": False}

    out: dict = {"status": 500, "headers": {}, "body": b""}

    async def send(message: dict) -> None:
        if message["type"] == "http.response.start":
            out["status"] = message["status"]
            out["headers"] = {k.decode("latin-1"): v.decode("latin-1") for k, v in message.get("headers", [])}
        elif message["type"] == "http.response.body":
            out["body"] += message.get("body", b"")

    await _app(scope, receive, send)
    body_text = out["body"].decode("utf-8", "replace")
    return json.dumps({"status": out["status"], "headers": out["headers"], "body": body_text})
