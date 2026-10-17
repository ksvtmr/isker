from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload, selectinload

from app.ai.providers import heuristic_evaluation
from app.api.deps import DB, CurrentUser
from app.core.content_i18n import base_text, match_ratings, rubric_aliases
from app.core.errors import NotFoundError
from app.core.i18n import lang, tr
from app.models import (
    AIEvaluation,
    Answer,
    Competency,
    CompetencyArea,
    CompetencyLevel,
    LearningResource,
    PracticalTask,
    PracticeSubmission,
    Question,
    QuestionCompetency,
    Recommendation,
    UserLearningProgress,
)
from app.models.enums import ContentStatus, QuestionType, RecommendationStatus
from app.schemas.common import ERROR_RESPONSES
from app.schemas.competency import (
    AIExplanationOut,
    AreaOut,
    CompetencyCatalog,
    CompetencyDetail,
    CompetencyOut,
    CriterionOut,
    EvidenceOut,
    HistoryPoint,
    LevelOut,
    RecommendedItem,
)
from app.schemas.results import GapOut, ProfileOverview
from app.services import gaps as gap_service
from app.services import scoring, views
from app.services.profile import history

router = APIRouter(tags=["competencies"], responses=ERROR_RESPONSES)


def section_label(qtype: QuestionType) -> str:
    return tr(f"section.{qtype.value}")


def likert_word(value: int) -> str:
    return tr(f"likert.{value}")


@router.get("/api/competencies", response_model=CompetencyCatalog, summary="EntreComp catalogue")
def catalog(db: DB) -> CompetencyCatalog:
    return CompetencyCatalog(
        areas=[
            AreaOut.model_validate(a) for a in db.scalars(select(CompetencyArea).order_by(CompetencyArea.sort_order))
        ],
        competencies=[CompetencyOut.model_validate(c) for c in views.competencies(db, published_only=True)],
        levels=[
            LevelOut.model_validate(lv) for lv in db.scalars(select(CompetencyLevel).order_by(CompetencyLevel.rank))
        ],
    )


@router.get(
    "/api/scores/profile",
    response_model=ProfileOverview,
    tags=["scores"],
    summary="Current competency profile (latest score per competency)",
)
def profile(user: CurrentUser, db: DB) -> ProfileOverview:
    return views.profile_overview(db, user.id)


@router.get("/api/gaps", response_model=list[GapOut], tags=["gaps"], summary="Latest gap analysis, by priority")
def gaps(user: CurrentUser, db: DB) -> list[GapOut]:
    rows = gap_service.latest_gaps(db, user.id)
    comps = {c.id: c for c in views.competencies(db)}
    return [
        GapOut(
            competency_id=g.competency_id,
            code=comps[g.competency_id].code,
            name=comps[g.competency_id].name,
            area_name=comps[g.competency_id].area.name,
            current=g.current_score,
            target=g.target_score,
            gap=g.gap,
            band=g.band,
            priority_rank=g.priority_rank,
            priority_label=tr(f"priority.{g.priority_label}"),
            priority_score=g.priority_score,
            goal_relevance=g.goal_relevance,
            importance=g.importance,
            learning_priority=g.learning_priority,
        )
        for g in rows
    ]


def _find(db, key: str) -> Competency:
    q = select(Competency).options(joinedload(Competency.area))
    c = db.scalar(q.where(Competency.id == int(key))) if key.isdigit() else db.scalar(q.where(Competency.code == key))
    # Drafts are invisible to learners; archived competencies stay reachable so past results still render.
    if c is None or c.status == ContentStatus.DRAFT:
        raise NotFoundError("Competency not found", "COMPETENCY_NOT_FOUND")
    return c


