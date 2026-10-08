"""Deterministic scoring engine.

    answer → item score (0–100) → per-method weighted mean → method-weighted competency score
           → level (bands) → stored CompetencyScore (immutable)

Item scores
    likert / situational: option.score (reverse-scored likert: 100 − score)
    open / practical:     AI rubric ratings (0–4 per criterion) → mean → 0–100. Criteria tagged with a
                          competency only count toward that competency.
Method weights (renormalised over the methods present for a competency)
    self-assessment 20% · situational judgement 40% · open answers & practical 40%
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.service import evaluate_text, rubric_score
from app.models import (
    AIEvaluation,
    Answer,
    AssessmentAttempt,
    Competency,
    CompetencyLevel,
    CompetencyScore,
    Question,
)
from app.models.enums import AIInputType, QuestionType
from app.services.levels import clamp_score, level_rank_for

METHOD_OF = {
    QuestionType.LIKERT: "self",
    QuestionType.SITUATIONAL: "situational",
    QuestionType.OPEN: "open",
    QuestionType.PRACTICAL: "open",
}
METHOD_WEIGHTS = {"self": 0.2, "situational": 0.4, "open": 0.4}
METHOD_LABEL = {"self": "self-assessment", "situational": "situational judgement", "open": "open answers"}
CHOICE_CONFIDENCE = 0.9


@dataclass
class Item:
    method: str
    weight: float
    score: float
    confidence: float = CHOICE_CONFIDENCE


@dataclass
class CompetencyResult:
    score: int
    raw_score: float
    max_raw_score: float
    method_scores: dict[str, float] = field(default_factory=dict)
    confidence: float = 0.0


def combine(items: list[Item]) -> CompetencyResult | None:
    """Pure function: combine weighted item scores into a competency score."""
    if not items:
        return None
    by_method: dict[str, list[Item]] = defaultdict(list)
    for it in items:
        by_method[it.method].append(it)
    method_scores = {
        m: sum(i.weight * i.score for i in its) / sum(i.weight for i in its) for m, its in by_method.items()
    }
    total_mw = sum(METHOD_WEIGHTS[m] for m in method_scores)
    combined = sum(METHOD_WEIGHTS[m] * s for m, s in method_scores.items()) / total_mw
    raw = sum(i.weight * i.score / 100 for i in items)
    max_raw = sum(i.weight for i in items)
    coverage = total_mw  # 1.0 when all three methods are present
    item_conf = sum(i.confidence * i.weight for i in items) / max_raw
    confidence = round(0.4 * coverage + 0.6 * item_conf, 2)
    return CompetencyResult(
        score=clamp_score(combined),
        raw_score=round(raw, 3),
        max_raw_score=round(max_raw, 3),
        method_scores={m: round(s, 1) for m, s in method_scores.items()},
        confidence=confidence,
    )


def explain(result: CompetencyResult) -> str:
    present = [m for m in ("self", "situational", "open") if m in result.method_scores]
    total = sum(METHOD_WEIGHTS[m] for m in present)
    mix = ", ".join(f"{METHOD_LABEL[m]} ({round(METHOD_WEIGHTS[m] / total * 100)}%)" for m in present)
    parts = " · ".join(f"{METHOD_LABEL[m].capitalize()} {round(result.method_scores[m])}" for m in present)
    text = f"Combines {mix}. {parts}."
    self_s = result.method_scores.get("self")
    shown = [result.method_scores[m] for m in ("situational", "open") if m in result.method_scores]
    if self_s is not None and shown:
        demo = sum(shown) / len(shown)
        if self_s - demo >= 20:
            text += " Your self-rating is higher than what your situational and open answers demonstrate."
        elif demo - self_s >= 20:
            text += " Your answers demonstrate more than your self-rating suggests."
    return text


def item_score_for_choice(answer: Answer, question: Question) -> float:
    if answer.option is None:
        return 0.0
    s = float(answer.option.score)
    return 100.0 - s if question.reverse_scored else s


def _primary_competency(q: Question, competencies: dict[int, Competency]) -> Competency:
    link = max(q.competency_links, key=lambda link: link.weight)
    return competencies[link.competency_id]


def evaluate_open_answer(
    db: Session, user_id: int, answer: Answer, question: Question, competencies: dict[int, Competency]
) -> AIEvaluation:
    existing = db.scalar(
        select(AIEvaluation).where(AIEvaluation.answer_id == answer.id).order_by(AIEvaluation.id.desc())
    )
    if existing is not None:
        return existing
    primary = _primary_competency(question, competencies)
    res = evaluate_text(
        db,
        user_id=user_id,
        competency_id=primary.id,
        competency_name=primary.name,
        question=question.text,
        answer=answer.text_response or "",
        rubric=question.rubric or [],
        input_type=AIInputType.PRACTICAL_ANSWER if question.type == QuestionType.PRACTICAL else AIInputType.OPEN_ANSWER,
        answer_id=answer.id,
    )
    return res.record


def score_attempt(
    db: Session, attempt: AssessmentAttempt, questions: list[Question], competency_ids: list[int]
) -> list[CompetencyScore]:
    competencies = {c.id: c for c in db.scalars(select(Competency))}
    levels = {lv.rank: lv for lv in db.scalars(select(CompetencyLevel))}
    answers = {a.question_id: a for a in attempt.answers}
    code_to_id = {c.code: c.id for c in competencies.values()}

    items: dict[int, list[Item]] = defaultdict(list)
    for q in questions:
        a = answers.get(q.id)
        if a is None:
            continue
        method = METHOD_OF[q.type]
        if q.type in (QuestionType.LIKERT, QuestionType.SITUATIONAL):
            s = item_score_for_choice(a, q)
            a.item_score = s
            for link in q.competency_links:
                items[link.competency_id].append(Item(method, link.weight, s))
        else:
            ev = evaluate_open_answer(db, attempt.user_id, a, q, competencies)
            criteria = (ev.output or {}).get("criteria", [])
            rubric = q.rubric or []
            a.item_score = float(ev.score or 0)
            conf = float(ev.confidence or 0.5)
            for link in q.competency_links:
                own = [r for r in rubric if code_to_id.get(r.get("competency") or "") == link.competency_id]
                s = rubric_score(criteria, own) if own else float(ev.score or 0)
                items[link.competency_id].append(Item(method, link.weight, s, conf))

    results: list[CompetencyScore] = []
    for cid in competency_ids:
        r = combine(items.get(cid, []))
        if r is None:
            continue
        row = CompetencyScore(
            attempt_id=attempt.id,
            user_id=attempt.user_id,
            competency_id=cid,
            raw_score=r.raw_score,
            max_raw_score=r.max_raw_score,
            score=r.score,
            level_id=levels[level_rank_for(r.score)].id,
            self_score=r.method_scores.get("self"),
            situational_score=r.method_scores.get("situational"),
            open_score=r.method_scores.get("open"),
            confidence=r.confidence,
            explanation=explain(r),
        )
        db.add(row)
        results.append(row)
    db.flush()
    return results
