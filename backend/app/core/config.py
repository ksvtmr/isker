"""Application settings, loaded from environment variables (see `.env.example`)."""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore", case_sensitive=False)

    environment: str = Field(default="development", description="development | test | production")
    database_url: str = "postgresql+psycopg://isker:isker@localhost:5432/isker"

    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 60 * 24
    auth_cookie_name: str = "isker_session"
    cookie_secure: bool = False

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
        return self

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def use_mock_ai(self) -> bool:
        return self.mock_ai or not self.openai_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
