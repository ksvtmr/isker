"""AI provider abstraction.

    AIProvider
        ├── OpenAIProvider   (AI_PROVIDER=openai or auto with OPENAI_API_KEY, MOCK_AI=false)
        ├── GeminiProvider   (AI_PROVIDER=gemini or auto with GEMINI_API_KEY, MOCK_AI=false)
        └── MockAIProvider   (MOCK_AI=true, the default; deterministic, no network)

Providers return raw text. Parsing and validation happen in `app.ai.service` so every provider
goes through the same governance path.
"""

from __future__ import annotations

import json
import re
import unicodedata
from abc import ABC, abstractmethod
from dataclasses import dataclass

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
# OpenAI provider (Chat Completions, JSON mode). Key is only ever read server-side.
# ---------------------------------------------------------------------------


class OpenAIProvider(AIProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str, base_url: str, timeout: float, analysis_timeout: float | None = None):
        self._key = api_key
        self.model = model
        self._base = base_url.rstrip("/")
        self._timeout = timeout
        self._analysis_timeout = analysis_timeout or timeout

    def _chat(self, system: str, user: str, timeout: float | None = None) -> str:
        try:
            r = httpx.post(
                f"{self._base}/chat/completions",
                headers={"Authorization": f"Bearer {self._key}"},
                json={
                    "model": self.model,
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                },
                timeout=timeout or self._timeout,
            )
        except httpx.HTTPError as e:
            raise AIProviderError(f"network error: {type(e).__name__}") from e
        if r.status_code == 429:
            raise AIProviderError("provider rate limit (HTTP 429)")
        if r.status_code >= 400:
            raise AIProviderError(f"provider returned HTTP {r.status_code}")
        try:
            return r.json()["choices"][0]["message"]["content"]
        except (KeyError, IndexError, ValueError) as e:
            raise AIProviderError("unexpected provider response shape") from e

    def evaluate(self, req: EvaluationRequest) -> str:
        return self._chat(req.system_prompt, req.user_prompt)

    def insight(self, req: InsightRequest) -> str:
        return self._chat(req.system_prompt, req.user_prompt)

    def analyze(self, req: InsightRequest) -> str:
        return self._chat(req.system_prompt, req.user_prompt, self._analysis_timeout)


# ---------------------------------------------------------------------------
# Google Gemini provider (Generative Language API, JSON output). The key goes in the x-goog-api-key header, never in
# the URL, and never appears in errors or logs.
# ---------------------------------------------------------------------------


class GeminiProvider(AIProvider):
    name = "gemini"

    def __init__(self, api_key: str, model: str, base_url: str, timeout: float, analysis_timeout: float | None = None):
        self._key = api_key
        self.model = model
        self._base = base_url.rstrip("/")
        self._timeout = timeout
        self._analysis_timeout = analysis_timeout or timeout

    def _generate(self, system: str, user: str, timeout: float | None = None) -> str:
        try:
            r = httpx.post(
                f"{self._base}/models/{self.model}:generateContent",
                headers={"x-goog-api-key": self._key},
                json={
                    "systemInstruction": {"parts": [{"text": system}]},
                    "contents": [{"role": "user", "parts": [{"text": user}]}],
                    "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
                },
                timeout=timeout or self._timeout,
            )
        except httpx.HTTPError as e:
            raise AIProviderError(f"network error: {type(e).__name__}") from e
        if r.status_code == 429:
            raise AIProviderError("provider rate limit (HTTP 429)")
        if r.status_code >= 400:
            raise AIProviderError(f"provider returned HTTP {r.status_code}")
        try:
            data = r.json()
            candidate = data["candidates"][0]
            text = "".join(part.get("text", "") for part in candidate["content"]["parts"])
        except (KeyError, IndexError, ValueError, TypeError) as e:
            blocked = isinstance(locals().get("data"), dict) and data.get("promptFeedback", {}).get("blockReason")
            reason = "response blocked by the provider" if blocked else "unexpected provider response shape"
            raise AIProviderError(reason) from e
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
    if provider == "gemini":
        return GeminiProvider(s.ai_key("gemini"), s.gemini_model, s.gemini_base_url, s.ai_timeout_seconds,
                              s.ai_analysis_timeout_seconds)
    if provider == "openai":
        return OpenAIProvider(s.ai_key("openai"), s.openai_model, s.openai_base_url, s.ai_timeout_seconds,
                              s.ai_analysis_timeout_seconds)
    return MockAIProvider()
