"""Isker API — FastAPI application factory."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.routes import (
    admin,
    admin_billing,
    admin_system,
    admin_users,
    assessments,
    auth,
    billing,
    competencies,
    learning,
    oauth,
    plan,
    practice,
    profile,
    progress,
    sync,
)
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.errors import install_error_handlers
from app.core.middleware import BodySizeLimitMiddleware, RequestContextMiddleware, SecurityHeadersMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

DESCRIPTION = """
Isker assesses and develops entrepreneurial competencies (EntreComp, 15 competencies).

**Product loop:** Assess → Profile → Identify Gaps → Recommend → Learn → Practice → Re-assess → Track Progress.

**Authentication:** `POST /api/auth/login` sets an httpOnly session cookie (`isker_session`) and a readable CSRF
cookie (`isker_csrf`). Browsers must echo the CSRF cookie in an `X-CSRF-Token` header on POST/PUT/PATCH/DELETE.
API clients may instead send the returned token as `Authorization: Bearer <token>` (no CSRF header needed).
Every token is bound to a server-side session that can be revoked.

**Authorization:** role-based (user, content_manager, support, admin, super_admin) with permission checks on the
server. **Entitlements:** plan features are enforced by the server; a missing entitlement returns
`403 UPGRADE_REQUIRED`.

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
    {"name": "billing", "description": "Plans, entitlements, payment webhooks and data export"},
    {"name": "admin", "description": "Content management and AI governance (permission-based)"},
    {"name": "admin-users", "description": "User management, roles and account lifecycle (permission-based)"},
    {"name": "admin-billing", "description": "Plans and subscriptions administration (permission-based)"},
    {"name": "admin-system", "description": "Analytics, roles, audit logs and settings (permission-based)"},
]


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Isker API",
        version="1.0.0",
        description=DESCRIPTION,
        openapi_tags=TAGS,
        # Hidden in production unless API_DOCS_ENABLED=true (see core/config.py).
        docs_url="/api/docs" if settings.docs_enabled else None,
        redoc_url="/api/redoc" if settings.docs_enabled else None,
        openapi_url="/api/openapi.json" if settings.docs_enabled else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After"],
    )
    # Added last = runs first: request id/context → security headers → body size limit → CORS → routes.
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)
    for r in (auth, oauth, profile, assessments, competencies, plan, learning, practice, progress, billing, admin,
              admin_users, admin_billing, admin_system, sync):
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
