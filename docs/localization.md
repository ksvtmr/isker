# Localization

Isker's interface is available in **Russian (`ru`, default)**, **Kazakh (`kk`)** and **English (`en`)**.

## Architecture

| Piece | Where |
|---|---|
| i18next + react-i18next + browser language detector | `frontend/src/i18n/index.ts` |
| Languages, names, BCP 47 tags, namespaces | `frontend/src/i18n/config.ts` |
| Translation files (bundled at build time) | `frontend/src/i18n/locales/<ru|kk|en>/<namespace>.json` |
| Intl formatting (dates, numbers, %, currency) | `frontend/src/i18n/format.ts` (re-exported by `utils/format.ts`) |
| Design-system strings | `DSLocaleProvider` in the design system, fed by `i18n/DSBridge.tsx` from `common:ds.*` |
| Language selector | `components/LanguageSwitcher.tsx` (DS `LanguageSelect`) |
| Preference sync with the account | `i18n/useLanguage.ts` (`useLanguage`, `useLanguageSync`) |
| Form validation messages | Zod schemas use keys (`common:validation.*`), rendered with `i18n/useFieldError.ts` |
| API errors | `api/client.ts → errorMessage()` translates the stable `error.code` via the `errors` namespace |
| Integrity tests | `src/test/i18n.test.ts` |

### Namespaces
| Namespace | Covers |
|---|---|
| `common` | actions, states, navigation, design-system strings, enum labels (levels, gaps, roles, statuses, resource types, difficulty), validation, plurals |
| `errors` | one message per API error code |
| `auth` | sign-in, registration, password reset, email verification, Google sign-in, sessions/account security |
| `public` | landing page, terms, privacy, 404/500, app shell chrome |
| `subscriptions` | plans page, features, upgrade prompts |
| `dashboard` | dashboard, progress |
| `assessment` | assessment intro/runner, results, competencies, competency detail |
| `learning` | development plan, learning resources, practice tasks |
| `account` | onboarding, profile, settings (non-security parts) |
| `admin` | admin shell, dashboard, analytics, users, user detail, roles |
| `adminContent` | subscriptions, plans, audit log, system settings, content management (assessments, questions, competencies, resources, tasks), AI governance |

## Conventions (for anyone adding UI)
- **No hard-coded user-facing text in components.** Use `const { t } = useTranslation("<ns>")` and literal keys
  (`t("results.title")`). Literal keys are verified by `i18n.test.ts`; avoid building keys from variables except
  for enum labels (`t(\`common:roles.${role}\`)`), whose full set is defined in `common`.
- Keys are camelCase and grouped by page/component: `assessmentIntro.startButton`.
- Every key exists in **all three** files of the namespace with the same `{{variables}}`. The test fails otherwise.
- Plurals use i18next suffixes: Russian needs `_one`, `_few`, `_many`, `_other`; Kazakh and English use `_one`,
  `_other`. To keep key parity, define all four suffixes in every language.
- Translate **display labels**, never values: API enums (`active`, `super_admin`, `past_due`), ids, codes and field
  names are sent and compared untranslated.
- Dates and numbers: `formatDate`, `formatDateTime`, `formatNumber`, `formatPercent`, `formatCurrency` from
  `utils/format`. Never `toLocaleString("en-GB")`.
- Errors from the API: `errorMessage(error)` (already localized). Never show `error.message` directly and never
  branch on message text — branch on `error.code`.
- Product content (competency names, question texts, answer options, resource titles…) comes **localized from the
  API** (`Accept-Language` is sent with every request). Don't translate it in the frontend.
- Kazakh uses the Cyrillic alphabet with its specific letters (ә ғ қ ң ө ұ ү һ і). Write natural Kazakh, not a
  transliteration of Russian.

## Language resolution and persistence

Priority (implemented in `i18n/index.ts`, `i18n/useLanguage.ts`):

1. **Account preference** (`user_profiles.language`, `PUT /api/auth/me/language`). Applied right after sign-in on
   any device. `NULL` means "never chosen": the language in use is then saved, so a browser setting never
   overwrites an explicit choice.
