# AI API keys and secret handling

## Rules

* AI keys are **backend-only** environment variables named after the real provider: `GROQ_API_KEY`,
  `GEMINI_API_KEY`, `OPENAI_API_KEY`, or the generic
  `AI_API_KEY` (used by the provider selected with `AI_PROVIDER`). Never `VITE_*` (anything `VITE_*` is public and
  ends up in the browser bundle).
* Never in code, tests, Dockerfiles, YAML, `.env.example`, docs, URLs, logs, screenshots or API responses.
* Gemini receives the key in the `x-goog-api-key` header (never `?key=` in the URL); Groq and OpenAI in
  `Authorization: Bearer`. Tested with fake keys: the key is in the header only, never in the URL, body or error text
  (`tests/test_ai_providers.py`, `test_gemini_sends_key_in_header_only_and_hides_errors`).
* Provider errors are reduced to a status code ("provider returned HTTP 403", "provider rate limit (HTTP 429)",
  "network error: ReadTimeout") before they are logged or stored; response bodies are never logged.
* `/api/ai/status`, `/api/admin/settings` and `/api/admin/ai/usage` report provider and model only (`usage` adds
  `key_configured: true|false`, never the value).

## Configuration

| Variable | Meaning |
|---|---|
| `MOCK_AI` | `true` (default): built-in rule-based provider, no network, no key |
| `AI_PROVIDER` | `auto` (the provider whose key is set; Groq first), `groq`, `gemini`, `openai`, `mock` |
| `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` / `AI_API_KEY` | the secret (backend only) |
| `GROQ_MODEL` | **required** with Groq, no default: list the models your key can use with `python scripts/ai_models.py groq` |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` (Groq's official OpenAI-compatible API) |
| `GEMINI_MODEL` | default `gemini-3.5-flash` (must be available to the key) |
| `AI_TIMEOUT_SECONDS`, `AI_ANALYSIS_TIMEOUT_SECONDS`, `AI_MAX_RETRIES` | 30, 90, 1 (output-validation retries) |
| `AI_TRANSPORT_RETRIES`, `AI_MAX_OUTPUT_TOKENS` | 2 (network / 5xx / short 429), 4096 |

Startup validation (`core/config.py`): `AI_PROVIDER=groq|gemini|openai` without a key → error; Groq without
`GROQ_MODEL` → error (the model is never guessed); `AI_API_KEY` with
`AI_PROVIDER=auto` → error (ambiguous); in production `MOCK_AI=false` without any key → error. There is no silent
fallback to the mock provider: the mock runs only when configured.

**Local:** put the key in `.env` at the repository root (ignored by Git):
`MOCK_AI=false`, `AI_PROVIDER=groq`, `GROQ_API_KEY=<your key>`, `GROQ_MODEL=<id from scripts/ai_models.py>`.

**Render:** Dashboard → service `isker` → Environment → add `GROQ_API_KEY` (secret) and `GROQ_MODEL`, set
`MOCK_AI=false` and `AI_PROVIDER=groq` → Save (redeploys). `render.yaml` declares `GROQ_API_KEY` and `GEMINI_API_KEY`
with `sync: false`, so values are never in the repository.

**Vercel:** Project → Settings → Environment Variables → `GROQ_API_KEY` (mark Sensitive), `GROQ_MODEL`,
`MOCK_AI=false`, `AI_PROVIDER=groq`, for Production (and Preview only if previews may spend the quota). Not with a
`VITE_` / `NEXT_PUBLIC_` prefix.

**GitHub Pages (standalone build):** runs entirely in the visitor's browser, so it can't hold a secret; it always uses
the rule-based provider. Real AI needs the server (Render).

**Claude Code cloud sessions:** add the key in the environment settings (environment menu → Edit → secrets /
environment variables), not in the chat.

## Data sent to the AI provider

Open answers being evaluated (the question, its rubric and the learner's text) and, for the development analysis,
the facts listed in docs/ai/assessment-analysis.md (scores, evidence levels, goals, experience level, catalog titles,
the questions and the learner's answers). Free text is **redacted first** (`app/ai/privacy.py`): e-mail addresses,
links, phone numbers, long digit runs (IIN, card or account numbers) and the learner's own name are replaced by
placeholders, prompt fences are removed and the length is capped. No account data (name, e-mail) is sent. Google's or OpenAI's data-use terms for API traffic apply; check
them for your plan before production use with real learners.

## Repository protections

* `.gitignore`: `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, SSH keys,
  `credentials*.json`, `service-account*.json`, `secrets/`, local databases (`*.db`, `*.sqlite*`).
* CI job **Secret scan (gitleaks)** scans the whole history (`fetch-depth: 0`) on every push and PR, with redacted
  output; the binary is downloaded from the official release and checked against its published SHA-256 sums; no token
  or new secret is needed.
* Optional local hook: `pip install pre-commit && pre-commit install` (`.pre-commit-config.yaml`, gitleaks v8.28.0).
* GitHub's own secret scanning / push protection is not disabled by anything in this repository.

## Scan results (2026-10-30, after the Groq integration)

* gitleaks 8.28.0 on the full Git history: **no leaks found**.
* gitleaks on every changed and new file of this round: **no leaks found**.
* Built frontend (`frontend/dist`, standalone and server builds): no key-like strings (`gsk_…`, `AIza…`, `AQ.…`,
  `sk-…`) and no secret variable names.
* Test files use obviously fake keys (`gsk_test_000…`, `test-not-a-real-key-0000`).

## Scan results (2026-10-29)

* gitleaks 8.28.0, all 25+ commits on all branches: **no leaks found**.
* gitleaks on the working tree (tracked + new files, without `node_modules`/build output): **no leaks found**.
* Built frontend (`frontend/dist`): no key-like strings (`AIza…`, `AQ.…`, `sk-…`) and no secret variable names.
* `.env.example` contains placeholders only.

Limitations: pattern scanners can miss secrets in unusual formats; the documented demo passwords (`IskerDemo2026`,
development-only `IskerAdmin2026`) are intentionally public and not secrets.

## Groq key status (2026-10-30)

No Groq key was provided in this environment (`GROQ_API_KEY` is not set) and outbound connections to
`api.groq.com` are blocked by the environment's network policy, so **the Groq integration has not been tested against
the real API**. It is covered by mocked tests only. The key that was shared earlier in chat (`AQ.…`) is a Google
Gemini key, not a Groq key. To verify Groq: set `GROQ_API_KEY` and `GROQ_MODEL` where the server runs, then
`python scripts/ai_models.py groq` and `ISKER_LIVE_AI=1 pytest tests/test_ai_live.py -s`.

## Incident note: a key shared in chat

On 2026-10-29 a Gemini key was pasted into the Claude Code conversation. It was used only from a temporary file outside
the repository (permissions 600) for a live test, never written to the repository, logs or responses (verified), and
the file was deleted afterwards. Because it is stored in the conversation history, **treat it as exposed and rotate
it**: Google AI Studio → API keys → create a new key, put it in Render's Environment, then delete the old key.

If a key is ever committed: revoke/rotate it first (deleting it from the latest commit is not enough); history rewriting
needs explicit approval and coordination because it changes shared history.
