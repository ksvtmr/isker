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

Generated texts are rebuilt at read time from stored numbers and ids (explanations, reasons, rule-based insights,
evidence), so switching the language also switches texts generated earlier. Texts written by a real AI model are
stored as generated, in the language active at that moment.

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
localized value is never written back) with field-by-field fallback `kk → ru → en`. Rubric keywords of all
languages are merged, so the rule-based evaluator recognizes answers written in any supported language.
Learner requests are localized; the admin content editors work on the base text and edit translations explicitly.
Seeded translations live in `app/seed/translations.py` and are applied by `app/seed/apply_translations.py`
(matched by codes, slugs and English base text) on every seed run.

What is and isn't translated is listed in [localization-audit.md](localization-audit.md).
