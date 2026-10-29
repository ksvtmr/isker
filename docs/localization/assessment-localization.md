# Localization of the assessment flow (ru / kk / en)

| Part | Where the text lives | How the language is chosen |
|---|---|---|
| Interface (onboarding, intro, runner, results, analysis panel, dashboard, admin) | `frontend/src/i18n/locales/{ru,kk,en}/*.json` (namespaces `assessment`, `dashboard`, `adminContent`, …) | interface language; saved to the account (`PUT /api/auth/me/language`) and restored at sign-in |
| Competencies, questions, options, rubrics, resources, tasks, goals, plans | database base text (English) + `translations` JSON per row (`Translatable`), applied on load | `Accept-Language` sent by the client = interface language |
| Rule-based texts (scores explanation, plan steps, rule-based insight and analysis) | backend catalog `app/core/i18n.py` | request language; re-rendered when read in another language |
| AI texts (open-answer feedback, insight, development analysis) | written by the model | requested language passed in the system prompt (`analysis.language_instruction`), in the facts (`language`) and checked |
| Emails | `services/email_templates.py` | account language |
| Dates, numbers, percentages, currency | `Intl` (`utils/format.ts`) | interface language |

## Assessment language

The first-time card on `/assessment` has an "Assessment language" select (same setting as the interface language,
saved to the account). Questions and options are served in that language; answers reference option IDs, so switching
mid-assessment keeps every answer. The attempt records the language it was finished in (`assessment_attempts.language`).

## AI language guarantees

* The model must return `"language": "<requested>"`; the summary on its own and all texts together must be in the
  requested script (Cyrillic for ru/kk, Latin for en; ≥60 % of letters). Otherwise one retry with the instruction
  repeated, then `failed: wrong_language` (never shown as if correct).
* A stored AI analysis keeps its language. Read in another language, the panel says "This analysis was written in
  Қазақша" and offers "Write it in the current language" (a new run, rate-limited). Rule-based analyses are simply
  re-rendered in the reader's language.

## Fallback policy (content)

kk → ru → en, en → en. Publishing never requires translations; Admin → Translations lists missing and outdated
("stale") translations per item. An untranslated field shows the fallback text; the completeness report makes it
visible to administrators rather than presenting it as complete.

## Checks

* `frontend/src/test/i18n.test.ts`: every namespace has identical keys, no empty values, same variables in ru/kk/en,
  every key used in the source exists (13 tests).
* `scripts/e2e/languages.mjs`: 113 page checks in a browser — `<html lang>`, no raw keys, expected script, Kazakh-
  specific letters on kk pages, database content in the page language, no horizontal scroll at 390 px.
* Backend: `test_language_is_passed_and_checked`, `test_rule_based_analysis_is_shown_in_the_readers_language`,
  existing `test_localization*.py`.
* Live: Gemini produced the development analysis in correct Kazakh (2026-10-29).
