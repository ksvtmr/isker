# AI provider integration

One backend module talks to AI providers: `backend/app/ai/`. Nothing in the frontend calls a provider or holds a key.

```
app/ai/providers.py   AIProvider interface; MockAIProvider (rule-based), OpenAIProvider, GroqProvider, GeminiProvider
                      shared HTTP transport (_HTTPProvider): timeouts, retries, backoff + jitter, Retry-After,
                      output-token cap, token usage of the last call, errors without bodies or keys
app/ai/service.py     open-answer evaluation (rubric ratings → score), profile insight, prompt versions, language check
app/ai/analysis.py    development analysis: facts → provider → schema → grounding check → stored row
app/ai/privacy.py     redaction of learner text before it leaves the server
app/ai/prompts.py     built-in prompt templates (versioned in the database)
app/core/config.py    provider / model / limits, validated at startup
```

## Providers

| Provider | `AI_PROVIDER` | Endpoint | Key header | Model |
|---|---|---|---|---|
| Rule-based (default) | `mock` / `MOCK_AI=true` | none | none | `mock-rubric-v1` |
| Groq | `groq` | `GROQ_BASE_URL` (default `https://api.groq.com/openai/v1`) + `/chat/completions` | `Authorization: Bearer` | `GROQ_MODEL`, **required** |
| Google Gemini | `gemini` | `…/v1beta/models/{model}:generateContent` | `x-goog-api-key` | `GEMINI_MODEL` |
| OpenAI | `openai` | `OPENAI_BASE_URL` + `/chat/completions` | `Authorization: Bearer` | `OPENAI_MODEL` |

Groq is used through its official OpenAI-compatible Chat Completions API (JSON mode, `temperature 0`,
`max_completion_tokens`), so the same adapter code serves both; no extra SDK is installed (it would also have to run in
the GitHub Pages build, which runs the backend in the browser). **The Groq model is not guessed**: `GROQ_MODEL` has no
default and the server refuses to start without it. `python scripts/ai_models.py groq` lists the models the configured
key can use (`GET /models`, key in the header, never printed).

`AI_PROVIDER=auto` picks the provider whose own key is set (Groq, then OpenAI, then Gemini). There is no silent fallback
to the rule-based provider when a key is missing: configuration errors stop the server (see
docs/security/api-key-management.md).

## Reliability

| Concern | Behaviour |
|---|---|
| Timeouts | `AI_TIMEOUT_SECONDS` (30) per evaluation / insight, `AI_ANALYSIS_TIMEOUT_SECONDS` (90) for the analysis |
| Transport retries | `AI_TRANSPORT_RETRIES` (2): network errors and HTTP 408/409/425/5xx, exponential backoff 0.5 s, 1 s, … (max 8 s) + random jitter |
| Rate limits (429) | retried only when `Retry-After` ≤ 10 s; otherwise reported as `rate_limited` at once (no hammering) |
| Client errors (400/401/403/404) | not retried; error text is "provider returned HTTP <code>" only |
| Output | `AI_MAX_OUTPUT_TOKENS` (4096); a truncated answer (`finish_reason=length` / `MAX_TOKENS`) is rejected, never shown |
| Invalid output | `AI_MAX_RETRIES` (1) more try with the instruction repeated; then a controlled failure (`invalid_output`, `wrong_language`) |
| Usage | prompt / completion tokens of every analysis are stored (`ai_analyses.prompt_tokens`, `completion_tokens`) |
| Per-user limits | `ai_user` 30/h (practice evaluations), `ai_analysis_user` 10/h (analysis runs) |
| Logging | status codes, error classes and validation reasons; never keys, prompts, learner text or model output |

Admin → AI → **Usage and limits** (`GET /api/admin/ai/usage?days=7`, permission `ai.view`) shows the provider and
model, whether a key is configured (not the key), timeouts, retries, token cap, rate limits, and for the period: calls,
failure / fallback rate, average and 95th-percentile latency, tokens and analysis error codes.

## Prompt versions

Prompts live in `ai_prompt_versions` (key, version, active flag, notes). Each stored analysis and evaluation records
the prompt version it used. When a built-in template in `prompts.py` changes, the seed (`python -m app.seed.run`, run
on every deploy) adds it as a new version and activates it **only if the active version is built-in**; a version an
administrator wrote stays active. Admins create, compare and activate versions in Admin → AI → Prompts.

## Verifying a provider

```
cd backend
python scripts/ai_models.py groq                               # key works, which models exist
ISKER_LIVE_AI=1 pytest tests/test_ai_live.py -s                # 3 real analyses (ru, kk, en) through our checks
MOCK_AI=false AI_PROVIDER=groq python scripts/ai_quality.py --out report.json   # golden set + quality metrics
```

Status on 2026-10-30: Gemini was verified live earlier (docs/testing/assessment-flow-test-results.md). **Groq has not
been called for real**: no Groq key is available here and `api.groq.com` is blocked by this environment's network
policy. See docs/testing/ai-integration-test-results.md.
