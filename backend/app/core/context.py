"""Per-request context (request id, client IP) available to services such as the audit log."""

from __future__ import annotations

from contextvars import ContextVar

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
client_ip_var: ContextVar[str | None] = ContextVar("client_ip", default=None)
user_agent_var: ContextVar[str | None] = ContextVar("user_agent", default=None)
# Interface language of the request (from Accept-Language): "ru" | "kk" | "en". Used for content and emails.
language_var: ContextVar[str] = ContextVar("language", default="ru")
# Whether database content (competencies, questions, resources, …) is shown in `language_var`. Off by default so
# seeding, background jobs and the admin content editor always work with the stored base text (English).
content_localization_var: ContextVar[bool] = ContextVar("content_localization", default=False)