@router.get(
    "/api/competencies/{key}",
    response_model=CompetencyDetail,
    summary="Competency detail: score, why this score (evidence + AI), history, recommendations",
)
def detail(key: str, user: CurrentUser, db: DB) -> CompetencyDetail:
    c = _find(db, key)
    hist = history(db, user.id).get(c.id, [])
    latest = hist[-1][0] if hist else None
    latest_attempt = hist[-1][1] if hist else None
    gap = None
    if latest_attempt is not None:
        last = gap_service.latest_gaps(db, user.id)
        gap = next((g for g in last if g.competency_id == c.id), None)
    change = (hist[-1][0].score - hist[-2][0].score) if len(hist) >= 2 else None
    current = views.score_out(c, latest, gap, change)

    evidence: list[EvidenceOut] = []
    criteria_acc: dict[str, list[int]] = defaultdict(list)
    ai_out: list[AIExplanationOut] = []
    if latest_attempt is not None:
        rows = db.execute(
            select(Answer, Question)
            .join(Question, Question.id == Answer.question_id)
            .join(QuestionCompetency, QuestionCompetency.question_id == Question.id)
            .where(Answer.attempt_id == latest_attempt.id, QuestionCompetency.competency_id == c.id)
            .options(joinedload(Answer.option))
            .order_by(Question.sort_order)
        ).all()
        for ans, q in rows:
            src = f"Q{q.sort_order} · {section_label(q.type)}"
            if q.type in (QuestionType.OPEN, QuestionType.PRACTICAL):
                ev = db.scalar(
                    select(AIEvaluation)
                    .where(AIEvaluation.answer_id == ans.id)
                    .options(joinedload(AIEvaluation.prompt_version))
                    .order_by(AIEvaluation.id.desc())
                )
                if ev is None:
                    continue
                out = ev.output or {}
                rubric = q.rubric or []
                # Stored ratings are matched to the rubric by criterion name in any language, by position only when
                # no name matches (the names depend on the language the evaluation was made in).
                aliases = rubric_aliases(base_text(q, "rubric"), q.translations)
                ratings = match_ratings(out.get("criteria") or [], aliases)
                language = ev.language
                if ev.provider in views.RULE_BASED and q.rubric:
                    # Deterministic: compose the texts again with the rubric in the current language.
                    out = heuristic_evaluation(c.name, ans.text_response or "", q.rubric, ratings)
                    language = lang()
                for i, r in enumerate(rubric):
                    rating = ratings[i] if i < len(ratings) else None
                    if r.get("competency") in (None, c.code) and rating is not None:
                        criteria_acc[r["criterion"]].append(int(rating) * 25)
                excerpt = (ans.text_response or "")[:280]
                positive = (ev.score or 0) >= 60
                tag = (
                    (out.get("strengths") or [tr("evidence.clear_reasoning")])[0]
                    if positive
                    else tr(
                        "evidence.needs_more", what=(out.get("development_areas") or [tr("evidence.detail")])[0].lower()
                    )
                )
                evidence.append(
                    EvidenceOut(source=src, question=q.text, excerpt=f"“{excerpt}”", tag=tag, positive=positive)
                )
                ai_out.append(
                    AIExplanationOut(
                        evaluation_id=ev.id,
                        confidence=ev.confidence,
                        provider=ev.provider,
                        model=ev.model,
                        prompt_version=ev.prompt_version.version if ev.prompt_version else None,
                        strengths=out.get("strengths") or ev.strengths or [],
                        development_areas=out.get("development_areas") or ev.development_areas or [],
                        explanation=out.get("explanation") or ev.explanation,
                        language=language,
                    )
                )
            elif ans.option is not None:
                s = ans.option.score if not q.reverse_scored else 100 - ans.option.score
                if q.type == QuestionType.LIKERT:
                    value = ans.option.value
                    word = likert_word(value) if value is not None and 1 <= value <= 5 else ans.option.label
                    text = tr("evidence.you_answered", question=q.text, answer=word)
                    tag = tr("evidence.self_rating")
                else:
                    text = tr("evidence.you_chose", answer=ans.option.label)
                    tag = tr(
                        "evidence.effective"
                        if s >= 70
                        else "evidence.partly_effective"
                        if s >= 40
                        else "evidence.less_effective"
                    )
                evidence.append(EvidenceOut(source=src, question=q.text, excerpt=text, tag=tag, positive=s >= 60))

    progress = {
        p.resource_id: p
        for p in db.scalars(select(UserLearningProgress).where(UserLearningProgress.user_id == user.id))
    }
    subs = {s.task_id: s for s in db.scalars(select(PracticeSubmission).where(PracticeSubmission.user_id == user.id))}
    rec = db.scalar(
        select(Recommendation)
        .where(
            Recommendation.user_id == user.id,
            Recommendation.competency_id == c.id,
            Recommendation.status == RecommendationStatus.ACTIVE,
        )
        .options(selectinload(Recommendation.activities))
    )
    res = db.scalars(
        select(LearningResource).where(
            LearningResource.competency_id == c.id, LearningResource.status == ContentStatus.PUBLISHED
        )
    )
    tasks = db.scalars(
        select(PracticalTask).where(
            PracticalTask.competency_id == c.id, PracticalTask.status == ContentStatus.PUBLISHED
        )
    )
    rec_res = rec.resource_id if rec else None
    rec_task = rec.task_id if rec else None
    resources = sorted(
        [
            RecommendedItem(
                id=r.id,
                kind="resource",
                title=r.title,
                type=views.type_label(r.type.value),
                duration_minutes=r.duration_minutes,
                difficulty=r.difficulty.value,
                status=progress[r.id].status.value if r.id in progress else "not_started",
            )
            for r in res
        ],
        key=lambda i: (i.id != rec_res, i.id),
    )
    task_items = sorted(
        [
            RecommendedItem(
                id=t.id,
                kind="task",
                title=t.title,
                type=views.type_label("task"),
                duration_minutes=t.duration_minutes,
                difficulty=t.difficulty.value,
                status=subs[t.id].status.value if t.id in subs else "not_started",
            )
            for t in tasks
        ],
        key=lambda i: (i.id != rec_task, i.id),
    )
    qcount = (
        db.scalar(
            select(func.count(QuestionCompetency.id))
            .join(Question)
            .where(QuestionCompetency.competency_id == c.id, Question.status == ContentStatus.PUBLISHED)
        )
        or 0
    ) if c.status == ContentStatus.PUBLISHED else 0

    return CompetencyDetail(
        competency=CompetencyOut.model_validate(c),
        current=current,
        method_scores={
            "self": latest.self_score if latest else None,
            "situational": latest.situational_score if latest else None,
            "open": latest.open_score if latest else None,
        },
        explanation=scoring.explain_stored(latest) if latest else None,
        evidence=evidence,
        criteria=[CriterionOut(criterion=k, score=round(sum(v) / len(v))) for k, v in criteria_acc.items()],
        ai=ai_out,
        history=[
            HistoryPoint(attempt_id=a.id, label=tr("assessment_n", n=a.sequence), date=a.completed_at, score=s.score)
            for s, a in hist
        ],
        resources=resources,
        tasks=task_items,
        recommendation_id=rec.id if rec else None,
        reassess_question_count=qcount,
    )
