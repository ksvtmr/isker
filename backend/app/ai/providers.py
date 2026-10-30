"""AI provider abstraction.

    AIProvider
        ├── GroqProvider     (AI_PROVIDER=groq or auto with GROQ_API_KEY; GROQ_MODEL required, MOCK_AI=false)
        ├── OpenAIProvider   (AI_PROVIDER=openai or auto with OPENAI_API_KEY, MOCK_AI=false)
        ├── GeminiProvider   (AI_PROVIDER=gemini or auto with GEMINI_API_KEY, MOCK_AI=false)
        └── MockAIProvider   (MOCK_AI=true, the default; deterministic, no network)

Providers return raw text. Parsing and validation happen in `app.ai.service` so every provider
goes through the same governance path.
"""

from __future__ import annotations

import json
import random
import re
import time
import unicodedata
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.content_i18n import normalize
from app.core.i18n import tr


@dataclass
class EvaluationRequest:
    competency_name: str
    question: str
    answer: str
    rubric: list[dict]
    system_prompt: str
    user_prompt: str


@dataclass
class InsightRequest:
    facts: dict
    system_prompt: str
    user_prompt: str


class AIProviderError(Exception):
    pass


class AIProvider(ABC):
    name: str = "abstract"
    model: str = "none"

    @abstractmethod
    def evaluate(self, req: EvaluationRequest) -> str: ...

    @abstractmethod
    def insight(self, req: InsightRequest) -> str: ...

    def analyze(self, req: InsightRequest) -> str:
        """Development analysis of a completed assessment (app/ai/analysis.py): raw JSON text."""
        raise AIProviderError(f"{self.name} does not support the development analysis")


# ---------------------------------------------------------------------------
# Mock provider: deterministic rubric heuristics. Used in development and tests.
# ---------------------------------------------------------------------------

# Letters and digits of any script (Latin, Russian and Kazakh Cyrillic incl. Ә Ғ Қ Ң Ө Ұ Ү Һ І), apostrophes inside.
_WORD = re.compile(r"[^\W_]+(?:'[^\W_]+)*")


def tokens(text: str) -> list[str]:
    return [normalize(t) for t in _WORD.findall(unicodedata.normalize("NFC", text or ""))]


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text.strip())
    return [p.strip() for p in parts if len(p.strip()) > 3]


def keyword_hits(text: str, keywords: list[str]) -> int:
    """Distinct answer words (or phrases) that start with a keyword stem.

    A word is counted once however many keywords (of any language) match it, and repeating a word doesn't add more.
    Multi-word keywords match consecutive words; keywords without letters or digits ("%", "-") match as substrings.
    """
    toks = tokens(text)
    flat = normalize(text)
    claimed: set[int] = set()
    units: set[tuple[str, ...]] = set()
    symbols = 0
    stems = sorted({tuple(tokens(k)) or (normalize(k),) for k in keywords if normalize(k)}, key=len, reverse=True)
    for stem in stems:
        if not tokens(" ".join(stem)):
            symbols += 1 if stem[0] in flat else 0
            continue
        n = len(stem)
        for i in range(len(toks) - n + 1):
            span = range(i, i + n)
            if any(j in claimed for j in span):
                continue
            if all(toks[i + m].startswith(stem[m]) for m in range(n)):
                claimed.update(span)
                units.add(tuple(toks[j] for j in span))
    return len(units) + symbols


def heuristic_evaluation(
    competency_name: str, answer: str, rubric: list[dict], ratings: list[int | None] | None = None
) -> dict:
    """Rate each rubric criterion 0–4 from answer length + criterion keyword evidence.

    `ratings` (by rubric position) re-renders a stored evaluation: the given ratings are kept and only the texts are
    composed again, in the current language.
    """
    n = len(tokens(answer))
    sents = _sentences(answer)
    criteria, evidence, strengths, dev = [], [], [], []
    for i, c in enumerate(rubric):
        kws = list(c.get("keywords", []))
        hit_sents = [s for s in sents if keyword_hits(s, kws)]
        hits = keyword_hits(answer, kws)
        rating = (1 if n >= 12 else 0) + (1 if n >= 40 else 0) + min(hits, 2)
        if ratings is not None and i < len(ratings) and ratings[i] is not None:
            rating = int(ratings[i])  # type: ignore[arg-type]
        rating = max(0, min(4, rating))
        ev = hit_sents[0][:240] if hit_sents else ""
        criteria.append({"criterion": c["criterion"], "rating": rating, "evidence": ev})
        if rating >= 3:
            strengths.append(c["criterion"])
            if ev:
                evidence.append(tr("ai.shows", quote=ev, criterion=c["criterion"].lower()))
        elif rating <= 1:
            dev.append(c["criterion"])
    if not evidence and sents:
        evidence.append(f"“{sents[0][:200]}”")
    score = round(sum(c["rating"] for c in criteria) / (4 * len(criteria)) * 100) if criteria else 0
    confidence = round(min(0.9, 0.55 + min(n, 120) / 400), 2)
    return {
        "competency": competency_name,
        "score": score,
        "level": "",
        "confidence": confidence,
        "criteria": criteria,
        "evidence": evidence[:4],
        "strengths": strengths[:4],
        "development_areas": dev[:4],
        "explanation": (
            tr("ai.rated", n=len(criteria))
            + (tr("ai.strongest", names=", ".join(strengths[:2])) if strengths else "")
            + (tr("ai.needs_detail", names=", ".join(dev[:2])) if dev else "")
        ).strip(),
    }


