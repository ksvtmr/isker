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
    jwt_expires_minutes: int = 60 * 24
    auth_cookie_name: str = "isker_session"
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

    # Abuse protection
    rate_limit_enabled: bool = True
    max_request_bytes: int = 1_000_000

    # Payments (no provider is integrated yet; see app/services/payments.py)
    payment_provider: str = ""
    payment_webhook_secret: str = ""

    # Comma-separated in the environment (NoDecode: not parsed as JSON).
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173", "http://localhost:8080"]

    # AI
    mock_ai: bool = True
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    ai_timeout_seconds: float = 30.0
    ai_max_retries: int = 1

    # Seed / demo
    seed_demo: bool = True
    demo_email: str = "demo@isker.local"
    demo_password: str = ""
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
        # Render (and similar hosts) expose the public URL; use it for email links unless APP_BASE_URL is set.
        if "app_base_url" not in self.model_fields_set and os.environ.get("RENDER_EXTERNAL_URL"):
            self.app_base_url = os.environ["RENDER_EXTERNAL_URL"].rstrip("/")
        return self

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
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def use_mock_ai(self) -> bool:
        return self.mock_ai or not self.openai_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
