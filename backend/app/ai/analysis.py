"""AI development analysis of a completed assessment (step "AI Analysis" of the product loop).

    scores + per-answer evidence (services/scoring.py) ─┐
    gaps + priorities (services/gaps.py)                 ├─► facts ─► provider ─► JSON ─► schema ─► grounding check
    goals, learner context, available catalog, progress ─┘                          (retry on invalid / wrong language)

The analysis interprets; it never changes a score, a gap or a plan item (those are deterministic). Every claim
(strength, development area, insight) names its competency, the IDs of the learner's own answers it rests on
(`evidence`), a short `reasoning_summary` and a `confidence` that may not exceed what the evidence level allows.
Everything the model names is checked against the facts it was given: competencies of this attempt, answers of this
attempt (owned by this learner), published catalog items available to this learner, the previous comparable result.
Output that fails is retried a limited number of times and then recorded as failed; nothing is invented in its place.

Lifecycle (one row per attempt, `ai_analyses`): pending (queued at submit) → processing → completed | failed.
Reopening the page reads the stored row; a regeneration with unchanged input (same facts, prompt, provider, model,
language: `input_digest`) returns the stored result without calling the provider.

Data minimisation: the provider receives scores, evidence levels, goal titles, experience level, weekly time, counts
of completed activities, catalog titles, the questions and the learner's answers to them. Free-text answers are
redacted (app/ai/privacy.py: e-mail, links, phone and long numbers, the learner's name) and truncated; they are
marked as untrusted data in the prompt. No name, e-mail or account data is sent.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ai.privacy import MAX_QUESTION_CHARS, redact, truncate
from app.ai.prompts import ANALYSIS_KEY
from app.ai.providers import AIProvider, AIProviderError, InsightRequest, get_provider
from app.ai.service import LanguageMismatch, active_prompt, check_language
from app.core.config import get_settings
from app.core.context import language_var
from app.core.database import utcnow
from app.core.i18n import tr
from app.models import (
    AIAnalysis,
    Answer,
    AssessmentAttempt,
    Competency,
    CompetencyGap,
    CompetencyScore,
    LearningResource,
    PracticalTask,
    User,
    UserGoal,
)
from app.models.enums import AttemptStatus, ContentStatus, Difficulty
from app.services import entitlements
from app.services import profile as profile_service
from app.services import recommendations as rec_service

log = logging.getLogger("isker.ai.analysis")

PENDING, PROCESSING, COMPLETED, FAILED = "pending", "processing", "completed", "failed"
STATUSES = (PENDING, PROCESSING, COMPLETED, FAILED)
STALE_PROCESSING = timedelta(minutes=3)  # a run older than this is treated as interrupted and may be restarted
MAX_FOCUS = 5  # competencies (by gap priority) whose catalog items are offered to the model
MAX_RESOURCES, MAX_TASKS = 3, 2  # per focus competency
STRENGTH_MIN_SCORE = 60  # a strength needs at least this score and evidence that is not "insufficient"
CONFIDENCE_CAP = {"sufficient": "high", "limited": "medium"}  # anything else: "low"
_RANK = {"low": 0, "medium": 1, "high": 2}


# --- Output schema (validated before anything is saved) ---------------------------------------------------------------

class _Out(BaseModel):
    model_config = ConfigDict(extra="ignore")


Confidence = Literal["low", "medium", "high"]


class _Claim(_Out):
    competency_code: str = Field(min_length=1, max_length=48)
    evidence: list[int] = Field(default_factory=list, max_length=8)  # answer IDs from facts.answers
    reasoning_summary: str = Field(min_length=1, max_length=400)
    confidence: Confidence


class StrengthItem(_Claim):
    explanation: str = Field(min_length=1, max_length=500)


class DevelopmentArea(_Claim):
    explanation: str = Field(min_length=1, max_length=500)
    priority: int = Field(ge=1, le=5)


class CompetencyInsight(_Claim):
    insight: str = Field(min_length=1, max_length=500)


class RecommendedAction(_Out):
    competency_code: str = Field(min_length=1, max_length=48)
    kind: Literal["learn", "practice", "reflect"]
    resource_id: int | None = None
    task_id: int | None = None
    reason: str = Field(min_length=1, max_length=400)


class Milestone(_Out):
    competency_code: str = Field(min_length=1, max_length=48)
    objective: str = Field(min_length=1, max_length=300)
    measure: str = Field(min_length=1, max_length=300)
    target_weeks: int = Field(ge=1, le=26)


class ProgressNote(_Out):
    competency_code: str = Field(min_length=1, max_length=48)
    explanation: str = Field(min_length=1, max_length=400)


class DevelopmentAnalysis(_Out):
    summary: str = Field(min_length=1, max_length=1500)
    strengths: list[StrengthItem] = Field(default_factory=list, max_length=5)
    development_areas: list[DevelopmentArea] = Field(default_factory=list, max_length=5)
    competency_insights: list[CompetencyInsight] = Field(default_factory=list, max_length=15)
    recommended_actions: list[RecommendedAction] = Field(default_factory=list, max_length=10)
    milestones: list[Milestone] = Field(default_factory=list, max_length=6)
    progress_notes: list[ProgressNote] = Field(default_factory=list, max_length=15)
    limitations: list[str] = Field(default_factory=list, max_length=8)
    additional_questions: list[str] = Field(default_factory=list, max_length=5)
    reassessment_weeks: int = Field(ge=2, le=26)
    language: str = Field(min_length=2, max_length=8)


class InvalidReferences(ValueError):
    """The model named something that is not in the facts, or made a claim the evidence does not support."""


# --- Facts ------------------------------------------------------------------------------------------------------------

def _answers(db: Session, user: User, attempt: AssessmentAttempt, scores: list[CompetencyScore],
             comps: dict[int, Competency]) -> list[dict]:
    """The learner's answers that scores rest on, from this attempt only (attempt.user_id == user.id is checked by the
    caller). Questions and option labels in the request language; free text redacted and truncated."""
    used: dict[int, dict] = {}
    for s in scores:
        for ev in s.evidence or []:
            aid = ev.get("answer_id")
            if aid is None:
                continue
            item = used.setdefault(aid, {"answer_id": aid, "method": ev.get("method"), "competency_codes": []})
            item["competency_codes"].append(comps[s.competency_id].code)
    if not used:
        return []
    rows = db.scalars(select(Answer).where(Answer.attempt_id == attempt.id, Answer.id.in_(list(used))))
    out = []
    for a in sorted(rows, key=lambda a: a.id):
        item = used[a.id]
        response = a.option.label if a.option is not None else redact(a.text_response, names=(user.full_name,))
        out.append({**item, "question": truncate(a.question.text, MAX_QUESTION_CHARS), "response": response,
                    "item_score": round(a.item_score) if a.item_score is not None else None})
    return out


def _progress(db: Session, attempt: AssessmentAttempt, current: dict[str, int]) -> dict | None:
    """Change since the learner's previous completed attempt, only when it is comparable (same scoring method)."""
    previous = db.scalar(
        select(AssessmentAttempt)
        .where(AssessmentAttempt.user_id == attempt.user_id, AssessmentAttempt.status == AttemptStatus.COMPLETED,
               AssessmentAttempt.id != attempt.id, AssessmentAttempt.completed_at <= attempt.completed_at)
        .order_by(AssessmentAttempt.completed_at.desc(), AssessmentAttempt.id.desc())
    ) if attempt.completed_at else None
    kind = profile_service.comparison(previous, attempt)
    if previous is None or kind == "method_changed":
        return None
    comps = {c.id: c.code for c in db.scalars(select(Competency))}
    before = {comps[s.competency_id]: s.score
              for s in db.scalars(select(CompetencyScore).where(CompetencyScore.attempt_id == previous.id))}
    rows = [{"code": code, "previous": before[code], "current": score, "change": score - before[code]}
            for code, score in current.items() if code in before]
    return {"comparison": kind, "competencies": rows} if rows else None