2. **Choice made in this browser** (selector) — `localStorage["isker.lang"]`, also used for anonymous visitors.
3. **Browser language** (`navigator.languages`, only `ru`/`kk`/`en` count).
4. **Russian** (default).

Changing the language updates the interface immediately, keeps the route and query string, saves the choice to the
account when signed in and refetches API data (content is localized by the server). Registration sends the
current language; Google sign-up stores the language of the page where the flow started.

Missing keys fall back `kk → ru → en` (the test suite makes sure no key is missing).

## Backend

| Piece | Where |
|---|---|
| Request language from `Accept-Language` (`ru` default), `Vary: Accept-Language` | `app/core/middleware.py → parse_language`, `app/core/context.py → language_var` |
| Texts the API composes (score explanations, recommendation reasons, evidence, labels, rule-based AI feedback and insights) | `app/core/i18n.py → tr(key, **values)` |
| Emails (verification, password reset) in the account language | `app/services/email_templates.py` |
| Error responses | stable `error.code` + English `message`; the frontend shows the translation of the code |
| Success responses | `Message {message, code, count}` — the frontend translates `auth:messages.<code>` |
| AI with a real model | the evaluation/insight prompts get an instruction to answer in the request language (`app/ai/service.py`) |
| Requests that are not a person reading the app (payment webhooks `/api/billing/webhooks/*`, the translation report `/api/admin/translations/*`, admin content editors) | content localization off: they read and write the English base text (`app/core/middleware.py → localizes_content`) |

### Fallback policy

One chain everywhere — database content, the server catalog `tr()` and emails: **kk → ru → en**, **ru → en**,
field by field. Russian is widely understood in Kazakhstan and is the product default, so a Kazakh reader sees the
Russian text of a field that has no Kazakh translation yet and English only when neither exists. Publishing content
never requires translations; gaps are made visible by the completeness report below instead of blocking editors.

### What is stored, and in which language

- **Stored texts are English base text.** Recommendation reasons (`recommendations.reason`), plan step titles and
  prompts (`learning_activities.title/prompt`), subscription event reasons (`Replaced by <plan base name>`) and
  everything the seed composes (demo AI feedback, insights, plans — `seed/run.py` runs with `language_var="en"` and
  content localization off) are written in English from untranslated content (`content_i18n.base_text()`,
  `base_language()`), never in the language of the request that happened to create them.
- **Screens render again at read time.** Reasons (`recommendations.localized_reason`, also used by learning,
  practice and the data export), plan steps (`views.recommendation_out`), score explanations, evidence and
  rule-based AI texts are composed in the request language from stored numbers and ids.
- **Rule-based AI output** (`provider` `mock` or `fallback`) — practice feedback, competency AI explanations and
  insights — is re-rendered in the request language with the localized rubric, keeping the stored ratings. Stored
  ratings are matched to rubric criteria by normalized criterion name in any language (NFC, casefold, ё→е, single
  spaces), and by position only when no name matches.
- **Real-model output** is stored as generated. `ai_evaluations.language` records the language it was generated in
  (migration 0006). The output is checked cheaply: the share of Cyrillic letters (ru/kk) or Latin letters (en) among
  the letters of the free-text fields (explanation, strengths, development areas; headline, body, next step for
  insights; quoted evidence is not checked) must be at least 0.6. A reply in the wrong language is treated like an
  invalid structured reply: retried once with the language instruction repeated, then replaced by the rule-based
  fallback in the right language. API outputs that show AI text (`FeedbackOut`, `AIExplanationOut`, `InsightOut`,
  admin AI log) carry `language` — the language of the text returned (the request language for re-rendered
  rule-based text, the generation language for model text, `null` for older rows) — so the interface can mark
  "generated in X" when it differs from the interface language.
- **Rule-based scoring** (`ai/providers.py`) tokenizes with a Unicode word pattern (all Kazakh letters ә ғ қ ң ө ұ
  ү һ і are word letters) and counts distinct answer words that start with a keyword stem of any language: one word
  counts once however many stems match it, repeated words add nothing, multi-word stems match consecutive words.
  Kazakh stems avoid common function words.

### Content translations

English is the base text in the normal columns. Translatable tables have a `translations` JSON column:

