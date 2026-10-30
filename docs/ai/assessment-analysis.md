# Assessment analysis: scoring vs. AI interpretation

## Two separate layers

1. **Scoring (deterministic, `services/scoring.py`, `SCORING_VERSION = "v1"`).** Each answer gets an item score: a
   chosen option has a fixed score; an open answer gets rubric ratings 0–4 per criterion, and the item score is
   computed from the ratings (the model's own "score" field is ignored). Method weights self 0.2 / situational 0.4 /
   open 0.4. Each competency score stores its evidence: the answer IDs, methods and item scores it was computed from,
   and an evidence level (`sufficient`: ≥3 answers from ≥2 methods incl. a demonstrated one; `limited`: ≥2 answers with
   a demonstrated one; otherwise `insufficient`). Gaps and the learning plan are computed from these numbers by rules.
2. **AI interpretation (`ai/analysis.py`).** The model explains and prioritises. It never sets or changes a score, a
   gap or a plan item; the screen always shows scores from the database.

## Open-answer evaluation

* The answer is redacted (`ai/privacy.py`) and placed in a delimited block; the prompt says learner text is data,
  never instructions.
* Every rubric criterion must be rated. A rating above 0 must quote the answer: the quote (or each part around "…")
  must occur in the answer text, ignoring case, spacing and surrounding quotes. A rating whose quote is not in the answer
  is lowered to 0 and the reason is stored in `ai_evaluations.error`. If no positive rating has a real quote, the output
  is rejected (retry, then the documented rule-based fallback, recorded as `fallback`).

## Development analysis

Lifecycle, one row per attempt (`ai_analyses`): **pending** (queued when the assessment is submitted) →
**processing** (a request is running; a run older than 3 min counts as interrupted) → **completed** | **failed**
(stable error code: `provider_unavailable`, `rate_limited`, `invalid_output`, `wrong_language`). Reopening a page reads
the stored row; nothing is re-generated. A regeneration whose input is unchanged (same facts, prompt, provider, model and
language; `input_digest` = SHA-256) returns the stored result without a provider call. A failed regeneration keeps the
previous analysis.

### Facts given to the model

Competencies (code, name, area, score, level, method scores, evidence level, `answer_ids`, target, gap, priority);
`answers` (answer ID, method, competency codes, question text, chosen option or redacted open text, item score; only
answers of this attempt, owned by this learner); `progress` (change since the previous completed attempt when it is
comparable: same scoring method; otherwise null); goals; experience level, weekly time, preferred format, counts of
completed resources and tasks; catalog items available to this learner (published, allowed by the plan) for the top
5 gaps. No name, e-mail or account data.

### Output schema (strict; `extra` fields ignored, lengths and list sizes capped)

Every **claim** (strength, development area, competency insight) has `competency_code`, `evidence` (answer IDs),
`reasoning_summary`, `confidence` (`low` | `medium` | `high`) and its text. Also: `recommended_actions` (learn needs a
catalog resource ID, practice a catalog task ID, reflect neither), `milestones`, `progress_notes`, `limitations`,
`additional_questions`, `reassessment_weeks`, `language`.

### Grounding checks (any failure → `invalid_output`, one retry, then a controlled failure)

* Every competency code exists in the facts.
* Evidence IDs are answers of this attempt **for that competency**; strengths and development areas must cite at least
  one when the competency has answers.
* A strength needs score ≥ 60 and evidence that is not `insufficient`.
* A development area needs a gap > 0.
* Learn / practice actions point to a catalog item offered for that competency; reflect actions link nothing.
* Progress notes only for competencies with a comparable previous result.
* When any competency has limited or insufficient evidence, `limitations` must not be empty.
* Language: the `language` field, the summary on its own and all texts together must match the requested language.
* Confidence above what the evidence level allows (insufficient → low, limited → medium) is **lowered** to the cap, not
  shown as stated.

### What the learner sees

Summary; strengths and priorities with a confidence badge, the reasoning and a "Based on N of your answers" list (the
question and the learner's own answer); next steps that link only to available items; milestones; progress since the
previous assessment; limitations; questions that would make the result more reliable; when to reassess. The panel says
which provider wrote it (rule-based or the model name) and that scores are estimates.

## Limits of these checks

The checks catch invented references, unsupported claims and overconfidence that can be detected structurally. They
cannot prove that a free-text explanation is a fair reading of the answers; a model can still phrase a supported claim
badly or miss something important. Three competencies are measured by only two items, so their evidence is at most
`limited`.