def build_facts(db: Session, user: User, attempt: AssessmentAttempt) -> dict:
    """Everything the analysis may use, from the database. Names and titles are in the request language."""
    comps = {c.id: c for c in db.scalars(select(Competency))}
    scores = list(db.scalars(select(CompetencyScore).where(CompetencyScore.attempt_id == attempt.id)))
    gaps = {g.competency_id: g for g in db.scalars(select(CompetencyGap).where(CompetencyGap.attempt_id == attempt.id))}
    rows = []
    for s in sorted(scores, key=lambda s: comps[s.competency_id].sort_order):
        c, g = comps[s.competency_id], gaps.get(s.competency_id)
        rows.append({
            "code": c.code,
            "name": c.name,
            "area": c.area.name if c.area else None,
            "score": s.score,
            "level": s.level.name if s.level else None,
            "methods": {k: round(v) for k, v in (("self", s.self_score), ("situational", s.situational_score),
                                                 ("open", s.open_score)) if v is not None},
            "evidence_level": s.evidence_level or "not_recorded",
            "answer_ids": sorted({ev["answer_id"] for ev in s.evidence or [] if ev.get("answer_id") is not None}),
            "target": g.target_score if g else None,
            "gap": g.gap if g else None,
            "priority_rank": g.priority_rank if g else None,
        })
    goals = [
        {"code": ug.goal.code, "title": ug.goal.title}
        for ug in db.scalars(select(UserGoal).where(UserGoal.user_id == user.id))
        if ug.goal is not None
    ]
    ctx = rec_service.learner_context(db, user.id)
    profile = user.profile
    focus = [g for g in sorted(gaps.values(), key=lambda g: g.priority_rank) if g.gap > 0][:MAX_FOCUS]
    advanced_ok = entitlements.allows(db, user, "learning.advanced_resources")
    resources, tasks = [], []
    for g in focus:
        c = comps[g.competency_id]
        published = [
            r for r in db.scalars(select(LearningResource).where(
                LearningResource.competency_id == c.id, LearningResource.status == ContentStatus.PUBLISHED))
            if advanced_ok or r.difficulty != Difficulty.ADVANCED
        ]
        for r in rec_service.rank_resources(published, g.current_score, ctx)[:MAX_RESOURCES]:
            resources.append({"id": r.id, "competency_code": c.code, "title": r.title, "type": r.type.value,
                              "difficulty": r.difficulty.value, "minutes": r.duration_minutes,
                              "completed": r.id in ctx.completed_resources})
        open_tasks = list(db.scalars(select(PracticalTask).where(
            PracticalTask.competency_id == c.id, PracticalTask.status == ContentStatus.PUBLISHED)))
        for t in rec_service.rank_tasks(open_tasks, g.current_score, ctx)[:MAX_TASKS]:
            tasks.append({"id": t.id, "competency_code": c.code, "title": t.title, "difficulty": t.difficulty.value,
                          "minutes": t.duration_minutes, "completed": t.id in ctx.completed_tasks})
    return {
        "language": language_var.get(),
        "assessment": {"scope": attempt.scope.value, "assessment_version": attempt.assessment_version,
                       "scoring_version": attempt.scoring_version},
        "overall_score": attempt.overall_score,
        "competencies": rows,
        "answers": _answers(db, user, attempt, scores, comps),
        "progress": _progress(db, attempt, {c.code: s.score for s in scores if (c := comps[s.competency_id])}),
        "goals": goals,
        "learner": {
            "experience": profile.entrepreneurial_experience.value if profile else None,
            "weekly_learning_minutes": profile.weekly_learning_minutes if profile else None,
            "preferred_format": profile.preferred_learning_format.value if profile else None,
            "completed_resources": len(ctx.completed_resources),
            "completed_tasks": len(ctx.completed_tasks),
        },
        "catalog": {"resources": resources, "tasks": tasks},
    }


