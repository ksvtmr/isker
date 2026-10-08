from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload, selectinload

from app.api.deps import DB, CurrentUser
from app.core.errors import NotFoundError
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
from app.models.enums import QuestionType, RecommendationStatus
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
from app.services import views
from app.services.profile import history

router = APIRouter(tags=["competencies"], responses=ERROR_RESPONSES)

SECTION_LABEL = {
    QuestionType.LIKERT: "Self-assessment",
    QuestionType.SITUATIONAL: "Situational",
    QuestionType.OPEN: "Open answer",
    QuestionType.PRACTICAL: "Practical task",
}
LIKERT_WORD = {1: "Strongly disagree", 2: "Disagree", 3: "Neutral", 4: "Agree", 5: "Strongly agree"}


@router.get("/api/competencies", response_model=CompetencyCatalog, summary="EntreComp catalogue")
def catalog(db: DB) -> CompetencyCatalog:
    return CompetencyCatalog(
        areas=[
            AreaOut.model_validate(a) for a in db.scalars(select(CompetencyArea).order_by(CompetencyArea.sort_order))
        ],
        competencies=[CompetencyOut.model_validate(c) for c in views.competencies(db)],
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
            priority_label=g.priority_label,
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
    if c is None:
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
            src = f"Q{q.sort_order} · {SECTION_LABEL[q.type]}"
            if q.type in (QuestionType.OPEN, QuestionType.PRACTICAL):
                ev = db.scalar(
                    select(AIEvaluation)
                    .where(AIEvaluation.answer_id == ans.id)
                    .options(joinedload(AIEvaluation.prompt_version))
                    .order_by(AIEvaluation.id.desc())
                )
                if ev is None:
                    continue
                own = {r["criterion"] for r in (q.rubric or []) if r.get("competency") in (None, c.code)}
                for cr in (ev.output or {}).get("criteria", []):
                    if cr["criterion"] in own:
                        criteria_acc[cr["criterion"]].append(int(cr["rating"]) * 25)
                excerpt = (ans.text_response or "")[:280]
                positive = (ev.score or 0) >= 60
                tag = (
                    (ev.strengths or ["Clear reasoning"])[0]
                    if positive
                    else f"Needs more: {(ev.development_areas or ['detail'])[0].lower()}"
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
                        strengths=ev.strengths or [],
                        development_areas=ev.development_areas or [],
                        explanation=ev.explanation,
                    )
                )
            elif ans.option is not None:
                s = ans.option.score if not q.reverse_scored else 100 - ans.option.score
                if q.type == QuestionType.LIKERT:
                    text = f"{q.text} — you answered “{LIKERT_WORD.get(ans.option.value or 0, ans.option.label)}”."
                    tag = "Self-rating"
                else:
                    text = f"You chose: {ans.option.label}"
                    tag = (
                        "Effective approach"
                        if s >= 70
                        else "Partly effective approach"
                        if s >= 40
                        else "Less effective approach"
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
        select(LearningResource).where(LearningResource.competency_id == c.id, LearningResource.is_published.is_(True))
    )
    tasks = db.scalars(
        select(PracticalTask).where(PracticalTask.competency_id == c.id, PracticalTask.is_published.is_(True))
    )
    rec_res = rec.resource_id if rec else None
    rec_task = rec.task_id if rec else None
    resources = sorted(
        [
            RecommendedItem(
                id=r.id,
                kind="resource",
                title=r.title,
                type=views.TYPE_LABEL[r.type.value],
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
                type="Practical task",
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
            .where(QuestionCompetency.competency_id == c.id, Question.is_active.is_(True))
        )
        or 0
    )

    return CompetencyDetail(
        competency=CompetencyOut.model_validate(c),
        current=current,
        method_scores={
            "self": latest.self_score if latest else None,
            "situational": latest.situational_score if latest else None,
            "open": latest.open_score if latest else None,
        },
        explanation=latest.explanation if latest else None,
        evidence=evidence,
        criteria=[CriterionOut(criterion=k, score=round(sum(v) / len(v))) for k, v in criteria_acc.items()],
        ai=ai_out,
        history=[
            HistoryPoint(attempt_id=a.id, label=f"Assessment {a.sequence}", date=a.completed_at, score=s.score)
            for s, a in hist
        ],
        resources=resources,
        tasks=task_items,
        recommendation_id=rec.id if rec else None,
        reassess_question_count=qcount,
    )