def heuristic_insight(facts: dict) -> dict:
    strongest = facts.get("strongest") or {}
    gap = facts.get("top_gap") or {}
    resource = facts.get("top_resource")
    headline = tr("insight.headline", name=strongest.get("name") or tr("insight.not_measured"))
    if gap:
        body = tr(
            "insight.body",
            name=strongest.get("name"),
            score=strongest.get("score"),
            gap=gap["name"],
            gap_score=gap["score"],
            target=gap["target"],
        )
        next_step = (
            tr("insight.next_resource", resource=resource, gap=gap["name"])
            if resource
            else tr("insight.next_plan", gap=gap["name"])
        )
    else:
        body = tr("insight.all_met")
        next_step = tr("insight.stretch")
    return {"headline": headline, "body": body, "next_step": next_step, "confidence": 0.8}


class MockAIProvider(AIProvider):
    name = "mock"
    model = "mock-rubric-v1"

    def evaluate(self, req: EvaluationRequest) -> str:
        return json.dumps(heuristic_evaluation(req.competency_name, req.answer, req.rubric))

    def insight(self, req: InsightRequest) -> str:
        return json.dumps(heuristic_insight(req.facts))

    def analyze(self, req: InsightRequest) -> str:
        from app.ai.analysis import heuristic_analysis

        return json.dumps(heuristic_analysis(req.facts))


# ---------------------------------------------------------------------------
# HTTP providers. Keys are only ever read server-side and sent in headers; errors carry status codes only, never
# response bodies (which could echo request data) or keys.
# ---------------------------------------------------------------------------

TRANSIENT_STATUS = {408, 409, 425, 500, 502, 503, 504}
MAX_RETRY_AFTER = 10.0  # seconds; a longer provider back-off is reported as rate limited instead of waited out


class _HTTPProvider(AIProvider):
    """Shared transport: timeout per call, limited retries with exponential backoff and jitter for transient
    failures (network errors, 5xx, 429 with a short Retry-After), token usage of the last call."""

    def __init__(self, api_key: str, model: str, base_url: str, timeout: float, analysis_timeout: float | None = None,
                 retries: int = 2, max_output_tokens: int = 4096):
        self._key = api_key
        self.model = model
        self._base = base_url.rstrip("/")
        self._timeout = timeout
        self._analysis_timeout = analysis_timeout or timeout
        self._retries = max(0, retries)
        self._max_output = max_output_tokens
        self.last_usage: dict | None = None

    def _post(self, url: str, headers: dict, body: dict, timeout: float) -> httpx.Response:
        attempt = 0
        while True:
            try:
                r = httpx.post(url, headers=headers, json=body, timeout=timeout)
            except httpx.HTTPError as e:
                if attempt < self._retries:
                    attempt += 1
                    _sleep_backoff(attempt)
                    continue
                raise AIProviderError(f"network error: {type(e).__name__}") from e
            if r.status_code == 429:
                wait = _retry_after(r)
                if attempt < self._retries and wait is not None and wait <= MAX_RETRY_AFTER:
                    attempt += 1
                    time.sleep(wait + random.uniform(0, 0.5))  # noqa: S311 - jitter, not cryptography
                    continue
                raise AIProviderError("provider rate limit (HTTP 429)")
            if r.status_code in TRANSIENT_STATUS and attempt < self._retries:
                attempt += 1
                _sleep_backoff(attempt)
                continue
            if r.status_code >= 400:
                raise AIProviderError(f"provider returned HTTP {r.status_code}")
            return r


def _sleep_backoff(attempt: int) -> None:
    time.sleep(min(8.0, 0.5 * 2 ** (attempt - 1)) + random.uniform(0, 0.25))  # noqa: S311 - jitter


