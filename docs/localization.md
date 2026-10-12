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
