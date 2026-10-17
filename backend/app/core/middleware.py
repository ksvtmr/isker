"""HTTP hardening middleware: request ids, security headers, request size limit."""

from __future__ import annotations

import re
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings
from app.core.context import (
    client_ip_var,
    content_localization_var,
    language_var,
    request_id_var,
    user_agent_var,
)
from app.core.errors import error_body

_RID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

# The SPA uses inline style attributes (design-system components), hence 'unsafe-inline' for styles only.
CSP_APP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
    "base-uri 'self'; form-action 'self'; object-src 'none'"
)
# Swagger/ReDoc load their assets from jsDelivr.
CSP_DOCS = (
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; "
    "frame-ancestors 'none'; object-src 'none'"
)


SUPPORTED_LANGUAGES = ("ru", "kk", "en")


def parse_language(header: str | None, default: str = "ru") -> str:
    """First supported language in an Accept-Language header ("kk-KZ,ru;q=0.8" → "kk")."""
    for part in (header or "").split(","):
        tag = part.split(";")[0].strip().lower().replace("_", "-").split("-")[0]
        if tag == "kz":
            tag = "kk"
        if tag in SUPPORTED_LANGUAGES:
            return tag
    return default


# Admin screens that edit content work on the stored base text and its translations, never on a localized copy.
CONTENT_EDITOR_PATHS = tuple(
    f"/api/admin/{p}" for p in ("competencies", "questions", "assessments", "resources", "tasks", "plans")
)


def client_ip(request: Request) -> str | None:
    """The address of the client as seen by our own proxy.

    X-Forwarded-For is client-controlled except for the entries appended by trusted proxies, so the address is taken
    TRUSTED_PROXY_HOPS entries from the right (default 1: Render / nginx in front of the API). With 0 hops (direct
    exposure) the header is ignored. Never use the left-most entry: anyone can set it and dodge rate limits.
    """
    hops = get_settings().trusted_proxy_hops
    direct = request.client.host if request.client else None
    if hops <= 0:
        return direct
    raw = request.headers.get("x-forwarded-for", "")
    chain = [p.strip() for p in raw.split(",") if p.strip()]
    if not chain:
        return direct
    return chain[-hops] if len(chain) >= hops else chain[0]


# Machine-to-machine callers (payment webhooks) send no Accept-Language; whatever they write must be the base text.
# The translation completeness report compares the stored base text with its translations.
NON_LOCALIZED_PATHS = ("/api/billing/webhooks", "/api/admin/translations")


def localizes_content(path: str) -> bool:
    return path.startswith("/api/") and not path.startswith((*CONTENT_EDITOR_PATHS, *NON_LOCALIZED_PATHS))


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = request.headers.get("x-request-id", "")
        rid = incoming if _RID.match(incoming) else uuid.uuid4().hex
        request_id_var.set(rid)
        client_ip_var.set(client_ip(request))
        user_agent_var.set((request.headers.get("user-agent") or "")[:255] or None)
        language_var.set(parse_language(request.headers.get("accept-language")))
        content_localization_var.set(localizes_content(request.url.path))
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        path = request.url.path
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        h.setdefault("Content-Security-Policy", CSP_DOCS if path.startswith(("/api/docs", "/api/redoc")) else CSP_APP)
        if path.startswith("/api/"):
            h.setdefault("Cache-Control", "no-store")
            h["Vary"] = ", ".join(v for v in (h.get("Vary"), "Accept-Language") if v)
        if get_settings().secure_cookies:
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response


class BodySizeLimitMiddleware:
    """Reject request bodies larger than MAX_REQUEST_BYTES (checks Content-Length and the streamed size)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = get_settings().max_request_bytes
        too_big = JSONResponse(error_body("PAYLOAD_TOO_LARGE", "The request is too large."), status_code=413)
        for name, value in scope.get("headers", []):
            if name == b"content-length" and value.isdigit() and int(value) > limit:
                await too_big(scope, receive, send)
                return
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _TooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _TooLarge:
            await too_big(scope, receive, send)


class _TooLarge(Exception):
    pass
