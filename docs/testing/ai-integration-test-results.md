# AI integration — tests actually executed (2026-10-30)

Everything below was run in this environment. Providers in automated tests are **mocked** (test doubles or replaced
`httpx.post`); nothing in this list called Groq.

## Real provider status

| Provider | Real call made | Result |
|---|---|---|
| Groq | **No** | No `GROQ_API_KEY` in the environment, and the network policy refuses connections to `api.groq.com` (checked: `connect_rejected`). The key pasted in chat earlier is a Google Gemini key (`AQ.…`), not a Groq key. **The Groq connection is not verified.** |
| Gemini | Yes, on 2026-10-29 (previous round) | Kazakh analysis succeeded; then free-tier quota (HTTP 429). See assessment-flow-test-results.md |
| Rule-based | Yes | used by all automated and browser tests |

To verify Groq where the key is available: `python scripts/ai_models.py groq` → choose `GROQ_MODEL` →
`ISKER_LIVE_AI=1 pytest tests/test_ai_live.py -s` → `python scripts/ai_quality.py --strict --out report.json`.

## Automated suites

| Check | Command | Result |
|---|---|---|
| Lint | `ruff check app tests scripts browser` | clean |
| Types | `mypy app` | no issues (91 files) |
| Migration guard | `python scripts/check_migrations.py` | 9 migrations OK |
| Backend tests | `pytest` (SQLite) | **328 passed, 3 skipped** (the 3 skipped are the gated live tests) |
| Frontend | `npm run typecheck`, `npm run lint`, `vitest` | clean; **108 passed** (14 files) |
| Translation completeness | `vitest run src/test/i18n.test.ts` | ru / kk / en identical keys (caught and fixed a missing plural form) |
| Production builds | `npm run build`, `VITE_STANDALONE=true npm run build` | OK |
| In-browser API (GitHub Pages) | `browser/build.py` + `node browser/smoke.mjs` | PASSED (new modules import under Pyodide) |
| Migrations on PostgreSQL 16 | `alembic upgrade head`, `alembic check`, downgrade 0009→0008→head with rows (renumbered from 0008 after merging the character-progression 0008) | OK; statuses mapped pending→processing, succeeded→completed, failed→failed and back |
| Seed prompt versions (PostgreSQL) | `python -m app.seed.run` twice | changed built-ins `answer_evaluation`, `development_analysis` → v2 active; unchanged `profile_insight` stays v1; second run adds nothing. **Found and fixed** a bug: the new function sat below `if __name__ == "__main__"`, so the seed crashed when run as a script (unit tests had imported the module and missed it) |
| Browser journey | `scripts/e2e/journey.mjs` (register → onboarding → assessment → results with analysis → plan → learning → practice → admin; axe WCAG 2.2 AA; keyboard; mobile) | PASSED; server log: 0 errors, each analysis generated once (1 POST, later GETs read the stored row) |
| Three languages | `scripts/e2e/languages.mjs` | 113 page checks, 0 failures |
| Secrets | gitleaks 8.28.0 on full history and on all changed files; grep of both bundles | no leaks; no key patterns or secret variable names in bundles |

## The 15 required scenarios

| # | Scenario | Test(s) |
|---|---|---|
| 1 | Key only on the server; never in responses | `test_api_key_is_never_returned`, `test_admin_usage_shows_config_limits_and_counts_without_secrets`, bundle scan |
| 2 | Groq adapter: official endpoint, Bearer header, JSON mode, timeout | `test_groq_uses_the_official_openai_compatible_endpoint_and_bearer_header` |
| 3 | Model not guessed | `test_config_requires_an_explicit_groq_model_and_never_guesses` |
| 4 | Errors without keys or bodies | `test_client_errors_are_not_retried_and_do_not_leak_the_key` |
| 5 | Retries with backoff + jitter, limited | `test_transient_errors_are_retried_with_backoff_then_succeed`, `test_retries_are_limited` |
| 6 | 429 handling | `test_429_short_retry_after_is_waited_long_one_is_reported`, `test_provider_errors_are_recoverable` |
| 7 | Malformed / truncated / empty output | `test_bad_responses_are_controlled_errors`, `test_invalid_output_fails_safely_then_retry_succeeds_without_duplicates` |
| 8 | Evidence references real answers of the user | `test_unsupported_claims_are_rejected[foreign_evidence, made_up_evidence, no_evidence]`, `test_facts_contain_answers_but_no_personal_data` |
| 9 | No unsupported strengths / areas / progress; limitations required | `…[weak_strength, area_without_gap, stray_progress, no_limitations]` |
| 10 | Confidence capped by evidence | `test_confidence_is_capped_by_the_evidence_level` |
| 11 | Only real catalog items recommended | `test_unsupported_recommendations_are_rejected`, lifecycle test |
| 12 | Prompt injection + PII in answers | `test_answer_text_is_redacted_and_marked_as_data`, `test_redact`, `test_answer_is_redacted_before_it_reaches_the_provider`, quote check tests |
| 13 | Idempotency / stored results | `test_unchanged_regeneration_does_not_call_the_provider`, `test_analysis_lifecycle_is_idempotent_and_references_real_content`, rate-limit test |
| 14 | Languages ru / kk / en | `test_language_is_passed_and_checked`, `test_rule_based_analysis_is_shown_in_the_readers_language`, languages e2e |
| 15 | Scores not changed by AI or by viewing / completing | `test_score_is_recomputed_from_rubric_not_taken_from_model`, lifecycle test (scores identical before/after), docs/ai/personalized-learning.md |

Plus: owner-only access, statuses, admin list / retry / usage, prompt version sync, progress against a comparable
attempt, frontend panel (evidence, confidence, limitations, queued run, processing, failure with retry).

## Golden set (`scripts/ai_quality.py`)

Rule-based provider, 5 scenarios × 3 languages = 15 runs: valid 1.0, evidence-backed 1.0, unsupported claims 0,
confidence over cap 0, existing resources 1.0, insufficiency acknowledged 1.0, injection followed 0, PII in output 0,
errors 0. This proves the harness and checks, **not** the quality of any real model.

## Not verified

* Groq with a real key (see above), and therefore real-model quality metrics.
* Behaviour under real parallel load on several processes.
* Vercel deployment of this round (not deployable from this environment).
