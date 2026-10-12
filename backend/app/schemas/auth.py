from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.enums import AccountStatus


def _strong(pw: str) -> str:
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        raise ValueError("Password must contain at least one letter and one number")
    return pw


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=120)
    accept_terms: bool = Field(description="Must be true: the user accepts the terms and the privacy notice")
    language: Literal["ru", "kk", "en"] | None = Field(default=None, description="Interface language to save")

    @field_validator("accept_terms")
    @classmethod
    def _terms(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("Accept the terms and privacy notice to create an account")
        return v

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _strong(v)

    @field_validator("full_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("Enter your name")
        return v

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()


class LoginIn(BaseModel):
    # Plain shape check: login must work for seeded accounts on reserved domains such as demo@isker.local.
    email: str = Field(min_length=3, max_length=255, pattern=r"^[^@\s]+@[^@\s]+$")
    password: str = Field(min_length=1, max_length=128)
    remember_me: bool = False

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _strong(v)


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    status: AccountStatus
    roles: list[str]
    permissions: list[str]
    onboarding_completed: bool
    email_verified: bool
    created_at: datetime
    language: str | None = None
    has_password: bool = True
    google_linked: bool = False


class AuthOut(BaseModel):
    user: UserOut
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    email_verification: str  # "verified" | "sent" | "logged" | "unavailable" | "not_required"


class EmailIn(BaseModel):
    email: str = Field(min_length=3, max_length=255, pattern=r"^[^@\s]+@[^@\s]+$")

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()


class TokenIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _strong(v)


class PasswordConfirmIn(BaseModel):
    # Empty for accounts without a password (Google-only): a recent sign-in is required instead.
    password: str = Field(default="", max_length=128)


class LanguageIn(BaseModel):
    language: Literal["ru", "kk", "en"]


class SetPasswordIn(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _strong(v)


class SessionOut(BaseModel):
    id: str
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    user_agent: str | None
    ip_address: str | None
    current: bool
    remember: bool = False
    auth_method: str = "password"