# --- Grounding checks -------------------------------------------------------------------------------------------------

def check_references(out: DevelopmentAnalysis, facts: dict) -> int:
    """Raises InvalidReferences when the output names something not in the facts or claims more than the evidence
    supports. Confidence above what the evidence level allows is lowered (not rejected); returns how many were."""
    comps = {c["code"]: c for c in facts["competencies"]}
    resources = {r["id"]: r["competency_code"] for r in facts["catalog"]["resources"]}
    tasks = {t["id"]: t["competency_code"] for t in facts["catalog"]["tasks"]}
    groups = (out.strengths, out.development_areas, out.competency_insights, out.recommended_actions, out.milestones,
              out.progress_notes)
    named = [x.competency_code for group in groups for x in group]
    unknown = sorted(set(named) - set(comps))
    if unknown:
        raise InvalidReferences(f"unknown competency codes: {unknown}")
    lowered = 0
    claims: list[_Claim] = [*out.strengths, *out.development_areas, *out.competency_insights]
    for claim in claims:
        c = comps[claim.competency_code]
        allowed = set(c["answer_ids"])
        if not set(claim.evidence) <= allowed:
            raise InvalidReferences(f"{claim.competency_code}: evidence {sorted(set(claim.evidence) - allowed)} is not "
                                    "an answer of this attempt for this competency")
        if allowed and not claim.evidence and not isinstance(claim, CompetencyInsight):
            raise InvalidReferences(f"{claim.competency_code}: a claim without evidence")
        cap = CONFIDENCE_CAP.get(c["evidence_level"], "low")
        if _RANK[claim.confidence] > _RANK[cap]:
            claim.confidence = cap  # type: ignore[assignment]
            lowered += 1
    for s in out.strengths:
        c = comps[s.competency_code]
        if c["evidence_level"] in ("insufficient", "not_recorded") or c["score"] < STRENGTH_MIN_SCORE:
            raise InvalidReferences(f"{s.competency_code}: not a supported strength "
                                    f"(score {c['score']}, evidence {c['evidence_level']})")
    for d in out.development_areas:
        if (comps[d.competency_code]["gap"] or 0) <= 0:
            raise InvalidReferences(f"{d.competency_code}: a development area without a gap")
    for a in out.recommended_actions:
        if a.kind == "learn" and resources.get(a.resource_id or -1) != a.competency_code:
            raise InvalidReferences(f"learn action without a matching catalog resource: {a.resource_id}")
        if a.kind == "practice" and tasks.get(a.task_id or -1) != a.competency_code:
            raise InvalidReferences(f"practice action without a matching catalog task: {a.task_id}")
        if a.kind == "reflect" and (a.resource_id or a.task_id):
            raise InvalidReferences("reflect action must not reference a resource or task")
    progress = {p["code"] for p in (facts.get("progress") or {}).get("competencies", [])}
    stray = sorted({n.competency_code for n in out.progress_notes} - progress)
    if stray:
        raise InvalidReferences(f"progress notes without a comparable previous result: {stray}")
    weak = [c for c in facts["competencies"] if c["evidence_level"] in ("limited", "insufficient", "not_recorded")]
    if weak and not out.limitations:
        raise InvalidReferences("limited evidence is not acknowledged in limitations")
    if out.language != facts["language"]:
        raise LanguageMismatch(f"language field is {out.language!r}, expected {facts['language']!r}")
    return lowered


