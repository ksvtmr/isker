# Isker Design System

Isker is an AI-powered EdTech platform for assessing and developing entrepreneurial competencies, built on the **EntreComp** framework (15 competencies in 3 areas). Core loop: **Assess → Profile → Identify Gaps → Recommend → Learn → Practice → Re-assess → Track Progress.** Users: students, aspiring entrepreneurs, young professionals, early founders. It is a diploma MVP at Astana IT University (AITU).

One product surface: the **web app** (responsive; sidebar on desktop, bottom nav on mobile). No marketing site was supplied.

## Sources
- `uploads/TZ_Isker_Platform_RU (1).docx` — technical specification (RU): business case, personas (6.2), user journey (6.3), functional requirements (FR-xx), MVP scope.
- Pasted token CSS (`ISKER DESIGN SYSTEM` `:root` block) and a React/Tailwind component file: Button, Card, CardHeader, ProgressBar, ScoreCard, LevelBadge, GapBadge, CompetencyCard, StatCard, RecommendationCard, EmptyState, AIInsight, AssessmentProgress, NavItem.
- Pasted product design brief (sections 1–31): screens, copy, component list, states, accessibility, responsive rules.
- No Figma file, repository, logo, or imagery was provided.

### Decisions carried from the TZ
- Scale is 0–100 internally and in UI. Levels (5): Foundation 0–39, Developing 40–59, Intermediate 60–79, Advanced 80–89, Proficient 90–100.
- Target defaults to 70. Gap = target − score: High ≥ 20, Medium 10–19, Low < 10. Priority = Gap × Importance × Confidence.
- The question screen never shows which competency is measured (FR-14). Every recommendation shows its reason (FR-34).
- The TZ allows only 6 competencies to be fully assessed in the MVP; `CompetencyCard` has a `notAssessed` state for the other 9. The UI kit demo shows all 15 scored, following the design brief.

---

