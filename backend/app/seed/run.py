"""Idempotent database seed.

    python -m app.seed.run            # reference data + admin + demo account (dev)
    python -m app.seed.run --no-demo  # reference data only

The demo account's history is produced by running real attempts through the scoring pipeline
(mock AI), so every number in the demo dashboard comes from the database.
"""

from __future__ import annotations

import argparse
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.ai.prompts import DEFAULT_PROMPTS
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models import (
    AIEvaluation,
    Assessment,
    AssessmentAttempt,
    Competency,
    CompetencyArea,
    CompetencyGap,
    CompetencyLevel,
    CompetencyScore,
    GoalCompetencyWeight,
    GoalDefinition,
    LearningResource,
    Notification,
    PracticalTask,
    PracticeSubmission,
    ProgressSnapshot,
    Question,
    QuestionCompetency,
    QuestionOption,
    Recommendation,
    User,
    UserGoal,
    UserLearningProgress,
    UserProfile,
)
from app.models.ai import AIPromptVersion
from app.models.enums import (
    ActivityKind,
    ActivityStatus,
    AssessmentKind,
    AttemptScope,
    Difficulty,
    ExperienceLevel,
    LearningFormat,
    PracticeStatus,
    ProgressStatus,
    QuestionType,
    ResourceType,
    UserRole,
)
from app.seed.competencies import AREAS, COMPETENCIES, GOALS
from app.seed.learning import RESOURCES, TASKS
from app.seed.questions import ASSESSMENT, LIKERT, LIKERT_OPTIONS, OPEN, S_SELF, S_SJT, SITUATIONAL
from app.services import assessments as assessment_service
from app.services import recommendations as rec_service
from app.services.levels import LEVEL_BANDS

log = logging.getLogger("isker.seed")

DEV_DEMO_PASSWORD = "IskerDemo2026"
DEV_ADMIN_PASSWORD = "IskerAdmin2026"


# ---------------------------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------------------------


def seed_reference(db: Session) -> None:
    areas = {}
    for i, (code, name, token) in enumerate(AREAS):
        a = db.scalar(select(CompetencyArea).where(CompetencyArea.code == code)) or CompetencyArea(code=code)
        a.name, a.color_token, a.sort_order = name, token, i
        db.add(a)
        areas[code] = a
    db.flush()

    comps = {}
    for i, (code, area, name, short, imp, lp, desc, hint, refl) in enumerate(COMPETENCIES):
        c = db.scalar(select(Competency).where(Competency.code == code)) or Competency(code=code)
        c.area_id, c.name, c.short_name, c.importance, c.learning_priority = areas[area].id, name, short, imp, lp
        c.description, c.hint, c.reflection_prompt, c.sort_order = desc, hint, refl, i + 1
        c.default_target = c.default_target or 70
        db.add(c)
        comps[code] = c
    db.flush()

    for rank, name, lo, hi, desc in LEVEL_BANDS:
        lv = db.scalar(select(CompetencyLevel).where(CompetencyLevel.rank == rank)) or CompetencyLevel(rank=rank)
        lv.name, lv.min_score, lv.max_score, lv.description = name, lo, hi, desc
        db.add(lv)

    for i, (code, title, desc, weights) in enumerate(GOALS):
        g = db.scalar(select(GoalDefinition).where(GoalDefinition.code == code)) or GoalDefinition(code=code)
        g.title, g.description, g.sort_order = title, desc, i
        db.add(g)
        db.flush()
        existing = {
            w.competency_id: w
            for w in db.scalars(select(GoalCompetencyWeight).where(GoalCompetencyWeight.goal_id == g.id))
        }
        for ccode, w in weights.items():
            row = existing.get(comps[ccode].id) or GoalCompetencyWeight(goal_id=g.id, competency_id=comps[ccode].id)
            row.weight = w
            db.add(row)

    seed_assessment(db, comps)

    for slug, ccode, title, desc, typ, diff, minutes, content in RESOURCES:
        r = db.scalar(select(LearningResource).where(LearningResource.slug == slug)) or LearningResource(slug=slug)
        r.competency_id, r.title, r.description = comps[ccode].id, title, desc
        r.type, r.difficulty, r.duration_minutes, r.content = (
            ResourceType(typ),
            Difficulty(diff),
            minutes,
            content.strip(),
        )
        db.add(r)
    for slug, ccode, title, desc, instr, diff, minutes, rubric, min_len in TASKS:
        t = db.scalar(select(PracticalTask).where(PracticalTask.slug == slug)) or PracticalTask(slug=slug)
        t.competency_id, t.title, t.description, t.instructions = comps[ccode].id, title, desc, instr
        t.difficulty, t.duration_minutes, t.rubric, t.min_length = Difficulty(diff), minutes, rubric, min_len
        db.add(t)

    for key, (system, user_tpl) in DEFAULT_PROMPTS.items():
        if db.scalar(select(AIPromptVersion.id).where(AIPromptVersion.key == key)) is None:
            db.add(
                AIPromptVersion(
                    key=key,
                    version=1,
                    system_prompt=system,
                    user_template=user_tpl,
                    notes="Initial version",
                    is_active=True,
                )
            )
    db.flush()