def _texts(out: DevelopmentAnalysis) -> list[str]:
    return [out.summary, *(s.explanation for s in out.strengths), *(d.explanation for d in out.development_areas),
            *(i.insight for i in out.competency_insights), *(a.reason for a in out.recommended_actions),
            *(m.objective for m in out.milestones), *(n.explanation for n in out.progress_notes),
            *out.limitations, *out.additional_questions]


# --- Rule-based analysis (the mock provider; texts from the catalog in the requested language) ----------------------

def _claim_fields(c: dict) -> dict:
    return {"competency_code": c["code"], "evidence": c["answer_ids"][:8],
            "reasoning_summary": tr("analysis.reasoning", n=len(c["answer_ids"]), score=c["score"]),
            "confidence": CONFIDENCE_CAP.get(c["evidence_level"], "low")}


def heuristic_analysis(facts: dict) -> dict:
    comps = facts["competencies"]
    by_score = sorted(comps, key=lambda c: (-c["score"], c["code"]))
    areas = sorted((c for c in comps if (c["gap"] or 0) > 0), key=lambda c: c["priority_rank"] or 99)[:3]
    strengths = [c for c in by_score if c["score"] >= STRENGTH_MIN_SCORE
                 and c["evidence_level"] not in ("insufficient", "not_recorded")][:3]
    resources = facts["catalog"]["resources"]
    tasks = facts["catalog"]["tasks"]
    actions, milestones = [], []
    for c in areas:
        res = next((r for r in resources if r["competency_code"] == c["code"] and not r["completed"]), None)
        task = next((t for t in tasks if t["competency_code"] == c["code"] and not t["completed"]), None)
        if res:
            actions.append({"competency_code": c["code"], "kind": "learn", "resource_id": res["id"], "task_id": None,
                            "reason": tr("analysis.reason_learn", name=c["name"], score=c["score"])})
        if task:
            actions.append({"competency_code": c["code"], "kind": "practice", "resource_id": None,
                            "task_id": task["id"], "reason": tr("analysis.reason_practice", name=c["name"])})
        if not res and not task:
            done_all = any(x["competency_code"] == c["code"] for x in (*resources, *tasks))
            reason = tr("analysis.reason_reflect_done" if done_all else "analysis.reason_reflect", name=c["name"])
            actions.append({"competency_code": c["code"], "kind": "reflect", "resource_id": None, "task_id": None,
                            "reason": reason})
        milestones.append({"competency_code": c["code"],
                           "objective": tr("analysis.objective", name=c["name"], score=c["score"], target=c["target"]),
                           "measure": tr("analysis.measure"), "target_weeks": 6})
    best = strengths[0] if strengths else (by_score[0] if by_score else None)
    summary = (
        tr("analysis.summary", overall=facts["overall_score"], best=best["name"], gap=areas[0]["name"])
        if best and areas else
        tr("analysis.summary_no_gap", overall=facts["overall_score"], best=best["name"] if best else "—")
    )
    weak = [c for c in comps if c["evidence_level"] in ("limited", "insufficient", "not_recorded")]
    progress = []
    for p in (facts.get("progress") or {}).get("competencies", []):
        if p["change"]:
            name = next(c["name"] for c in comps if c["code"] == p["code"])
            key = "analysis.progress_up" if p["change"] > 0 else "analysis.progress_down"
            progress.append({"competency_code": p["code"],
                             "explanation": tr(key, name=name, previous=p["previous"], current=p["current"])})
    return {
        "summary": summary,
        "strengths": [{**_claim_fields(c), "explanation": tr("analysis.strength", score=c["score"])}
                      for c in strengths],
        "development_areas": [{**_claim_fields(c), "priority": i + 1,
                               "explanation": tr("analysis.area", score=c["score"], target=c["target"])}
                              for i, c in enumerate(areas)],
        "competency_insights": [],
        "recommended_actions": actions,
        "milestones": milestones,
        "progress_notes": progress[:15],
        "limitations": [tr("analysis.estimate_note"),
                        *(tr("analysis.limited_evidence", name=c["name"]) for c in weak[:4])],
        "additional_questions": [tr("analysis.question_more", name=c["name"]) for c in weak[:3]],
        "reassessment_weeks": 6,
        "language": facts["language"],
    }


