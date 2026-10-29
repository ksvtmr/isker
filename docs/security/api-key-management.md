# AI API keys and secret handling

## Rules

* AI keys are **backend-only** environment variables: `GEMINI_API_KEY`, `OPENAI_API_KEY`, or the generic
  `AI_API_KEY` (used by the provider selected with `AI_PROVIDER`). Never `VITE_*` (anything `VITE_*` is public and
  ends up in the browser bundle).
* Never in code, tests, Dockerfiles, YAML, `.env.example`, docs, URLs, logs, screenshots or API responses.
* Gemini receives the key in the `x-goog-api-key` header (never `?key=` in the URL); OpenAI in `Authorization`.
* Provider errors are reduced to a status code ("provider returned HTTP 403", "provider rate limit (HTTP 429)",
  "network error: ReadTimeout") before they are logged or stored; response bodies are never logged.
* `/api/ai/status` and `/api/admin/settings` report provider and model only.

## Configuration

| Variable | Meaning |
|---|---|
| `MOCK_AI` | `true` (default): built-in rule-based provider, no network, no key |
| `AI_PROVIDER` | `auto` (the provider whose key is set), `gemini`, `openai`, `mock` |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `AI_API_KEY` | the secret (backend only) |
| `GEMINI_MODEL` | default `gemini-3.5-flash` (must be available to the key) |
| `AI_TIMEOUT_SECONDS`, `AI_ANALYSIS_TIMEOUT_SECONDS`, `AI_MAX_RETRIES` | 30, 90, 1 |

Startup validation (`core/config.py`): `AI_PROVIDER=gemini|openai` without a key → error; `AI_API_KEY` with
`AI_PROVIDER=auto` → error (ambiguous); in production `MOCK_AI=false` without any key → error. There is no silent
fallback to the mock provider: the mock runs only when configured.

**Local:** put the key in `.env` at the repository root (ignored by Git):
`MOCK_AI=false`, `AI_PROVIDER=gemini`, `GEMINI_API_KEY=<your key>`.

**Render:** Dashboard → service `isker` → Environment → add `GEMINI_API_KEY` (secret), set `MOCK_AI=false` and
`AI_PROVIDER=gemini` → Save (redeploys). `render.yaml` declares `GEMINI_API_KEY` with `sync: false`, so the value is
never in the repository.

**GitHub Pages (standalone build):** runs entirely in the visitor's browser, so it can't hold a secret; it always uses
the rule-based provider. Real AI needs the server (Render).

**Claude Code cloud sessions:** add the key in the environment settings (environment menu → Edit → secrets /
environment variables), not in the chat.

## Data sent to the AI provider

Open answers being evaluated (the learner's text, the question and its rubric) and, for the development analysis,
the facts listed in docs/ai/ai-assessment-and-personalization.md §5 (scores, evidence levels, goals, experience level,
catalog titles; no name, email or free-text answers). Google's or OpenAI's data-use terms for API traffic apply; check
them for your plan before production use with real learners.

## Repository protections

* `.gitignore`: `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, SSH keys,
  `credentials*.json`, `service-account*.json`, `secrets/`, local databases (`*.db`, `*.sqlite*`).
* CI job **Secret scan (gitleaks)** scans the whole history (`fetch-depth: 0`) on every push and PR, with redacted
  output; the binary is downloaded from the official release and checked against its published SHA-256 sums; no token
  or new secret is needed.
* Optional local hook: `pip install pre-commit && pre-commit install` (`.pre-commit-config.yaml`, gitleaks v8.28.0).
* GitHub's own secret scanning / push protection is not disabled by anything in this repository.

## Scan results (2026-10-29)

* gitleaks 8.28.0, all 25+ commits on all branches: **no leaks found**.
* gitleaks on the working tree (tracked + new files, without `node_modules`/build output): **no leaks found**.
* Built frontend (`frontend/dist`): no key-like strings (`AIza…`, `AQ.…`, `sk-…`) and no secret variable names.
* `.env.example` contains placeholders only.

Limitations: pattern scanners can miss secrets in unusual formats; the documented demo passwords (`IskerDemo2026`,
development-only `IskerAdmin2026`) are intentionally public and not secrets.

## Incident note: a key shared in chat

On 2026-10-29 a Gemini key was pasted into the Claude Code conversation. It was used only from a temporary file outside
the repository (permissions 600) for a live test, never written to the repository, logs or responses (verified), and
the file was deleted afterwards. Because it is stored in the conversation history, **treat it as exposed and rotate
it**: Google AI Studio → API keys → create a new key, put it in Render's Environment, then delete the old key.

If a key is ever committed: revoke/rotate it first (deleting it from the latest commit is not enough); history rewriting
needs explicit approval and coordination because it changes shared history.
