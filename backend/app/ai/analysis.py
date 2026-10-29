"""AI development analysis of a completed assessment (step "AI Analysis" of the product loop).

    scores (deterministic, services/scoring.py) ─┐
    gaps + priorities (services/gaps.py)          ├─► facts ─► provider ─► JSON ─► schema ─► reference check ─► saved
    goals, learner context, available catalog ────┘                         (retry on invalid / wrong language)

The analysis explains and prioritises; it never changes a score, a gap or a plan item. Every competency, resource
and task it names is checked against the facts it was given (real, published, available to this learner). One row
per attempt (`ai_analyses`): retries and regeneration update it, so results are never duplicated. When the provider
fails the row is "failed" with a stable error code and the learner can retry; nothing is invented in its place.

Data minimisation: the provider receives scores, evidence levels, goal codes/titles, experience level, weekly time,
counts of completed activities and catalog titles. No name, email, free-text answer or other personal data.
"""

from __future__ import annotations

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

from app.ai.prompts import ANALYSIS_KEY
from app.ai.providers import AIProvider, AIProviderError, InsightRequest, get_provider
from app.ai.service import LanguageMismatch, active_prompt, check_language
from app.core.config import get_settings
from app.core.context import language_var
from app.core.database import utcnow
from app.core.i18n import tr
from app.models import (
    AIAnalysis,
    AssessmentAttempt,
    Competency,
    CompetencyGap,
    CompetencyScore,
    LearningResource,
    PracticalTask,
    User,
    UserGoal,
)
from app.models.enums import ContentStatus, Difficulty
from app.services import entitlements
from app.services import recommendations as rec_service

log = logging.getLogger("isker.ai.analysis")

PENDING, SUCCEEDED, FAILED = "pending", "succeeded", "failed"
STALE_PENDING = timedelta(minutes=3)  # a run older than this is treated as interrupted and may be restarted
MAX_FOCUS = 5  # competencies (by gap priority) whose catalog items are offered to the model
MAX_RESOURCES, MAX_TASKS = 3, 2  # per focus competency


# --- Output schema (validated before anything is saved) ---------------------------------------------------------------

class _Out(BaseModel):
    model_config = ConfigDict(extra="ignore")


class StrengthItem(_Out):
    competency_code: str = Field(min_length=1, max_length=48)
    explanation: str = Field(min_length=1, max_length=500)


class DevelopmentArea(_Out):
    competency_code: str = Field(min_length=1, max_length=48)
    explanation: str = Field(min_length=1, max_length=500)
    priority: int = Field(ge=1, le=5)


class CompetencyInsight(_Out):
    competency_code: str = Field(min_length=1, max_length=48)
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


class DevelopmentAnalysis(_Out):
    summary: str = Field(min_length=1, max_length=1500)
    strengths: list[StrengthItem] = Field(default_factory=list, max_length=5)
    development_areas: list[DevelopmentArea] = Field(default_factory=list, max_length=5)
    competency_insights: list[CompetencyInsight] = Field(default_factory=list, max_length=15)
    recommended_actions: list[RecommendedAction] = Field(default_factory=list, max_length=10)
    milestones: list[Milestone] = Field(default_factory=list, max_length=6)
    confidence_notes: list[str] = Field(default_factory=list, max_length=6)
    reassessment_weeks: int = Field(ge=2, le=26)
    language: str = Field(min_length=2, max_length=8)


class InvalidReferences(ValueError):
    """The model named a competency, resource or task that is not in the facts it was given."""


# --- Facts ------------------------------------------------------------------------------------------------------------

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


def check_references(out: DevelopmentAnalysis, facts: dict) -> None:
    codes = {c["code"] for c in facts["competencies"]}
    resources = {r["id"]: r["competency_code"] for r in facts["catalog"]["resources"]}
    tasks = {t["id"]: t["competency_code"] for t in facts["catalog"]["tasks"]}
    named = [x.competency_code for group in (out.strengths, out.development_areas, out.competency_insights,
                                             out.recommended_actions, out.milestones) for x in group]
    unknown = sorted(set(named) - codes)
    if unknown:
        raise InvalidReferences(f"unknown competency codes: {unknown}")
    for a in out.recommended_actions:
        if a.kind == "learn" and resources.get(a.resource_id or -1) != a.competency_code:
            raise InvalidReferences(f"learn action without a matching catalog resource: {a.resource_id}")
        if a.kind == "practice" and tasks.get(a.task_id or -1) != a.competency_code:
            raise InvalidReferences(f"practice action without a matching catalog task: {a.task_id}")
        if a.kind == "reflect" and (a.resource_id or a.task_id):
            raise InvalidReferences("reflect action must not reference a resource or task")
    if out.language != facts["language"]:
        raise LanguageMismatch(f"language field is {out.language!r}, expected {facts['language']!r}")


