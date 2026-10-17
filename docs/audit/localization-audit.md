# Localization audit

Audit date: 17 October 2026. Architecture and conventions: [../localization.md](../localization.md). Terminology:
[glossary.md](glossary.md).

## 1. Supported languages

| Code | Language | Locale tag | Role |
|---|---|---|---|
| `ru` | Russian | `ru-RU` | default interface language |
| `kk` | Kazakh (Cyrillic) | `kk-KZ` | full interface and content |
| `en` | English | `en-US` | full interface; base language of stored content and code |

## 2. Translation-key completeness (interface)

Counted from `frontend/src/i18n/locales/{ru,kk,en}` on 17 October 2026:

| Namespace | ru | kk | en |
|---|---:|---:|---:|
| account | 66 | 66 | 66 |
| admin | 610 | 610 | 610 |
| adminContent | 440 | 440 | 440 |
| assessment | 234 | 234 | 234 |
| auth | 133 | 133 | 133 |
| common | 237 | 237 | 237 |
| dashboard | 116 | 116 | 116 |
| errors | 116 | 116 | 116 |
| learning | 116 | 116 | 116 |
| public | 90 | 90 | 90 |
| subscriptions | 39 | 39 | 39 |
| **Total** | **2 197** | **2 197** | **2 197** |

Enforced by `frontend/src/test/i18n.test.ts` (passing): identical key sets in all three languages, no empty
values, identical `{{variables}}`, every literal `t("ns:key")` used in the source exists, plural forms resolve in
each language (Russian `_one/_few/_many/_other`). Every API error code has a translation in `errors`.

## 3. Routes and modules checked

`scripts/e2e/languages.mjs` (run 17 October 2026, **113 page checks, 0 failures**) visits every route below in
ru, kk and en with the demo learner and the admin, and checks `<html lang>`, absence of raw translation keys,
the script of the visible text (Cyrillic for ru/kk with Kazakh-specific letters for kk, Latin for en, so a silent
fallback to another language fails), translated database content, and no horizontal scroll at 390 px:

* Public: `/`, `/login`, `/register`, `/forgot-password`, `/terms`, `/privacy`, `/plans`, 404.
* Learner: `/dashboard`, `/assessment`, `/results`, `/competencies`, `/development-plan`, `/learning`,
  `/practice`, `/progress`, `/profile`, `/settings`, `/plans` (also on a phone viewport).
* Admin: `/admin`, users, roles, subscriptions, plans, assessments, competencies, learning resources, analytics,
  AI, audit log, settings, translations.
* Language switching keeps the route and query string (`/admin/users?status=active`), survives a reload, and the
  saved account language is applied after signing in on a browser that had another language stored.

On the admin content editors, translations page, audit log and AI page only the interface (headings, table
headers, labels, buttons, tabs) is checked for the language, because these pages intentionally show stored data
as stored: the English base text being edited, and machine codes / model ids next to translated labels.

## 4. Static and dynamic content coverage

| Content | Source | Localized | How |
|---|---|---|---|
| Interface text, validation, errors, empty/loading states, aria labels, page titles | frontend | yes | i18next; error codes translated, never raw server text |
| Dates, numbers, percentages, currency | frontend | yes | `Intl` per language; Kazakh dates fall back to built-in Kazakh month names where the browser lacks Kazakh locale data (found by the e2e run) |
| Competencies, areas, levels, goals, assessment, questions, options, rubrics, resources (incl. full content), tasks, plans | database | yes | `translations` JSON per row, English base; swapped in on load for learner requests |
| Score explanations, recommendation reasons, evidence, plan steps, notifications, insights | backend | yes | `app/core/i18n.py`, rendered at read time from stored numbers and ids, so they follow a language switch |
| Emails (verification, password reset, email changed) | backend | yes | account language, then request language |
| Admin-created or edited content | database | when translated | translations edited in the admin editors; gaps visible on `/admin/translations` |
| User-generated text (answers, names, notes) | users | no (by design) | shown as written |

### Translation completeness of database content

`GET /api/admin/translations/status` reports per row and language `complete / partial / missing / stale`. On the
seeded development database after this audit:

| Entity | ru complete | kk complete | not complete |
|---|---:|---:|---:|
| Areas | 3 | 3 | 0 |
| Competencies | 15 | 15 | 0 |
| Levels | 5 | 5 | 0 |
| Goals | 6 | 6 | 0 |
| Assessments | 1 | 1 | 0 |
| Questions | 30 | 30 | 0 |
| Answer options | 115 | 115 | 0 |
| Resources | 30 | 30 | 0 |
| Tasks | 15 | 15 | 0 |
| Plans | 3 | 3 | 0 |

Before the final fix the report showed 25 questions as partial: their shared help text ("Answer for how you usually
act…", "Choose what you would most likely do first.") had no ru/kk translation, so Russian and Kazakh learners saw
it in English. It is now translated, and `test_all_seeded_content_is_fully_translated` fails if any seeded content
loses a translation.

**Stale translations**: when the English base text of a field changes, the ru/kk translation of that field is kept
but marked stale (`translations._stale`), shown on the translations page until an editor updates or confirms it.

## 5. AI localization behaviour

* Every AI call (open-answer evaluation, practice feedback, profile insight) adds an explicit instruction to write
  all free-text fields in the request language; criterion names are given in that language.
* The output language is validated (share of Cyrillic letters for ru/kk, Latin for en, on free-text fields of 20+
  letters; quoted evidence excluded). A wrong-language or invalid reply is retried once, then replaced by the
  rule-based fallback in the right language. The generation language is stored on `ai_evaluations.language` and
  returned with feedback, explanations and insights.
* Rule-based feedback and insights (mock provider and fallback) are re-rendered at read time in the current
  language. Texts written by a real model stay in the language they were generated in.
* Rubric keyword matching counts distinct answer words that start with a keyword stem, across en/ru/kk keywords,
  with a Unicode-aware tokenizer (Kazakh ә, ң, қ, ғ, ө, ұ, ү, һ, і).
* Machine-readable output (ratings, scores, criterion matching) is independent of the display language: criteria
  are matched by normalized name in any language, position only as fallback.
* Verified with automated tests against the mock provider and simulated wrong-language replies
  (`backend/tests/test_localization_audit.py`). Not verified against a live model (no API key in this environment).

## 6. Language fallback rules

| Layer | Rule |
|---|---|
| Interface | kk → ru → en (never needed in practice: all keys exist in all languages, enforced by tests) |
| Database content | field by field: kk → ru → en; ru → en |
| Backend texts (`tr()`), emails | same chains as content |
| Request language | `Accept-Language` (ru, kk, en); default ru; webhooks and admin content editors use the base text |
| User language priority | saved account language → choice in this browser → browser language → Russian |

Kazakh falling back to Russian is a deliberate policy (Russian is widely understood in Kazakhstan and is the
product default); the translations page makes every such gap visible.

## 7. Missing translations and remaining work

* None in the interface or in seeded content (see sections 2 and 4).
* Content created by administrators after deployment is shown in English until translated; the admin translations
  page lists it.
* The Russian and Kazakh translations of educational content and of the interface were produced for this release
  and have not been reviewed by a native-speaking subject-matter expert. This is the main remaining localization
  task (see [remediation-plan.md](remediation-plan.md)).
* Admin-only machine identifiers (audit action codes, permission keys, model ids) are shown next to their
  translated labels on purpose.
