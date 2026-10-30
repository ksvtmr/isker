"""Provider transport: Groq adapter, retries with backoff, Retry-After, output limits, key hygiene.

All HTTP here is MOCKED (httpx.post replaced); no request leaves the process. The live check is
tests/test_ai_live.py, skipped unless a real key is configured."""

import httpx
import pytest

from app.ai import providers as providers_mod
from app.ai.providers import AIProviderError, GroqProvider, MockAIProvider, OpenAIProvider, get_provider
from app.core import config
from app.core.config import Settings

FAKE_KEY = "gsk_test_000000000000000000000000000000000000"  # not a real key
REQ = type("R", (), {"system_prompt": "s", "user_prompt": "u"})()


def ok(text='{"ok": 1}', finish="stop"):
    return httpx.Response(200, json={"choices": [{"message": {"content": text}, "finish_reason": finish}],
                                     "usage": {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}})


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    waits: list[float] = []
    monkeypatch.setattr(providers_mod.time, "sleep", waits.append)
    return waits


def sequence(monkeypatch, responses):
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):  # MOCKED HTTP
        calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        item = responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(providers_mod.httpx, "post", fake_post)
    return calls


def groq(**kw):
    return GroqProvider(FAKE_KEY, "some-model", "https://api.groq.com/openai/v1", 5, **kw)


def test_groq_uses_the_official_openai_compatible_endpoint_and_bearer_header(monkeypatch):
    calls = sequence(monkeypatch, [ok()])
    p = groq(analysis_timeout=60, max_output_tokens=900)
    assert p.analyze(REQ) == '{"ok": 1}'
    call = calls[0]
    assert call["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert call["headers"] == {"Authorization": f"Bearer {FAKE_KEY}"}
    assert FAKE_KEY not in call["url"] and FAKE_KEY not in str(call["json"])
    body = call["json"]
    assert body["model"] == "some-model" and body["temperature"] == 0
    assert body["response_format"] == {"type": "json_object"} and body["max_completion_tokens"] == 900
    assert call["timeout"] == 60  # the analysis has its own, longer timeout
    assert p.last_usage == {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}
    assert p.name == "groq"


def test_transient_errors_are_retried_with_backoff_then_succeed(monkeypatch, no_sleep):
    calls = sequence(monkeypatch, [httpx.ConnectError("down"), httpx.Response(503), ok()])
    assert groq(retries=2).evaluate(REQ) == '{"ok": 1}'
    assert len(calls) == 3 and len(no_sleep) == 2
    assert 0.5 <= no_sleep[0] <= 0.75 and 1.0 <= no_sleep[1] <= 1.25  # exponential, with jitter


def test_retries_are_limited(monkeypatch, no_sleep):
    calls = sequence(monkeypatch, [httpx.Response(500)] * 3)
    with pytest.raises(AIProviderError, match="HTTP 500"):
        groq(retries=2).evaluate(REQ)
    assert len(calls) == 3


def test_client_errors_are_not_retried_and_do_not_leak_the_key(monkeypatch):
    for status in (400, 401, 403, 404):
        calls = sequence(monkeypatch, [httpx.Response(status, json={"error": {"message": f"bad key {FAKE_KEY}"}})])
        with pytest.raises(AIProviderError) as e:
            groq().evaluate(REQ)
        assert len(calls) == 1 and str(e.value) == f"provider returned HTTP {status}"
        assert FAKE_KEY not in repr(e.value)


def test_429_short_retry_after_is_waited_long_one_is_reported(monkeypatch, no_sleep):
    sequence(monkeypatch, [httpx.Response(429, headers={"retry-after": "2"}), ok()])
    assert groq().evaluate(REQ) == '{"ok": 1}'
    assert 2 <= no_sleep[0] <= 2.5

    calls = sequence(monkeypatch, [httpx.Response(429, headers={"retry-after": "120"})])
    with pytest.raises(AIProviderError, match="rate limit"):
        groq().evaluate(REQ)
    assert len(calls) == 1

    calls = sequence(monkeypatch, [httpx.Response(429)])  # no Retry-After: do not hammer the provider
    with pytest.raises(AIProviderError, match="rate limit"):
        groq().evaluate(REQ)
    assert len(calls) == 1


@pytest.mark.parametrize("response, message", [
    (ok(finish="length"), "truncated"),
    (ok(text="  "), "empty"),
    (httpx.Response(200, json={"unexpected": True}), "shape"),
    (httpx.Response(200, text="<html>"), "shape"),
])
def test_bad_responses_are_controlled_errors(monkeypatch, response, message):
    sequence(monkeypatch, [response])
    with pytest.raises(AIProviderError, match=message):
        groq().evaluate(REQ)


def test_config_requires_an_explicit_groq_model_and_never_guesses():
    with pytest.raises(ValueError, match="GROQ_MODEL"):
        Settings(environment="test", mock_ai=False, ai_provider="groq", groq_api_key=FAKE_KEY, groq_model="")
    with pytest.raises(ValueError, match="GROQ_MODEL"):  # auto-detected from the key
        Settings(environment="test", mock_ai=False, ai_provider="auto", groq_api_key=FAKE_KEY)
    with pytest.raises(ValueError):  # groq selected without a key is a configuration error, not a silent mock
        Settings(environment="test", mock_ai=False, ai_provider="groq", groq_model="m")
    s = Settings(environment="test", mock_ai=False, ai_provider="auto", groq_api_key=FAKE_KEY, groq_model="m")
    assert s.resolved_ai_provider == "groq" and s.ai_model == "m" and s.ai_key("groq") == FAKE_KEY
    mocked = Settings(environment="test", mock_ai=True, groq_api_key=FAKE_KEY, groq_model="m")
    assert mocked.resolved_ai_provider == "mock"


def test_get_provider_builds_groq_from_settings(monkeypatch):
    monkeypatch.setenv("MOCK_AI", "false")
    monkeypatch.setenv("AI_PROVIDER", "groq")
    monkeypatch.setenv("GROQ_API_KEY", FAKE_KEY)
    monkeypatch.setenv("GROQ_MODEL", "configured-model")
    monkeypatch.setenv("AI_TRANSPORT_RETRIES", "1")
    config.get_settings.cache_clear()
    try:
        p = get_provider()
        assert isinstance(p, GroqProvider) and isinstance(p, OpenAIProvider)
        assert p.model == "configured-model" and p._retries == 1
        assert p._base == "https://api.groq.com/openai/v1"
    finally:
        config.get_settings.cache_clear()


def test_tests_run_on_the_mock_provider():
    assert isinstance(get_provider(), MockAIProvider)