# --- Running ----------------------------------------------------------------------------------------------------------

def get_analysis(db: Session, attempt_id: int) -> AIAnalysis | None:
    return db.scalar(select(AIAnalysis).where(AIAnalysis.attempt_id == attempt_id))


def enqueue(db: Session, user: User, attempt: AssessmentAttempt) -> None:
    """Queue the analysis of a just-completed attempt (status pending; caller commits). Runs on the first request."""
    if get_analysis(db, attempt.id) is None:
        db.add(AIAnalysis(user_id=user.id, attempt_id=attempt.id, status=PENDING, language=language_var.get(), runs=0))


def _aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=utcnow().tzinfo)


def _claim(db: Session, user: User, attempt: AssessmentAttempt, regenerate: bool) -> AIAnalysis | None:
    """Marks the analysis as processing (committed, so a parallel request sees it). None = nothing to do now. A
    previous completed output stays in the row while it runs, so a failed regeneration can keep it."""
    now = utcnow()
    row = get_analysis(db, attempt.id)
    if row is None:
        try:
            with db.begin_nested():
                row = AIAnalysis(user_id=user.id, attempt_id=attempt.id, status=PENDING, language=language_var.get(),
                                 runs=0)
                db.add(row)
                db.flush()
        except IntegrityError:  # another request created it first
            return None
    elif row.status == PROCESSING and now - _aware(row.updated_at) < STALE_PROCESSING:
        return None  # already running
    elif row.status == COMPLETED and not regenerate:
        return None
    row.status = PROCESSING
    row.runs = (row.runs or 0) + 1
    row.updated_at = now
    db.commit()
    return row