def seed_assessment(db: Session, comps: dict[str, Competency]) -> None:
    a = db.scalar(select(Assessment).where(Assessment.code == ASSESSMENT["code"]))
    if a is not None:
        return  # question bank is managed in the admin panel after the first seed
    a = Assessment(kind=AssessmentKind.FULL, **ASSESSMENT)
    db.add(a)
    db.flush()
    order = 0

    def add(qtype, section, text, links, options=(), rubric=None, help_text=None, min_length=0, reverse=False):
        nonlocal order
        order += 1
        q = Question(
            assessment_id=a.id,
            sort_order=order,
            type=qtype,
            section=section,
            text=text,
            help_text=help_text,
            rubric=rubric,
            min_length=min_length,
            reverse_scored=reverse,
        )
        for i, (label, score, value) in enumerate(options):
            q.options.append(QuestionOption(sort_order=i, label=label, score=score, value=value))
        for code, w in links:
            q.competency_links.append(QuestionCompetency(competency_id=comps[code].id, weight=w))
        db.add(q)

    for code, text, reverse in LIKERT:
        add(
            QuestionType.LIKERT,
            S_SELF,
            text,
            [(code, 1.0)],
            LIKERT_OPTIONS,
            reverse=reverse,
            help_text="Answer for how you usually act, not how you would like to act.",
        )
    for text, links, options in SITUATIONAL:
        add(
            QuestionType.SITUATIONAL,
            S_SJT,
            text,
            links,
            [(lbl, s, None) for lbl, s in options],
            help_text="Choose what you would most likely do first.",
        )
    for qtype, section, text, help_text, min_len, links, rubric in OPEN:
        add(QuestionType(qtype), section, text, links, rubric=rubric, help_text=help_text, min_length=min_len)
    db.flush()


# ---------------------------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------------------------


def _password(env_value: str, dev_default: str, label: str) -> str | None:
    s = get_settings()
    if env_value:
        return env_value
    if s.is_production:
        log.warning("%s password not set; skipping account in production", label)
        return None
    log.info("%s password not set; using the development default", label)
    return dev_default


def ensure_user(db: Session, email: str, password: str, name: str, role: UserRole) -> tuple[User, bool]:
    u = db.scalar(select(User).where(User.email == email))
    if u is not None:
        return u, False
    u = User(
        email=email,
        password_hash=hash_password(password),
        full_name=name,
        role=role,
        onboarding_completed=role == UserRole.ADMIN,
    )
    u.profile = UserProfile()
    db.add(u)
    db.flush()
    return u, True


# ---------------------------------------------------------------------------------------------
# Demo history
# ---------------------------------------------------------------------------------------------

# Desired competency levels per assessment (drives option choice for choice questions).
DEMO_PROFILES = {
    "spotting": (64, 71, 76),
    "creativity": (72, 78, 82),
    "vision": (69, 73, 77),
    "valuing": (62, 68, 73),
    "ethics": (66, 71, 74),
    "self-awareness": (63, 68, 72),
    "motivation": (70, 73, 76),
    "mobilizing-resources": (48, 58, 66),
    "financial-literacy": (36, 46, 55),
    "mobilizing-others": (61, 66, 70),
    "initiative": (65, 70, 75),
    "planning": (40, 52, 60),
    "uncertainty": (42, 52, 62),
    "teamwork": (70, 75, 79),
    "learning-experience": (63, 69, 74),
}

