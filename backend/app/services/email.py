"""Email delivery boundary.

Backends
- smtp:     real delivery through SMTP (SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM).
- console:  development only — the message (including links) is written to the server log, NOT delivered.
- disabled: nothing is sent; callers must tell the user that email is not available.
`send()` returns a DeliveryResult so the API never claims an email was delivered when it was not.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage

from app.core.config import get_settings

log = logging.getLogger("isker.email")


@dataclass
class DeliveryResult:
    backend: str
    delivered: bool  # True only when handed to a real mail server


def backend_name() -> str:
    return get_settings().effective_email_backend


def is_available() -> bool:
    return backend_name() in ("smtp", "console")


def send(to: str, subject: str, text: str) -> DeliveryResult:
    s = get_settings()
    backend = backend_name()
    if backend == "smtp":
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = s.smtp_from, to, subject
        msg.set_content(text)
        try:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
                if s.smtp_starttls:
                    smtp.starttls(context=ssl.create_default_context())
                if s.smtp_username:
                    smtp.login(s.smtp_username, s.smtp_password)
                smtp.send_message(msg)
            return DeliveryResult("smtp", True)
        except (OSError, smtplib.SMTPException) as e:
            log.error("SMTP delivery failed: %s", type(e).__name__)
            return DeliveryResult("smtp", False)
    if backend == "console":
        log.warning("[DEV EMAIL — not delivered] To: %s | Subject: %s\n%s", to, subject, text)
        return DeliveryResult("console", False)
    log.info("Email backend disabled; message to %s not sent (%s)", to, subject)
    return DeliveryResult("disabled", False)