## CONTENT FUNDAMENTALS
- **Voice:** calm, encouraging, specific, like a good tutor. It explains and does not hype. The product is a serious development platform, not a chatbot.
- **Person:** "you / your" for the user ("Your Development Plan", "Your strongest area is Creativity."). The product doesn't say "I" or "we", except in error messages ("We couldn't load your competency profile.").
- **Casing:** Title Case for page titles, section titles and CTAs in the brief ("Start Assessment", "Write Reflection", "Your Competency Gaps"). Sentence case for body, hints and toasts ("Answer saved").
- **Numbers carry their scale:** "72 / 100", "48 → 70", "+8% since your last assessment", "In 12 days", "15 min · Beginner".
- **Every score is explained.** Pair numbers with a sentence: "Your ability to generate new ideas is one of your strongest areas."
- **AI copy** names the data it uses: "Your responses indicate stronger confidence in opportunity discovery than financial planning." Never "I think…".
- **Terminology is fixed:** competency, area (Ideas & Opportunities / Resources / Into Action), score, level, gap, target, plan, Learn / Practice / Reflect / Reassess.
- **No emoji.** Use unicode only for "→" in score transitions and "·" as a metadata separator.
- **Language:** UI in English (the MVP's `en` locale). RU/KK locales are planned. Research artifacts such as the CJM are in Russian, like the TZ.

## VISUAL FOUNDATIONS
- **Color:** brand blue `#347FF1` scale with **600 `#2464D5` as the action color**. Growth green `#25B875` scale for progress, completion and positive deltas. Slate neutrals. Semantic success/warning/error/info each have a tinted `-bg`. Gap colors (red/amber/green) appear only in small pills and bars, never as large fills ("avoid excessive red"). Each EntreComp area has one hue, used in charts only. No gradients, no neon, no dark mode.
- **Type:** Inter 400/500/600/700 (self-hosted woff2, Latin + Cyrillic). Page title 24/600, −0.02em. Section title 18/600. Card title 16/600. Body 14/1.5 (AI text 14/24). Labels 12/500. Overlines 12/600 caps +0.06em. Scores are the visual hero: 36–48/600 with a quiet "/ 100" in neutral-400. No oversized marketing type inside the app.
- **Backgrounds:** flat `neutral-50` page with white cards. No imagery, patterns or textures. The only tinted surface is the AI insight (`brand-50`).
- **Cards:** white, 1px `neutral-200` border, **14px radius**, `shadow-sm`. Padding 20 (compact) or 24 (section). Interactive cards lift 2px with `shadow-md` on hover. No colored left-border accents.
- **Radii:** 6 (tabs, tooltip), 10 (buttons, inputs, list items), 14 (cards), 20 (modal), full (badges, bars, avatars).
- **Shadows:** three soft slate shadows (sm/md/lg). Borders carry most of the separation. No inner shadows.
- **Spacing:** 4px base (4…80). Grid gap 16–20. Page padding 32–40 desktop, 16 mobile. Content max-width 1200 inside a 1440 frame. Sidebar 248.
- **Hover:** primary/success/danger darken one step (600→700). Secondary/ghost get a `neutral-50/100` fill. Nav items get `neutral-100`. Links underline.
- **Press:** buttons move down 1px. No scale-down.
- **Focus:** 3px `brand-200` outline, 2px offset, on every interactive element. Inputs use a `brand-500` border with a 3px `brand-100` ring.
- **Motion:** 150–200ms ease for color and lift, 500ms for progress fills, a 0.2s fade-rise for toasts and modals. Skeleton shimmer is used instead of spinners. Nothing bounces. `prefers-reduced-motion` turns motion off.
- **Transparency/blur:** only the modal scrim (slate at 40%). No glassmorphism.
- **Data viz:** thin 2–2.5px brand lines, white-filled point markers, a dashed neutral line for the target, a light `neutral-100` grid. Every chart has a text summary under a hairline (ChartCard).
- **Color is never the only signal:** gap pills include a 1–3 bar glyph and a word. Levels are always written out.
- **Layout:** fixed sidebar on desktop. Below 768px a sticky top bar and a fixed 64px bottom nav replace it. Assessment is a focused full-screen layout with a sticky Back/Continue bar on mobile.

## ICONOGRAPHY
- **Lucide** line icons (2px stroke, rounded joins), pinned to `lucide-static@0.460.0` on unpkg. The `Icon` component fetches each SVG once and inlines it so it takes `currentColor`. No icons were supplied, so Lucide is a **substitution** that matches the brief ("simple line icons").
- Sizes: 18 in nav and buttons, 16 inline, 20 in the bottom nav, 22 in empty states. Icons sit in 28–40px tinted tiles on stat cards and empty states.
- Nav mapping: Dashboard `layout-dashboard`, Assessment `clipboard-check`, Competency Profile `radar`, Development Plan `route`, Progress `trending-up`, Resources `library`, Settings `settings`. AI mark: `sparkles` in a 28px brand-600 circle.
- No emoji, no illustrations, no icon font.

## Brand assets
- **No logo was provided.** The wordmark is "Isker" set in Inter Bold, −0.03em (`Wordmark` component). No mark has been drawn. Please supply one if it exists.
- `assets/fonts/` holds Inter woff2 subsets (latin, latin-ext, cyrillic, cyrillic-ext) from Google Fonts.

---

## Index (this repository)

The design system lives in `design-system/` and is the single source of truth for every screen.
It is an npm workspace package (`@isker/design-system`) consumed by `frontend/`.

| File | Contents |
|---|---|
| `design-system/tokens.css` | All tokens: Inter `@font-face`, colour scales, level/gap badge pairs, area colours, semantic aliases, type roles, spacing, radii, shadows, motion |
| `design-system/styles.css` | Imports `tokens.css`; base reset and all `isk-*` state classes (hover, focus, press, inputs, choice, nav, tabs, skeleton, modal, sidebar, bottom nav) |
| `design-system/components.tsx` | React + TypeScript components (ported 1:1 from the DS bundle) |
| `design-system/icons.tsx` | Lucide 0.460.0 icon registry (bundled locally, same names as before) |
| `design-system/index.ts` | Public entry point |
| `design-system/assets/fonts/` | Inter woff2 subsets (Latin, Latin-ext, Cyrillic, Cyrillic-ext) |

Usage:

```tsx
import "@isker/design-system/styles.css";               // once, at app start
import { Button, CompetencyCard, AIInsight } from "@isker/design-system";
```

### Components
- **Core:** Button, ButtonLink*, Card, CardHeader, Icon, Tooltip
- **Forms:** Input, Textarea, Select, Checkbox, Radio, AnswerOption
- **Data:** ProgressBar, LevelBadge, GapBadge, ScoreCard, StatCard, CompetencyCard, ChartCard, RadarChart, LineChart, CompareBars, ScoreValue*
- **Feedback:** AIInsight, EmptyState, Skeleton, SkeletonCard, Toast, Modal, InlineAlert*, StatusBadge*
- **Navigation:** NavItem, Sidebar, Wordmark, BottomNav, Tabs (+ `ISKER_NAV`, `ISKER_NAV_FOOTER`, `ISKER_BOTTOM_NAV`)
- **Learning:** RecommendationCard, AssessmentProgress, PlanStep
- **Layout & content:** PageHeader*, SectionTitle*, Prose*
- **Helpers:** `levelFromScore`, `gapFromScore`, `LEVELS`

`*` = additions made while building the production app. They use only existing tokens and follow the rules above.

### Changes from the prototype bundle
- **Icons** are bundled from `lucide-react@0.460.0` (the version the DS pinned) instead of being fetched from unpkg at runtime: works offline, no layout flash, same icon names.
- **Accessibility:** Modal traps focus, closes on Escape and restores focus; inputs link hints/errors with `aria-describedby`; AnswerOption supports roving focus (arrow keys) inside a `radiogroup`; PlanStep announces its status to screen readers.
- **Navigation** items accept `href`, so they render real links (middle-click, open in new tab) while the app routes client-side.
- **Information architecture** follows the product brief: Dashboard, Assessment, Competencies, Development Plan, Learning, Practice, Progress, and in the footer Profile and Settings.
- **Tablet:** between 768 and 1099px the Sidebar collapses to icons only. Mobile (<768px) uses the top bar, bottom nav and a menu sheet.
- **Charts:** the DS RadarChart, LineChart and CompareBars are used for all competency visualisation, so Recharts was not added (it would have duplicated these components with a different visual style).

### Rules for contributors
1. Do not hard-code colours. Use tokens (`var(--color-brand-600)`, `var(--gap-high-fg)` …).
2. If a component is missing, add it here, not in a page.
3. Tailwind is available in the app for layout utilities only. Its colour palette is disabled, so it cannot introduce off-system colours.
4. Colour is never the only signal. Levels and gaps are always written out.