# Open answers: (weak, medium, strong) by question order among open/practical questions.
DEMO_OPEN = [
    (
        "I would ask some of my friends whether they like the idea, and then I would decide if it is worth doing it or not.",
        "First I would write down my main assumption about customers and test it. I would talk to ten potential "
        "customers and run a short survey. Then I would decide whether to continue.",
        "First I would list the assumptions that must be true and pick the riskiest one to test. I would interview "
        "ten potential customers about the last time they had the problem, and set up a free landing page as a "
        "low-cost prototype to see if people sign up. If fewer than 20% sign up, I would adjust the idea, learn from "
        "the result and run the next test.",
    ),
    (
        "I convinced my group at university to choose my topic for our project. We discussed it for a while and they agreed in the end.",
        "In my second year I wanted our student club to organise a hackathon. I explained the idea to the board and "
        "showed an example from another university. At first they said no, but I tried again with a smaller budget.",
        "In my second year I wanted our student club to run a hackathon. I listened to what the board needed — they "
        "worried about cost and attendance. I explained the plan, showed data from a similar event and presented a "
        "demo schedule. They said no the first time, so I kept going, found a sponsor and asked again. The second "
        "time they agreed. I realised my strength is preparing evidence, and next time I will ask them earlier.",
    ),
    (
        "In five years my app will be popular and many students will use it every day. It will be well known at our university.",
        "In five years students in Astana will find study partners in minutes. First we will launch at one "
        "university, then grow to three cities. It will be a new kind of study community.",
        "In five years, students in three Kazakh cities will find a study partner within minutes and drop out less "
        "often. First we will launch at AITU, then add two universities, and after that open to schools. Instead of "
        "another chat app it will combine tutoring and peer groups in a new way, and it will stay free for "
        "students from low-income families so the impact on the community is fair.",
    ),
    (
        "I failed an exam once in my first year. It was a bad experience and I was upset about it for a few weeks.",
        "Last year my team missed the deadline for a startup competition because we started too late. I learned that "
        "planning early matters, and now I set deadlines a week before the real one.",
        "Last year my team failed to submit our application to a startup competition — it was my mistake, I did not "
        "check the requirements. I learned that I tend to focus on the product and ignore admin details. Since then I "
        "make a checklist at the start of every project and share it with the team. We continued, tried again the "
        "next semester and reached the final.",
    ),
    (
        "Students on our campus need better food. Someone could open a nice café near the main building with good coffee and some snacks.",
        "Many students struggle to find cheap healthy lunches near campus. My idea is a service where students "
        "pre-order meal boxes from local home cooks through a simple app. Students would pay per box.",
        "Many first-year students struggle to find cheap healthy lunches near campus, and the canteen queue wastes "
        "20 minutes. The customers are students and staff without time to cook. My idea is a new service that "
        "combines local home cooks with a pre-order platform: you choose a box in the evening and pick it up at a "
        "locker. It would be cheaper than the café because cooks prepare in batches.",
    ),
]


# Answer quality per wave (0 weak, 1 medium, 2 strong) for each open/practical question.
DEMO_OPEN_QUALITY = [(0, 0, 0, 0, 0), (1, 1, 1, 0, 0), (2, 1, 1, 2, 1)]


def _choose_option(q: Question, desired: float) -> QuestionOption:
    def eff(o: QuestionOption) -> float:
        return 100 - o.score if q.reverse_scored else o.score

    return min(q.options, key=lambda o: (abs(eff(o) - desired), o.sort_order))


def _run_demo_attempt(db: Session, user: User, wave: int, when: datetime) -> AssessmentAttempt:
    att, _ = assessment_service.start_attempt(db, user, AttemptScope.FULL, None)
    qs = assessment_service.questions_for(db, att)
    codes = {c.id: c.code for c in db.scalars(select(Competency))}
    open_i = 0
    for q in qs:
        if q.type in (QuestionType.LIKERT, QuestionType.SITUATIONAL):
            link = max(q.competency_links, key=lambda x: x.weight)
            desired = DEMO_PROFILES[codes[link.competency_id]][wave]
            assessment_service.save_answer(db, att, q.id, _choose_option(q, desired).id, None, None)
        else:
            quality = DEMO_OPEN_QUALITY[wave][open_i]
            assessment_service.save_answer(db, att, q.id, None, DEMO_OPEN[open_i][quality], None)
            open_i += 1
    assessment_service.submit(db, user, att)
    _backdate(db, att, when)
    return att


def _backdate(db: Session, att: AssessmentAttempt, when: datetime) -> None:
    att.started_at, att.completed_at = when - timedelta(minutes=27), when
    for model in (CompetencyScore, CompetencyGap, Recommendation):
        db.execute(update(model).where(model.attempt_id == att.id).values(created_at=when))
    db.execute(update(ProgressSnapshot).where(ProgressSnapshot.attempt_id == att.id).values(created_at=when))
    db.execute(update(AIEvaluation).where(AIEvaluation.attempt_id == att.id).values(created_at=when))
    answer_ids = [a.id for a in att.answers]
    db.execute(update(AIEvaluation).where(AIEvaluation.answer_id.in_(answer_ids)).values(created_at=when))
    db.execute(
        update(Notification)
        .where(Notification.user_id == att.user_id, Notification.created_at > when)
        .values(created_at=when)
    )
    db.flush()


def _complete_resource(db: Session, user: User, rid: int, when: datetime) -> None:
    if db.scalar(
        select(UserLearningProgress.id).where(
            UserLearningProgress.user_id == user.id, UserLearningProgress.resource_id == rid
        )
    ):
        return
    db.add(
        UserLearningProgress(
            user_id=user.id,
            resource_id=rid,
            status=ProgressStatus.COMPLETED,
            progress_pct=100,
            started_at=when - timedelta(days=1),
            completed_at=when,
            last_accessed_at=when,
        )
    )
    db.flush()
    rec_service.on_resource_completed(db, user.id, rid, when)


