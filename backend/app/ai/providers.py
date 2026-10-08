"""AI provider abstraction.

    AIProvider
        ├── OpenAIProvider   (OPENAI_API_KEY set and MOCK_AI=false)
        └── MockAIProvider   (default; deterministic, no network)

Providers return raw text. Parsing and validation happen in `app.ai.service` so every provider
goes through the same governance path.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx

from app.core.config import get_settings


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


# ---------------------------------------------------------------------------
# Mock provider: deterministic rubric heuristics. Used in development and tests.
# ---------------------------------------------------------------------------

_WORD = re.compile(r"[A-Za-zА-Яа-яЁёҚқҒғҮүҰұӨөҺһІі0-9']+")


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text.strip())
    return [p.strip() for p in parts if len(p.strip()) > 3]


def heuristic_evaluation(competency_name: str, answer: str, rubric: list[dict]) -> dict:
    """Rate each rubric criterion 0–4 from answer length + criterion keyword evidence."""
    words = _WORD.findall(answer.lower())
    n = len(words)
    sents = _sentences(answer)
    criteria, evidence, strengths, dev = [], [], [], []
    for c in rubric:
        kws = [k.lower() for k in c.get("keywords", [])]
        hit_sents = [s for s in sents if any(k in s.lower() for k in kws)]
        hits = sum(1 for k in kws if k in answer.lower())
        rating = (1 if n >= 12 else 0) + (1 if n >= 40 else 0) + min(hits, 2)
        rating = max(0, min(4, rating))
        ev = hit_sents[0][:240] if hit_sents else ""
        criteria.append({"criterion": c["criterion"], "rating": rating, "evidence": ev})
        if rating >= 3:
            strengths.append(c["criterion"])
            if ev:
                evidence.append(f"“{ev}” — shows {c['criterion'].lower()}")
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
            f"Rated against {len(criteria)} rubric criteria. "
            + (f"Strongest: {', '.join(strengths[:2])}. " if strengths else "")
            + (f"Needs more detail on: {', '.join(dev[:2])}." if dev else "")
        ).strip(),
    }


def heuristic_insight(facts: dict) -> dict:
    strongest = facts.get("strongest") or {}
    gap = facts.get("top_gap") or {}
    resource = facts.get("top_resource")
    headline = f"Your strongest area is {strongest.get('name', 'not yet measured')}."
    if gap:
        body = (
            f"Your responses show the most confidence in {strongest.get('name')} "
            f"({strongest.get('score')} / 100). Your biggest development opportunity is "
            f"{gap['name']} ({gap['score']} / 100, target {gap['target']})."
        )
        next_step = (
            f"Start with “{resource}” to work on {gap['name']}."
            if resource
            else f"Open your development plan for {gap['name']}."
        )
    else:
        body = "All measured competencies meet your target. Keep practising to move up a level."
        next_step = "Pick a stretch goal in your lowest competency."
    return {"headline": headline, "body": body, "next_step": next_step, "confidence": 0.8}


class MockAIProvider(AIProvider):
    name = "mock"
    model = "mock-rubric-v1"

    def evaluate(self, req: EvaluationRequest) -> str:
        return json.dumps(heuristic_evaluation(req.competency_name, req.answer, req.rubric))

    def insight(self, req: InsightRequest) -> str:
        return json.dumps(heuristic_insight(req.facts))


# ---------------------------------------------------------------------------
# OpenAI provider (Chat Completions, JSON mode). Key is only ever read server-side.
# ---------------------------------------------------------------------------


class OpenAIProvider(AIProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str, base_url: str, timeout: float):
        self._key = api_key
        self.model = model
        self._base = base_url.rstrip("/")
        self._timeout = timeout

    def _chat(self, system: str, user: str) -> str:
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
                timeout=self._timeout,
            )
        except httpx.HTTPError as e:
            raise AIProviderError(f"network error: {type(e).__name__}") from e
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


def get_provider() -> AIProvider:
    s = get_settings()
    if s.use_mock_ai:
        return MockAIProvider()
    return OpenAIProvider(s.openai_api_key, s.openai_model, s.openai_base_url, s.ai_timeout_seconds)