```json
{"ru": {"name": "Выявление возможностей", "description": "…"}, "kk": {"name": "Мүмкіндіктерді анықтау"}}
```

| Table | Translated fields |
|---|---|
| `competency_areas` | name |
| `competencies` | name, short_name, description, hint, reflection_prompt |
| `competency_levels` | description |
| `goal_definitions` | title, description |
| `assessments` | title, description |
| `questions` | section, text, help_text, rubric (criterion, description, keywords per position) |
| `question_options` | label |
| `learning_resources` | title, description, content |
| `practical_tasks` | title, description, instructions, rubric |
| `subscription_plans` | name, description |

`app/core/content_i18n.py` swaps in the request language when rows are loaded (`set_committed_value`, so a
localized value is never written back; `base_text(row, field)` still returns the English value) with the fallback
above. Rubric keywords of all languages are merged, so the rule-based evaluator recognizes answers written in any
supported language. Learner requests are localized; the admin content editors work on the base text and edit
translations explicitly. Seeded translations live in `app/seed/translations.py` and are applied by
`app/seed/apply_translations.py` (matched by codes, slugs and English base text) on every seed run — **only missing
translations are filled**: texts already stored (e.g. edited by an administrator) are never overwritten, and a rubric
criterion without a real seeded translation gets keywords only (no English name copied in as "Russian"), so it stays
visibly missing. Plans created without the seed (`GET /api/plans` on an empty database) get the seeded plan
translations too.

### Stale translations

When an English base field changes while a ru/kk translation of it exists, the translation is kept (learners still see
it) and recorded as stale inside the same JSON column — no schema change:

```json
{"ru": {"description": "…"}, "kk": {"description": "…"}, "_stale": {"ru": ["description"], "kk": ["description"]}}
```

- Edits in place are detected by a `before_flush` hook (attribute history of the base fields), so every editor —
  including plans in `admin_billing.py` — follows the same rule.
- A new question version (answered questions are versioned, not edited) compares with the version it replaces.
- Options: a translation follows its English label, so reordering keeps it; a changed score or value never touches
  it; an edited label keeps the old translation of the option it replaced, marked stale.
- Rubrics: translated rows follow their criterion (matched by normalized English name, leftovers paired in order),
  so reordering keeps them aligned; a renamed criterion or changed description marks `rubric` stale.
- A translation whose text the editor changes is no longer stale. To confirm a stale translation as still correct
  without changing it, the editor sends `translations._stale` without that field (`_stale` sent by a client can only
  remove entries). Editors that don't send `_stale` keep the existing marks.

### Completeness status

`translation_status(row)` (per language `ru`, `kk`):
`{"status": "complete" | "partial" | "missing" | "stale", "missing": [fields], "stale": [fields]}`, computed from the
translatable fields that have English base text, plus `rubric` (every criterion needs a translated name, and a
description when the English one exists) and, for questions, the pseudo-field `options`. Status: `stale` if any
field is stale; else `complete` if nothing is missing; `missing` if nothing is translated; otherwise `partial`.

Admin content lists and details (competencies, questions and their options, assessments, resources, tasks, plans)
include `translation_status`. `GET /api/admin/translations/status` (permission `content.manage`) reports all
content except archived items (archived questions' options included):

```text
GET /api/admin/translations/status?entity=competency,question&language=kk&status=missing,partial&page=1&page_size=50
{
  "summary": {"<entity>": {"ru": {"complete": n, "partial": n, "missing": n, "stale": n}, "kk": {...}}},
  "items": [{"entity": "competency", "id": 3, "label": "<English base text>",
             "status": {"ru": "complete", "kk": "missing"},
             "missing": {"ru": [], "kk": ["name", "description"]}, "stale": {"ru": [], "kk": []}}],
  "total": 12, "page": 1, "page_size": 50
}
```

Entities: `area, competency, level, goal, assessment, question, option, resource, task, plan`. All filters are
optional and comma-separated; unknown values → 422 `INVALID_FILTER`. `summary` counts every row of the selected
entities in both languages (the status filter does not apply to it); `items` are the rows whose status in any
selected language is one of the selected statuses, paginated (`page_size` ≤ 200, default 50).

What is and isn't translated is listed in [localization-audit.md](localization-audit.md).