def _complete_task(db: Session, user: User, tid: int, when: datetime, text: str) -> None:
    from app.ai.service import evaluate_text
    from app.models.enums import AIInputType

    t = db.get(PracticalTask, tid)
    assert t is not None
    if db.scalar(
        select(PracticeSubmission.id).where(PracticeSubmission.user_id == user.id, PracticeSubmission.task_id == tid)
    ):
        return
    s = PracticeSubmission(
        user_id=user.id,
        task_id=tid,
        status=PracticeStatus.COMPLETED,
        response_text=text,
        started_at=when - timedelta(days=1),
        submitted_at=when,
        completed_at=when,
    )
    db.add(s)
    db.flush()
    comp = db.get(Competency, t.competency_id)
    assert comp is not None
    res = evaluate_text(
        db,
        user_id=user.id,
        competency_id=comp.id,
        competency_name=comp.name,
        question=t.title,
        answer=text,
        rubric=t.rubric,
        input_type=AIInputType.PRACTICE_SUBMISSION,
        practice_submission_id=s.id,
    )
    s.feedback_score = res.score
    res.record.created_at = when
    rec_service.on_task_completed(db, user.id, tid, when)


def _work_on_plan(db: Session, user: User, start: datetime, full: bool) -> None:
    """Simulate the learner working through the plan between assessments."""
    recs = rec_service.active_recommendations(db, user.id)
    for i, rec in enumerate(recs):
        day = start + timedelta(days=3 + i * 5)
        if rec.resource_id:
            _complete_resource(db, user, rec.resource_id, day)
        if rec.task_id and (full or i == 0):
            _complete_task(
                db,
                user,
                rec.task_id,
                day + timedelta(days=2),
                "I listed fixed costs like rent and the stand fee and variable costs like materials per "
                "unit. I set the price by comparing competitor prices and adding a margin, so customers "
                "pay 2500 per unit. Break-even: fixed costs divided by the contribution margin gives about "
                "50 units, which is realistic for one fair weekend.",
            )
        if full or i == 0:
            for a in rec.activities:
                if a.kind == ActivityKind.REFLECT and a.status != ActivityStatus.DONE:
                    a.response_text = (
                        "The biggest risk is my assumption that students will pay in advance. "
                        "I will test it with a deposit form before buying materials."
                    )
                    a.status, a.completed_at = ActivityStatus.DONE, day + timedelta(days=3)
    db.flush()


def seed_demo(db: Session, user: User) -> None:
    p = user.profile or UserProfile(user_id=user.id)
    p.education, p.entrepreneurial_experience = "Bachelor, 3rd year", ExperienceLevel.SIDE_PROJECT
    p.background = "Information systems student at Astana IT University."
    p.business_experience = "Sold handmade notebooks at campus fairs; co-organised a student hackathon."
    p.preferred_learning_format, p.weekly_learning_minutes = LearningFormat.ARTICLE, 90
    user.profile = p
    for code in ("launch-startup", "university-project"):
        g = db.scalar(select(GoalDefinition).where(GoalDefinition.code == code))
        assert g is not None
        db.add(UserGoal(user_id=user.id, goal_id=g.id))
    user.onboarding_completed = True
    db.flush()

    now = datetime.now(UTC)
    dates = [now - timedelta(days=238), now - timedelta(days=143), now - timedelta(days=14)]
    for wave, when in enumerate(dates):
        _run_demo_attempt(db, user, wave, when)
        if wave < 2:
            _work_on_plan(db, user, when, full=True)
    # Current cycle: partly done, so the dashboard shows real progress and a next step.
    _work_on_plan(db, user, dates[2], full=False)
    db.flush()


def run(with_demo: bool = True) -> None:
    s = get_settings()
    db = SessionLocal()
    try:
        seed_reference(db)
        admin_pw = _password(s.admin_password, DEV_ADMIN_PASSWORD, "Admin")
        if admin_pw:
            ensure_user(db, s.admin_email, admin_pw, "Isker Admin", UserRole.ADMIN)
        if with_demo and s.seed_demo:
            demo_pw = _password(s.demo_password, DEV_DEMO_PASSWORD, "Demo")
            if demo_pw:
                user, created = ensure_user(db, s.demo_email, demo_pw, "Aigerim Seitkali", UserRole.USER)
                if created:
                    seed_demo(db, user)
        db.commit()
        log.info("Seed complete")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-demo", action="store_true")
    run(with_demo=not ap.parse_args().no_demo)
