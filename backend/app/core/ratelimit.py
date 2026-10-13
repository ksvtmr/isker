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
    "login_email": (8, 900),
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


def enforce(rule: str, subject: str | None) -> None:
    if not get_settings().rate_limit_enabled or not subject:
        return
    limit, window = RULES[rule]
    ok, retry = limiter.hit(f"{rule}:{subject.lower()}", limit, window)
    if not ok:
        minutes = max(1, retry // 60)
        raise RateLimited(f"Too many attempts. Please try again in about {minutes} minute{'s' if minutes > 1 else ''}.",
                          details={"retry_after_seconds": retry})
