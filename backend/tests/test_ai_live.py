"""LIVE provider check: real HTTP calls to the configured AI provider. Skipped unless explicitly enabled.

    ISKER_LIVE_AI=1 GROQ_API_KEY=... GROQ_MODEL=... pytest tests/test_ai_live.py -s
    (or GEMINI_API_KEY / OPENAI_API_KEY with their *_MODEL)

The key is read from the environment only, sent in a header by the adapter and never printed. Each run makes 2-3 paid
requests. A pass shows that this key, model and prompt produce output our checks accept in Russian, Kazakh and
English; it does not show the model never hallucinates.
"""

from __future__ import annotations

import json
import os

import pytest
from sqlalchemy import select

import app.ai.analysis as analysis_mod
from app.ai.providers import GeminiProvider, GroqProvider, InsightRequest, OpenAIProvider
from app.ai.service import active_prompt, check_language
from app.core.context import language_var
from app.core.i18n import tr
from app.models import AssessmentAttempt, User
from tests.test_onboarding_analysis import complete_full, new_learner


def _live_provider():
    if os.environ.get("ISKER_LIVE_AI") != "1":
        return None
    for cls, key, model, base, default_base in (
        (GroqProvider, "GROQ_API_KEY", "GROQ_MODEL", "GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
        (GeminiProvider, "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_BASE_URL",
         "https://generativelanguage.googleapis.com/v1beta"),
        (OpenAIProvider, "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "https://api.openai.com/v1"),
    ):
        if os.environ.get(key) and os.environ.get(model):
            return cls(os.environ[key], os.environ[model], os.environ.get(base, default_base), 30,
                       analysis_timeout=120, retries=2, max_output_tokens=4096)
    return None


PROVIDER = _live_provider()
pytestmark = pytest.mark.skipif(PROVIDER is None, reason="live AI test: set ISKER_LIVE_AI=1 and a provider key+model")


@pytest.mark.parametrize("lang", ["ru", "kk", "en"])
def test_live_analysis_passes_grounding_and_language_checks(client, db, lang):
    assert PROVIDER is not None
    new_learner(client)
    att_id = complete_full(client)
    token = language_var.set(lang)
    try:
        user = db.scalar(select(User).where(User.email == "learner@example.com"))
        facts = analysis_mod.build_facts(db, user, db.get(AssessmentAttempt, att_id))
        _, system, user_tpl = active_prompt(db, analysis_mod.ANALYSIS_KEY)
        req = InsightRequest(facts, f"{system}\n\n{tr('analysis.language_instruction')}",
                             user_tpl.format(facts=json.dumps(facts, ensure_ascii=False)))
        raw = PROVIDER.analyze(req)
        out = analysis_mod.DevelopmentAnalysis.model_validate(json.loads(raw))
        analysis_mod.check_references(out, facts)
        check_language([out.summary], lang)
        check_language(analysis_mod._texts(out), lang)
        assert os.environ.get("GROQ_API_KEY", "x" * 8) not in raw
        print(f"\n{PROVIDER.name}/{PROVIDER.model} {lang}: claims="
              f"{len(out.strengths) + len(out.development_areas) + len(out.competency_insights)} "
              f"usage={PROVIDER.last_usage}")
    finally:
        language_var.reset(token)
