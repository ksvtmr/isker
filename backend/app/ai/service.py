"""AI evaluation service: prompt versioning, validation, retry, safe fallback, audit trail.

Flow for each call:
    provider.raw → JSON parse → Pydantic validation → (retry once on invalid) → fallback heuristic
The scoring engine then recomputes the score from rubric criterion ratings (0–4), so the model can
never set an unconstrained final score.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass

from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.prompts import DEFAULT_PROMPTS, EVALUATION_KEY, INSIGHT_KEY
from app.ai.providers import (
    AIProvider,
    AIProviderError,
    EvaluationRequest,
    InsightRequest,
    get_provider,
    heuristic_evaluation,
    heuristic_insight,
)
from app.ai.schemas import EvaluationOutput, InsightOutput
from app.core.config import get_settings
from app.models import AIEvaluation, AIPromptVersion
from app.models.enums import AIEvalStatus, AIInputType
from app.services.levels import level_name_for

log = logging.getLogger("isker.ai")


@dataclass
class EvaluationResult:
    output: EvaluationOutput
    score: int  # rubric-constrained
    record: AIEvaluation


def active_prompt(db: Session, key: str) -> tuple[AIPromptVersion | None, str, str]:
    pv = db.scalar(
        select(AIPromptVersion)
        .where(AIPromptVersion.key == key, AIPromptVersion.is_active.is_(True))
        .order_by(AIPromptVersion.version.desc())
    )
    if pv:
        return pv, pv.system_prompt, pv.user_template
    system, user = DEFAULT_PROMPTS[key]
    return None, system, user


def rubric_score(criteria: list[dict] | list, rubric: list[dict]) -> int:
    """Score = mean(rating / 4) over rubric criteria. Missing criteria count as 0."""
    if not rubric:
        return 0
    by_name = {}
    for c in criteria:
        d = c if isinstance(c, dict) else c.model_dump()
        by_name[d["criterion"].strip().lower()] = int(d["rating"])
    total = sum(max(0, min(4, by_name.get(r["criterion"].strip().lower(), 0))) for r in rubric)
    return round(total / (4 * len(rubric)) * 100)


def _format_rubric(rubric: list[dict]) -> str:
    return "\n".join(f"- {r['criterion']}: {r['description']}" for r in rubric)


def evaluate_text(
    db: Session,
    *,
    user_id: int | None,
    competency_id: int | None,
    competency_name: str,
    question: str,
    answer: str,
    rubric: list[dict],
    input_type: AIInputType,
    answer_id: int | None = None,
    practice_submission_id: int | None = None,
    provider: AIProvider | None = None,
) -> EvaluationResult:
    settings = get_settings()
    provider = provider or get_provider()
    pv, system, user_tpl = active_prompt(db, EVALUATION_KEY)
    user_prompt = user_tpl.format(
        competency=competency_name, question=question, rubric=_format_rubric(rubric), answer=answer
    )
    req = EvaluationRequest(competency_name, question, answer, rubric, system, user_prompt)

    started = time.monotonic()
    output: EvaluationOutput | None = None
    errors: list[str] = []
    attempts = 0
    for _ in range(1 + max(0, settings.ai_max_retries)):
        attempts += 1
        try:
            raw = provider.evaluate(req)
            output = EvaluationOutput.model_validate(json.loads(raw))
            # Every rubric criterion must be rated, otherwise the output is not usable.
            rated = {c.criterion.strip().lower() for c in output.criteria}
            missing = [r["criterion"] for r in rubric if r["criterion"].strip().lower() not in rated]
            if missing:
                raise ValueError(f"missing criteria: {', '.join(missing)}")
            break
        except (AIProviderError, json.JSONDecodeError, PydanticValidationError, ValueError) as e:
            errors.append(f"attempt {attempts}: {type(e).__name__}: {str(e)[:200]}")
            output = None
            req.user_prompt = (
                user_prompt + "\n\nYour previous reply was invalid. Return ONLY the JSON object, "
                "rating every rubric criterion."
            )

    if output is not None:
        status = AIEvalStatus.SUCCESS if attempts == 1 else AIEvalStatus.RETRIED
        prov_name, model = provider.name, provider.model
    else:
        # Safe fallback: deterministic rubric heuristic. The assessment never crashes.
        log.warning("AI evaluation fell back to heuristic after %d attempts", attempts)
        output = EvaluationOutput.model_validate(heuristic_evaluation(competency_name, answer, rubric))
        output.confidence = min(output.confidence, 0.5)
        status = AIEvalStatus.FALLBACK
        prov_name, model = "fallback", "heuristic-rubric-v1"

    score = rubric_score(output.criteria, rubric)
    output.score = score
    output.level = level_name_for(score)
    record = AIEvaluation(
        user_id=user_id,
        answer_id=answer_id,
        practice_submission_id=practice_submission_id,
        competency_id=competency_id,
        prompt_version_id=pv.id if pv else None,
        input_type=input_type,
        provider=prov_name,
        model=model,
        status=status,
        input_excerpt=answer[:500],
        output=output.model_dump(),
        score=score,
        level=output.level,
        confidence=output.confidence,
        evidence=output.evidence,
        strengths=output.strengths,
        development_areas=output.development_areas,
        explanation=output.explanation,
        error="\n".join(errors) or None,
        attempts=attempts,
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    db.add(record)
    db.flush()
    return EvaluationResult(output=output, score=score, record=record)


def generate_insight(
    db: Session, *, user_id: int, facts: dict, attempt_id: int | None = None, provider: AIProvider | None = None
) -> AIEvaluation:
    provider = provider or get_provider()
    pv, system, user_tpl = active_prompt(db, INSIGHT_KEY)
    req = InsightRequest(facts, system, user_tpl.format(facts=json.dumps(facts, ensure_ascii=False)))
    started = time.monotonic()
    err = None
    try:
        out = InsightOutput.model_validate(json.loads(provider.insight(req)))
        status, prov_name, model = AIEvalStatus.SUCCESS, provider.name, provider.model
    except (AIProviderError, json.JSONDecodeError, PydanticValidationError, ValueError) as e:
        err = f"{type(e).__name__}: {str(e)[:200]}"
        out = InsightOutput.model_validate(heuristic_insight(facts))
        status, prov_name, model = AIEvalStatus.FALLBACK, "fallback", "heuristic-insight-v1"
    record = AIEvaluation(
        user_id=user_id,
        attempt_id=attempt_id,
        prompt_version_id=pv.id if pv else None,
        input_type=AIInputType.PROFILE_INSIGHT,
        provider=prov_name,
        model=model,
        status=status,
        input_excerpt=json.dumps(facts, ensure_ascii=False)[:500],
        output=out.model_dump(),
        confidence=out.confidence,
        explanation=out.body,
        error=err,
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    db.add(record)
    db.flush()
    return record
