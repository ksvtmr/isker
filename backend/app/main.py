"""Isker API — FastAPI application factory."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.routes import admin, assessments, auth, competencies, learning, plan, practice, profile, progress
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.errors import install_error_handlers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

DESCRIPTION = """
Isker assesses and develops entrepreneurial competencies (EntreComp, 15 competencies).

**Product loop:** Assess → Profile → Identify Gaps → Recommend → Learn → Practice → Re-assess → Track Progress.

**Authentication:** `POST /api/auth/login` returns a JWT and also sets an httpOnly session cookie.
Send the token as `Authorization: Bearer <token>` (or rely on the cookie in a browser).

**Errors** always use one envelope: `{"error": {"code": "ASSESSMENT_NOT_FOUND", "message": "...", "details": ...}}`.
"""

TAGS = [
    {"name": "auth", "description": "Registration, login, logout, current user"},
    {"name": "profile", "description": "Onboarding, goals and learning preferences"},
    {"name": "assessments", "description": "Assessment engine: attempts, autosave, submission, results"},
    {"name": "competencies", "description": "EntreComp catalogue and per-competency explanations"},
    {"name": "scores", "description": "Competency profile"},
    {"name": "gaps", "description": "Gap analysis"},
    {"name": "recommendations", "description": "Recommendation engine"},
    {"name": "plan", "description": "Development plan (Learn → Practice → Reflect → Reassess)"},
    {"name": "learning", "description": "Learning resources and progress"},
    {"name": "practice", "description": "Practical tasks with AI feedback"},
    {"name": "progress", "description": "Dashboard and longitudinal progress"},
    {"name": "ai", "description": "AI subsystem status and explanations"},
    {"name": "admin", "description": "Content management, AI governance and statistics (admin only)"},
]


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Isker API",
        version="1.0.0",
        description=DESCRIPTION,
        openapi_tags=TAGS,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    install_error_handlers(app)
    for r in (auth, profile, assessments, competencies, plan, learning, practice, progress, admin):
        app.include_router(r.router)

    @app.get("/api/health", tags=["progress"], summary="Liveness and database check")
    def health() -> dict:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            ok = True
        except Exception:  # noqa: BLE001
            ok = False
        finally:
            db.close()
        return {"status": "ok" if ok else "degraded", "database": ok}

    if settings.static_dir:
        mount_spa(app, Path(settings.static_dir))
    return app


def mount_spa(app: FastAPI, root: Path) -> None:
    """Serve the built React app: real files when they exist, otherwise index.html (client-side routes)."""
    root = root.resolve()
    index = root / "index.html"
    if not index.is_file():
        logging.getLogger("isker").warning("STATIC_DIR %s has no index.html; SPA not served", root)
        return
    if (root / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Endpoint not found")
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(index)


app = create_app()