def _digest(*parts: object) -> str:
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


def run_analysis(
    db: Session, user: User, attempt: AssessmentAttempt, *, regenerate: bool = False, provider: AIProvider | None = None
) -> AIAnalysis:
    """Create, retry or regenerate the analysis of `attempt` (completed, owned by `user`). Idempotent: one row."""
    if attempt.user_id != user.id:  # pragma: no cover - routes load the attempt through the owner
        raise PermissionError("attempt does not belong to the user")
    previous_status = (existing := get_analysis(db, attempt.id)) and existing.status
    row = _claim(db, user, attempt, regenerate)
    if row is None:
        existing = get_analysis(db, attempt.id)
        assert existing is not None
        return existing
    provider = provider or get_provider()
    pv, system, user_tpl = active_prompt(db, ANALYSIS_KEY)
    facts = build_facts(db, user, attempt)
    lang = facts["language"]
    digest = _digest(facts, system, user_tpl, provider.name, provider.model)
    if previous_status == COMPLETED and row.output and row.input_digest == digest:
        # Same input as the stored result: nothing new to say, no provider call.
        row.status, row.updated_at = COMPLETED, utcnow()
        db.commit()
        return row
    user_prompt = user_tpl.format(facts=json.dumps(facts, ensure_ascii=False))
    req = InsightRequest(facts, f"{system}\n\n{tr('analysis.language_instruction')}", user_prompt)
    started = time.monotonic()
    tries = max(1, get_settings().ai_max_retries + 1)
    out: DevelopmentAnalysis | None = None
    error_code = None
    lowered = 0
    tokens = {"prompt": 0, "completion": 0}
    for n in range(tries):
        try:
            raw = provider.analyze(req)
            out = DevelopmentAnalysis.model_validate(json.loads(raw))
            lowered = check_references(out, facts)
            if provider.name != "mock":
                # The summary on its own (it leads the screen) and all texts together (reasons may quote an
                # untranslated resource title, so single short fields are not judged alone).
                check_language([out.summary], lang)
                check_language(_texts(out), lang)
            break
        except LanguageMismatch as e:
            error_code, out = "wrong_language", None
            log.warning("analysis %s try %s: %s", attempt.id, n + 1, e)
            req.user_prompt = user_prompt + "\n\n" + tr("analysis.language_instruction")
        except (json.JSONDecodeError, PydanticValidationError, InvalidReferences) as e:
            error_code, out = "invalid_output", None
            # The reason only (schema path / which reference); never the model's text or the facts.
            log.warning("analysis %s try %s: %s: %s", attempt.id, n + 1, type(e).__name__, str(e)[:300])
        except AIProviderError as e:
            error_code, out = ("rate_limited" if "429" in str(e) else "provider_unavailable"), None
            log.warning("analysis %s try %s: provider error: %s", attempt.id, n + 1, e)
            if error_code == "rate_limited":
                break
        finally:
            usage = getattr(provider, "last_usage", None) or {}
            tokens["prompt"] += usage.get("prompt_tokens") or 0
            tokens["completion"] += usage.get("completion_tokens") or 0
    if lowered:
        log.info("analysis %s: confidence lowered to the evidence level on %s claim(s)", attempt.id, lowered)
    row.provider, row.model = provider.name, provider.model
    row.prompt_version_id = pv.id if pv else None
    row.latency_ms = int((time.monotonic() - started) * 1000)
    row.prompt_tokens = tokens["prompt"] or None
    row.completion_tokens = tokens["completion"] or None
    if out is not None:
        row.status, row.output, row.error_code, row.completed_at = COMPLETED, out.model_dump(), None, utcnow()
        row.language, row.input_digest = lang, digest
    elif row.output and row.completed_at:
        # A regeneration failed: the analysis written before stays (in its language); error_code says why the new
        # one could not be written.
        row.status, row.error_code = COMPLETED, error_code
        row.language = row.output.get("language", row.language)
    else:
        row.status, row.error_code = FAILED, error_code
        row.language = lang
    row.updated_at = utcnow()
    db.commit()
    return row
