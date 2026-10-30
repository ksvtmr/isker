# Personalized learning: where AI is used and where it is not

| Scenario | How it is personalized | AI role |
|---|---|---|
| Initial assessment | questions in the learner's language; open answers evaluated against rubrics | evaluates open answers (rubric ratings with quotes from the answer); score computed by rules |
| Competency profile | scores, levels, evidence levels from the learner's answers | none (deterministic) |
| Gap analysis | target per competency from the learner's goals; gap and priority by rules | none |
| Development plan | resources and tasks chosen by `services/recommendations.py` from the gaps, goals, preferred format, weekly time and what the learner already completed | none for choosing items; the analysis explains and orders, and may only reference catalog items the rules offered |
| AI development analysis | strengths, priorities, next steps, milestones from the facts of this attempt | interpretation with evidence, confidence and limitations (docs/ai/assessment-analysis.md) |
| Practice tasks | feedback on the learner's submission | rubric evaluation, same checks as open answers |
| Reassessment | a new attempt; progress compared only with a comparable earlier attempt (same scoring method) | progress notes limited to compared competencies |
| Dashboard | latest results, plan progress, the compact analysis | shows the stored analysis; no new call |
| AI learning assistant (chat) | **not implemented**: the product has no assistant, so none was added |  |

## Adaptive rules use real records only

Personalization reads the learner's own database records: answers, competency scores, gaps, goals, profile, learning
progress (`user_learning_progress`), practice submissions, activities. Nothing is inferred from browsing alone.

**Scores change only through an assessment.** Competency scores are created in one place, `services/scoring.py`, when
an attempt is submitted. Opening, reading or completing a resource, or finishing a task, updates plan progress and the
recommendation status, never a competency score. Completed items are not recommended again first (`learner_context`),
and when every item for a gap is done, the analysis suggests reflection and a reassessment instead.

## Localization

Rule-based texts come from the backend catalog (ru / kk / en) and are re-rendered in the reader's language. AI texts
are written in the requested language and checked by script (≥60 % Cyrillic for ru/kk, Latin for en; the summary on
its own and all texts together). An AI analysis written in another language is labelled and can be rewritten in the
current one. Interface strings: `frontend/src/i18n/locales/{ru,kk,en}`; a test requires identical keys in all three.