def _texts(out: DevelopmentAnalysis) -> list[str]:
    return [out.summary, *(s.explanation for s in out.strengths), *(d.explanation for d in out.development_areas),
            *(i.insight for i in out.competency_insights), *(a.reason for a in out.recommended_actions),
            *(m.objective for m in out.milestones), *out.confidence_notes]


# --- Rule-based analysis (the mock provider; texts from the catalog in the requested language) ----------------------

def heuristic_analysis(facts: dict) -> dict:
    comps = facts["competencies"]
    by_score = sorted(comps, key=lambda c: (-c["score"], c["code"]))
    areas = sorted((c for c in comps if (c["gap"] or 0) > 0), key=lambda c: c["priority_rank"] or 99)[:3]
    strengths = by_score[:3] if len(comps) > 1 else by_score[:1]
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
    best = by_score[0] if by_score else None
    summary = (
        tr("analysis.summary", overall=facts["overall_score"], best=best["name"], gap=areas[0]["name"])
        if best and areas else
        tr("analysis.summary_no_gap", overall=facts["overall_score"], best=best["name"] if best else "—")
    )
    notes = [tr("analysis.limited_evidence", name=c["name"]) for c in comps
             if c["evidence_level"] in ("limited", "insufficient")][:4]
    return {
        "summary": summary,
        "strengths": [{"competency_code": c["code"], "explanation": tr("analysis.strength", score=c["score"])}
                      for c in strengths],
        "development_areas": [{"competency_code": c["code"], "priority": i + 1,
                               "explanation": tr("analysis.area", score=c["score"], target=c["target"])}
                              for i, c in enumerate(areas)],
        "competency_insights": [],
        "recommended_actions": actions,
        "milestones": milestones,
        "confidence_notes": [tr("analysis.estimate_note"), *notes],
        "reassessment_weeks": 6,
        "language": facts["language"],
    }


# --- Running ----------------------------------------------------------------------------------------------------------

def get_analysis(db: Session, attempt_id: int) -> AIAnalysis | None:
    return db.scalar(select(AIAnalysis).where(AIAnalysis.attempt_id == attempt_id))


def _claim(db: Session, user: User, attempt: AssessmentAttempt, regenerate: bool) -> AIAnalysis | None:
    """Marks the analysis as running (committed, so a parallel request sees it). None = nothing to do now. A
    previous successful output stays in the row while it runs, so a failed regeneration can keep it."""
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
    else:
        updated = row.updated_at if row.updated_at.tzinfo else row.updated_at.replace(tzinfo=now.tzinfo)
        if row.status == PENDING and now - updated < STALE_PENDING:
            return None  # already running
        if row.status == SUCCEEDED and not regenerate:
            return None
    row.status = PENDING
    row.language = language_var.get()
    row.runs = (row.runs or 0) + 1
    row.error_code = None
    row.updated_at = now
    db.commit()
    return row


def run_analysis(
    db: Session, user: User, attempt: AssessmentAttempt, *, regenerate: bool = False, provider: AIProvider | None = None
) -> AIAnalysis:
    """Create, retry or regenerate the analysis of `attempt` (completed, owned by `user`). Idempotent: one row."""
    row = _claim(db, user, attempt, regenerate)
    if row is None:
        existing = get_analysis(db, attempt.id)
        assert existing is not None
        return existing
    provider = provider or get_provider()
    pv, system, user_tpl = active_prompt(db, ANALYSIS_KEY)
    facts = build_facts(db, user, attempt)
    lang = facts["language"]
    user_prompt = user_tpl.format(facts=json.dumps(facts, ensure_ascii=False))
    req = InsightRequest(facts, f"{system}\n\n{tr('analysis.language_instruction')}", user_prompt)
    started = time.monotonic()
    tries = max(1, get_settings().ai_max_retries + 1)
    out: DevelopmentAnalysis | None = None
    error_code = None
    for n in range(tries):
        try:
            out = DevelopmentAnalysis.model_validate(json.loads(provider.analyze(req)))
            check_references(out, facts)
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
            log.warning("analysis %s try %s: %s: %s", attempt.id, n + 1, type(e).__name__, str(e)[:300])
        except AIProviderError as e:
            error_code, out = ("rate_limited" if "429" in str(e) else "provider_unavailable"), None
            log.warning("analysis %s try %s: provider error: %s", attempt.id, n + 1, e)
            if error_code == "rate_limited":
                break
    row.provider, row.model = provider.name, provider.model
    row.prompt_version_id = pv.id if pv else None
    row.latency_ms = int((time.monotonic() - started) * 1000)
    if out is not None:
        row.status, row.output, row.error_code, row.completed_at = SUCCEEDED, out.model_dump(), None, utcnow()
        row.language = lang
    elif row.output and row.completed_at:
        # A regeneration failed: the analysis written before stays (in its language); error_code says why the new
        # one could not be written.
        row.status, row.error_code = SUCCEEDED, error_code
        row.language = row.output.get("language", row.language)
    else:
        row.status, row.error_code = FAILED, error_code
    row.updated_at = utcnow()
    db.commit()
    return row