def _retry_after(r: httpx.Response) -> float | None:
    try:
        return float(r.headers.get("retry-after", ""))
    except ValueError:
        return None


class OpenAIProvider(_HTTPProvider):
    """OpenAI Chat Completions (JSON mode). Also the base of providers with the same documented API."""

    name = "openai"

    def _chat(self, system: str, user: str, timeout: float | None = None) -> str:
        r = self._post(
            f"{self._base}/chat/completions",
            {"Authorization": f"Bearer {self._key}"},
            {
                "model": self.model,
                "temperature": 0,
                "max_completion_tokens": self._max_output,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            },
            timeout or self._timeout,
        )
        try:
            data = r.json()
            choice = data["choices"][0]
            text = choice["message"]["content"]
        except (KeyError, IndexError, ValueError, TypeError) as e:
            raise AIProviderError("unexpected provider response shape") from e
        usage = data.get("usage") or {}
        self.last_usage = {k: usage.get(k) for k in ("prompt_tokens", "completion_tokens", "total_tokens")}
        if choice.get("finish_reason") == "length":
            raise AIProviderError("provider response truncated (output limit)")
        if not text or not str(text).strip():
            raise AIProviderError("empty provider response")
        return str(text)

    def evaluate(self, req: EvaluationRequest) -> str:
        return self._chat(req.system_prompt, req.user_prompt)

    def insight(self, req: InsightRequest) -> str:
        return self._chat(req.system_prompt, req.user_prompt)

    def analyze(self, req: InsightRequest) -> str:
        return self._chat(req.system_prompt, req.user_prompt, self._analysis_timeout)


class GroqProvider(OpenAIProvider):
    """Groq: the official OpenAI-compatible Chat Completions API (https://api.groq.com/openai/v1), JSON mode.
    The model is never assumed: GROQ_MODEL must name a model available to the key (scripts/ai_models.py lists them)."""

    name = "groq"


# ---------------------------------------------------------------------------
# Google Gemini provider (Generative Language API, JSON output). The key goes in the x-goog-api-key header, never in
# the URL, and never appears in errors or logs.
# ---------------------------------------------------------------------------


class GeminiProvider(_HTTPProvider):
    name = "gemini"

    def _generate(self, system: str, user: str, timeout: float | None = None) -> str:
        r = self._post(
            f"{self._base}/models/{self.model}:generateContent",
            {"x-goog-api-key": self._key},
            {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {"temperature": 0, "responseMimeType": "application/json",
                                     "maxOutputTokens": self._max_output},
            },
            timeout or self._timeout,
        )
        data = None
        try:
            data = r.json()
            candidate = data["candidates"][0]
            text = "".join(part.get("text", "") for part in candidate["content"]["parts"])
        except (KeyError, IndexError, ValueError, TypeError) as e:
            blocked = isinstance(data, dict) and data.get("promptFeedback", {}).get("blockReason")
            reason = "response blocked by the provider" if blocked else "unexpected provider response shape"
            raise AIProviderError(reason) from e
        meta = data.get("usageMetadata") or {}
        self.last_usage = {"prompt_tokens": meta.get("promptTokenCount"),
                           "completion_tokens": meta.get("candidatesTokenCount"),
                           "total_tokens": meta.get("totalTokenCount")}
        if candidate.get("finishReason") == "MAX_TOKENS":
            raise AIProviderError("provider response truncated (output limit)")
        if not text.strip():
            raise AIProviderError("empty provider response")
        return text

    def evaluate(self, req: EvaluationRequest) -> str:
        return self._generate(req.system_prompt, req.user_prompt)

    def insight(self, req: InsightRequest) -> str:
        return self._generate(req.system_prompt, req.user_prompt)

    def analyze(self, req: InsightRequest) -> str:
        return self._generate(req.system_prompt, req.user_prompt, self._analysis_timeout)


def get_provider() -> AIProvider:
    s = get_settings()
    provider = s.resolved_ai_provider
    common: dict[str, Any] = dict(timeout=s.ai_timeout_seconds, analysis_timeout=s.ai_analysis_timeout_seconds,
                                  retries=s.ai_transport_retries, max_output_tokens=s.ai_max_output_tokens)
    if provider == "groq":
        return GroqProvider(s.ai_key("groq"), s.groq_model, s.groq_base_url, **common)
    if provider == "gemini":
        return GeminiProvider(s.ai_key("gemini"), s.gemini_model, s.gemini_base_url, **common)
    if provider == "openai":
        return OpenAIProvider(s.ai_key("openai"), s.openai_model, s.openai_base_url, **common)
    return MockAIProvider()
