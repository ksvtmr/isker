"""Application settings, loaded from environment variables (see `.env.example`)."""

from __future__ import annotations

import os
import secrets
from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore", case_sensitive=False)

    environment: str = Field(default="development", description="development | test | production")
    database_url: str = "postgresql+psycopg://isker:isker@localhost:5432/isker"
    # Optional: directory with the built frontend (index.html). When set, the API also serves the SPA,
    # so a single service hosts the whole platform (used by the one-click Render deployment).
    static_dir: str = ""

    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    # Sessions (see docs/authentication.md). Without "Remember me" the cookie lasts until the browser closes and the
    # session expires after SESSION_HOURS; with it the cookie and session last REMEMBER_ME_DAYS.
    session_hours: int = 12
    remember_me_days: int = 30
    # The session token is re-issued (rotated) after this many minutes of use; replaying an older token is detected.
    token_rotate_minutes: int = 60
    # Google OpenID Connect: client id and secret enable "Continue with Google" (docs/google-oauth-setup.md).
    google_client_id: str = ""
    google_client_secret: str = ""
    # Exact URI registered in Google Cloud. Empty = {APP_BASE_URL}/api/auth/google/callback.
    google_redirect_uri: str = ""
    auth_cookie_name: str = "isker_session"
    # Number of trusted reverse proxies that append to X-Forwarded-For (Render, nginx). 0 = API exposed directly.
    trusted_proxy_hops: int = 1
    csrf_cookie_name: str = "isker_csrf"
    # None = automatic: Secure cookies in production, plain cookies in development (http://localhost).
    cookie_secure: bool | None = None

    # Public URL of the web app; used to build links in emails (verification, password reset).
    app_base_url: str = "http://localhost:5173"
    # Email: auto | smtp | console | disabled. auto = smtp when SMTP_HOST is set, console in development,
    # otherwise disabled. "console" writes emails to the server log and is refused in production.
    email_backend: str = "auto"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "Isker <no-reply@isker.local>"
    smtp_starttls: bool = True
    # When true, unverified accounts can't sign in (only enable once email delivery works).
    require_email_verification: bool = False
    verification_token_hours: int = 48
    reset_token_minutes: int = 60
    terms_version: str = "2026-10"

    # Interactive API docs (/api/docs, /api/redoc, /api/openapi.json). None = automatic: on outside production,
    # off in production unless API_DOCS_ENABLED=true.
    api_docs_enabled: bool | None = None

    # Abuse protection
    rate_limit_enabled: bool = True
    max_request_bytes: int = 1_000_000

    # Payments (no provider is integrated yet; see app/services/payments.py)
    payment_provider: str = ""
    payment_webhook_secret: str = ""

    # Comma-separated in the environment (NoDecode: not parsed as JSON).
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173", "http://localhost:8080"]

    # AI. Provider keys are backend-only secrets: read from the environment (or the host's secret store), never sent
    # to the browser, put in URLs or logged. See docs/security/api-key-management.md.
    # MOCK_AI=true: the built-in deterministic provider (no network). Otherwise AI_PROVIDER picks the provider:
    # "openai", "gemini", or "auto" (the one whose key is set). A missing key is a startup error, never a silent mock.
    mock_ai: bool = True
    ai_provider: str = "auto"
    # Generic key for the selected provider, used when its own variable below is empty (needs AI_PROVIDER).
    ai_api_key: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    ai_timeout_seconds: float = 30.0
    # The development analysis is one larger request (whole profile + catalog); it gets more time.
    ai_analysis_timeout_seconds: float = 90.0
    ai_max_retries: int = 1

    # Seed / demo
    seed_demo: bool = True
    demo_email: str = "demo@isker.local"
    demo_password: str = ""
    # The demo account's password is public: block changes to its password, email, sign-in methods and status
    # through the account itself (see services/accounts.assert_not_demo).
    demo_read_only: bool = True
    admin_email: str = "admin@isker.local"
    admin_password: str = ""

    @field_validator("database_url")
    @classmethod
    def _psycopg_driver(cls, v: str) -> str:
        # Hosting providers hand out postgres:// URLs; SQLAlchemy needs the psycopg 3 driver name.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix) :]
        return v

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip().startswith("["):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @model_validator(mode="after")
    def _check_secrets(self) -> Settings:
        if not self.jwt_secret:
            if self.is_production:
                raise ValueError("JWT_SECRET must be set in production")
            # Development/test only: an ephemeral secret (sessions reset on restart).
            self.jwt_secret = secrets.token_urlsafe(48)
        if self.is_production and len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters in production")
        if any(o.strip() == "*" for o in self.cors_origins):
            raise ValueError("CORS_ORIGINS must list explicit origins; '*' is not allowed with credentials")
        if self.is_production and self.email_backend == "console":
            raise ValueError("EMAIL_BACKEND=console is for development only")
        provider = self.ai_provider.strip().lower()
        if provider not in ("auto", "mock", "openai", "gemini"):
            raise ValueError("AI_PROVIDER must be auto, mock, openai or gemini")
        if not self.mock_ai and provider != "mock":
            if provider == "auto" and self.ai_api_key and not (self.openai_api_key or self.gemini_api_key):
                raise ValueError("AI_API_KEY is set: also set AI_PROVIDER=openai or AI_PROVIDER=gemini")
            if provider in ("openai", "gemini") and not self.ai_key(provider):
                raise ValueError(f"AI_PROVIDER={provider} needs {provider.upper()}_API_KEY (or AI_API_KEY)")
            if provider == "auto" and not (self.openai_api_key or self.gemini_api_key) and self.is_production:
                raise ValueError("MOCK_AI=false but no AI key is configured (GEMINI_API_KEY or OPENAI_API_KEY)")
        if self.is_production and self.cookie_secure is False:
            raise ValueError("COOKIE_SECURE=false is not allowed in production (session cookies need HTTPS)")
        if self.is_production:
            # Development origins are never trusted in production.
            self.cors_origins = [o for o in self.cors_origins if "localhost" not in o and "127.0.0.1" not in o]
        # Render (and similar hosts) expose the public URL; use it for email links unless APP_BASE_URL is set.
        if "app_base_url" not in self.model_fields_set and os.environ.get("RENDER_EXTERNAL_URL"):
            self.app_base_url = os.environ["RENDER_EXTERNAL_URL"].rstrip("/")
        return self

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def google_callback_url(self) -> str:
        return self.google_redirect_uri or f"{self.app_base_url.rstrip('/')}/api/auth/google/callback"

    @property
    def secure_cookies(self) -> bool:
        return self.is_production if self.cookie_secure is None else self.cookie_secure

    @property
    def effective_email_backend(self) -> str:
        if self.email_backend != "auto":
            return self.email_backend
        if self.smtp_host:
            return "smtp"
        return "disabled" if self.is_production else "console"

    @property
    def docs_enabled(self) -> bool:
        return not self.is_production if self.api_docs_enabled is None else self.api_docs_enabled

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    def ai_key(self, provider: str) -> str:
        own = {"openai": self.openai_api_key, "gemini": self.gemini_api_key}.get(provider, "")
        return own or self.ai_api_key

    @property
    def resolved_ai_provider(self) -> str:
        """mock, openai or gemini. Outside production, MOCK_AI=false without any key still means mock (dev)."""
        provider = self.ai_provider.strip().lower()
        if self.mock_ai or provider == "mock":
            return "mock"
        if provider in ("openai", "gemini"):
            return provider
        if self.gemini_api_key:
            return "gemini"
        return "openai" if self.openai_api_key else "mock"

    @property
    def use_mock_ai(self) -> bool:
        return self.resolved_ai_provider == "mock"

    @property
    def ai_model(self) -> str | None:
        return {"openai": self.openai_model, "gemini": self.gemini_model}.get(self.resolved_ai_provider)


@lru_cache
def get_settings() -> Settings:
    return Settings()
