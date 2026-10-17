"""Sliding-window rate limiter.

In-process storage: correct for a single API instance (the default deployment). Running several instances
requires a shared store (e.g. Redis) — documented as a residual risk.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from app.core.config import get_settings
from app.core.errors import AppError


class RateLimited(AppError):
    status_code = 429
    code = "RATE_LIMITED"


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._calls = 0

    def hit(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        """Record a hit; return (allowed, retry_after_seconds)."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window_seconds:
                q.popleft()
            if len(q) >= limit:
                return False, max(1, int(window_seconds - (now - q[0])))
            q.append(now)
            self._calls += 1
            if self._calls % 1000 == 0:
                self._prune(now)
            return True, 0

    def blocked(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        """Like `hit` but without recording anything: (blocked, retry_after_seconds)."""
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if not q:
                return False, 0
            while q and q[0] <= now - window_seconds:
                q.popleft()
            if len(q) >= limit:
                return True, max(1, int(window_seconds - (now - q[0])))
            return False, 0

    def add(self, key: str) -> None:
        """Record a hit without checking the limit (used for failure-only counters)."""
        with self._lock:
            self._hits[key].append(time.monotonic())
            self._calls += 1
            if self._calls % 1000 == 0:
                self._prune(time.monotonic())

    def _prune(self, now: float) -> None:
        """Drop keys whose newest hit is older than the longest window (bounded memory under key spraying)."""
        horizon = now - MAX_WINDOW
        for key in [k for k, q in self._hits.items() if not q or q[-1] <= horizon]:
            del self._hits[key]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter()

# name: (limit, window seconds)
RULES = {
    "login_ip": (20, 300),
    # Failed sign-ins only (see check/record_failure): per email + IP, and a softer per-email cap across all IPs,
    # so a published (demo/admin) email can't be locked out by a single client or by successful sign-ins.
    "login_email_ip": (8, 900),
    "login_email": (30, 900),
    "register_ip": (10, 3600),
    "forgot_ip": (10, 3600),
    "forgot_email": (3, 3600),
    "reset_ip": (20, 3600),
    "verify_ip": (30, 3600),
    "resend_user": (3, 3600),
    "password_change_user": (10, 3600),
    "oauth_ip": (30, 600),
    # AI evaluations (cost control): practice feedback / submissions per user.
    "ai_user": (30, 3600),
}
MAX_WINDOW = max(w for _, w in RULES.values())


def _limited(retry: int) -> RateLimited:
    minutes = max(1, retry // 60)
    return RateLimited(f"Too many attempts. Please try again in about {minutes} minute{'s' if minutes > 1 else ''}.",
                       details={"retry_after_seconds": retry})


def enforce(rule: str, subject: str | None) -> None:
    """Count this request and refuse it once the rule's limit is reached."""
    if not get_settings().rate_limit_enabled or not subject:
        return
    limit, window = RULES[rule]
    ok, retry = limiter.hit(f"{rule}:{subject.lower()}", limit, window)
    if not ok:
        raise _limited(retry)


def check(rule: str, subject: str | None) -> None:
    """Refuse if earlier recorded failures reached the limit; does not count this request."""
    if not get_settings().rate_limit_enabled or not subject:
        return
    limit, window = RULES[rule]
    blocked, retry = limiter.blocked(f"{rule}:{subject.lower()}", limit, window)
    if blocked:
        raise _limited(retry)


def record_failure(rule: str, subject: str | None) -> None:
    """Count a failed attempt for a failure-only rule (checked with `check`)."""
    if not get_settings().rate_limit_enabled or not subject:
        return
    limiter.add(f"{rule}:{subject.lower()}")
