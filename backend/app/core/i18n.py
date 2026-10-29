"""Server-side texts that the API generates (labels, explanations, recommendation reasons), in ru/kk/en.

The interface itself is translated in the frontend; this catalog only covers text the backend composes. The
language comes from the request's Accept-Language (see core/middleware.py → language_var). A missing text falls back
along the same chain as database content (core/content_i18n.py): kk → ru → en, ru → en.
"""

from __future__ import annotations

from app.core.content_i18n import FALLBACK
from app.core.context import language_var

CATALOG: dict[str, dict[str, str]] = {
    # Resource and activity types
    "type.article": {"ru": "Статья", "kk": "Мақала", "en": "Article"},
    "type.video": {"ru": "Видео", "kk": "Бейне", "en": "Video"},
    "type.course": {"ru": "Курс", "kk": "Курс", "en": "Course"},
    "type.exercise": {"ru": "Упражнение", "kk": "Жаттығу", "en": "Exercise"},
    "type.case_study": {"ru": "Кейс", "kk": "Кейс", "en": "Case study"},
    "type.template": {"ru": "Шаблон", "kk": "Үлгі", "en": "Template"},
    "type.task": {"ru": "Практическое задание", "kk": "Практикалық тапсырма", "en": "Practical task"},
    "type.reflection": {"ru": "Рефлексия", "kk": "Рефлексия", "en": "Reflection"},
    "reflection_on": {"ru": "Рефлексия: {name}", "kk": "Рефлексия: {name}", "en": "Reflection: {name}"},
    # Question kinds (evidence sources)
    "section.likert": {"ru": "Самооценка", "kk": "Өзін-өзі бағалау", "en": "Self-assessment"},
    "section.situational": {"ru": "Ситуационный вопрос", "kk": "Жағдаяттық сұрақ", "en": "Situational"},
    "section.open": {"ru": "Открытый ответ", "kk": "Ашық жауап", "en": "Open answer"},
    "section.practical": {"ru": "Практическое задание", "kk": "Практикалық тапсырма", "en": "Practical task"},
    "likert.1": {"ru": "Совершенно не согласен", "kk": "Мүлдем келіспеймін", "en": "Strongly disagree"},
    "likert.2": {"ru": "Не согласен", "kk": "Келіспеймін", "en": "Disagree"},
    "likert.3": {"ru": "Нейтрально", "kk": "Бейтарап", "en": "Neutral"},
    "likert.4": {"ru": "Согласен", "kk": "Келісемін", "en": "Agree"},
    "likert.5": {"ru": "Полностью согласен", "kk": "Толығымен келісемін", "en": "Strongly agree"},
    # Gap priority
    "priority.High": {"ru": "Высокий", "kk": "Жоғары", "en": "High"},
    "priority.Medium": {"ru": "Средний", "kk": "Орташа", "en": "Medium"},
    "priority.Low": {"ru": "Низкий", "kk": "Төмен", "en": "Low"},
    "priority.None": {"ru": "Нет", "kk": "Жоқ", "en": "None"},
    # Measurement labels
    "assessment_n": {"ru": "Оценка {n}", "kk": "{n}-бағалау", "en": "Assessment {n}"},
    "reassessment_n": {
        "ru": "Переоценка {n} · {name}",
        "kk": "{n}-қайта бағалау · {name}",
        "en": "Reassessment {n} · {name}",
    },
    # Score explanation
    "method.self": {"ru": "самооценка", "kk": "өзін-өзі бағалау", "en": "self-assessment"},
    "method.situational": {"ru": "ситуационные вопросы", "kk": "жағдаяттық сұрақтар", "en": "situational judgement"},
    "method.open": {"ru": "открытые ответы", "kk": "ашық жауаптар", "en": "open answers"},
    "explain.combines": {
        "ru": "Сочетает: {mix}. {parts}.",
        "kk": "Біріктіреді: {mix}. {parts}.",
        "en": "Combines {mix}. {parts}.",
    },
    "explain.self_higher": {
        "ru": " Ваша самооценка выше, чем показывают ситуационные и открытые ответы.",
        "kk": " Өзін-өзі бағалауыңыз жағдаяттық және ашық жауаптарыңыз көрсеткеннен жоғары.",
        "en": " Your self-rating is higher than what your situational and open answers demonstrate.",
    },
    "explain.demo_higher": {
        "ru": " Ваши ответы показывают больше, чем предполагает ваша самооценка.",
        "kk": " Жауаптарыңыз өзін-өзі бағалауыңыздан көп нәрсені көрсетеді.",
        "en": " Your answers demonstrate more than your self-rating suggests.",
    },
    # Recommendation reasons
    "reason.stretch": {
        "ru": (
            "Балл {score} соответствует вашей цели {target}; это ваша самая слабая область, поэтому это цель на рост"
        ),
        "kk": (
            "{score} балл {target} мақсатыңызға сәйкес келеді; бұл сіздің ең әлсіз салаңыз, сондықтан бұл өсу мақсаты"
        ),
        "en": "Score {score} meets your target of {target}; this is your lowest area, so it is a stretch goal",
    },
    "reason.gap": {
        "ru": "Балл {score} на {gap} ниже вашей цели {target}",
        "kk": "{score} балл {target} мақсатыңыздан {gap} балға төмен",
        "en": "Score {score} is {gap} points below your target of {target}",
    },
    "reason.goal": {
        "ru": ", и это важно для вашей цели «{goal}»",
        "kk": ", және бұл сіздің «{goal}» мақсатыңыз үшін маңызды",
        "en": ", and it matters for your goal “{goal}”",
    },
    "reason.importance": {
        "ru": ", и компетенция «{name}» сильно влияет на проекты на ранней стадии",
        "kk": ", және «{name}» құзыреті бастапқы кезеңдегі жобаларға қатты әсер етеді",
        "en": ", and {name} has a large effect on early-stage ventures",
    },
    # Evidence on the competency page
    "evidence.you_answered": {
        "ru": "{question} — ваш ответ: «{answer}».",
        "kk": "{question} — сіздің жауабыңыз: «{answer}».",
        "en": "{question} — you answered “{answer}”.",
    },
    "evidence.you_chose": {
        "ru": "Ваш выбор: {answer}",
        "kk": "Сіздің таңдауыңыз: {answer}",
        "en": "You chose: {answer}",
    },
    "evidence.self_rating": {"ru": "Самооценка", "kk": "Өзін-өзі бағалау", "en": "Self-rating"},
    "evidence.effective": {"ru": "Эффективный подход", "kk": "Тиімді тәсіл", "en": "Effective approach"},
    "evidence.partly_effective": {
        "ru": "Частично эффективный подход",
        "kk": "Ішінара тиімді тәсіл",
        "en": "Partly effective approach",
    },
    "evidence.less_effective": {
        "ru": "Менее эффективный подход",
        "kk": "Тиімділігі төмен тәсіл",
        "en": "Less effective approach",
    },
    "evidence.clear_reasoning": {"ru": "Ясная аргументация", "kk": "Айқын дәлелдеу", "en": "Clear reasoning"},
    "evidence.needs_more": {"ru": "Нужно больше: {what}", "kk": "Көбірек қажет: {what}", "en": "Needs more: {what}"},
    "evidence.detail": {"ru": "детали", "kk": "толығырақ", "en": "detail"},
    # Rule-based AI fallback (mock provider and the safe fallback when a real model fails)
    "ai.rated": {
        "ru": "Оценено по {n} критериям рубрики. ",
        "kk": "Рубриканың {n} критерийі бойынша бағаланды. ",
        "en": "Rated against {n} rubric criteria. ",
    },
    "ai.strongest": {"ru": "Сильнее всего: {names}. ", "kk": "Ең күшті жағы: {names}. ", "en": "Strongest: {names}. "},
    "ai.needs_detail": {
        "ru": "Нужно больше деталей: {names}.",
        "kk": "Толығырақ ашу қажет: {names}.",
        "en": "Needs more detail on: {names}.",
    },
    "ai.shows": {
        "ru": "«{quote}» — показывает: {criterion}",
        "kk": "«{quote}» — көрсетеді: {criterion}",
        "en": "“{quote}” — shows {criterion}",
    },
    "insight.headline": {
        "ru": "Ваша самая сильная сторона — {name}.",
        "kk": "Сіздің ең күшті жағыңыз — {name}.",
        "en": "Your strongest area is {name}.",
    },
    "insight.not_measured": {"ru": "пока не измерена", "kk": "әлі өлшенбеген", "en": "not yet measured"},
    "insight.body": {
        "ru": (
            "Больше всего уверенности ваши ответы показывают в компетенции «{name}» ({score} / 100). "
            "Главная зона развития — «{gap}» ({gap_score} / 100, цель {target})."
        ),
        "kk": (
            "Жауаптарыңыз «{name}» құзыретінде ең көп сенімділік көрсетеді ({score} / 100). "
            "Басты даму аймағы — «{gap}» ({gap_score} / 100, мақсат {target})."
        ),
        "en": (
            "Your responses show the most confidence in {name} ({score} / 100). "
            "Your biggest development opportunity is {gap} ({gap_score} / 100, target {target})."
        ),
    },
    "insight.next_resource": {
        "ru": "Начните с материала «{resource}», чтобы развивать компетенцию «{gap}».",
        "kk": "«{gap}» құзыретін дамыту үшін «{resource}» материалынан бастаңыз.",
        "en": "Start with “{resource}” to work on {gap}.",
    },
    "insight.next_plan": {
        "ru": "Откройте план развития по компетенции «{gap}».",
        "kk": "«{gap}» құзыреті бойынша даму жоспарын ашыңыз.",
        "en": "Open your development plan for {gap}.",
    },
    "insight.all_met": {
        "ru": "Все измеренные компетенции достигли цели. Продолжайте практиковаться, чтобы подняться на уровень выше.",
        "kk": "Барлық өлшенген құзыреттер мақсатқа жетті. Деңгейді көтеру үшін жаттығуды жалғастырыңыз.",
        "en": "All measured competencies meet your target. Keep practising to move up a level.",
    },
    "insight.stretch": {
        "ru": "Поставьте цель на рост в самой слабой компетенции.",
        "kk": "Ең әлсіз құзыретіңізде өсу мақсатын қойыңыз.",
        "en": "Pick a stretch goal in your lowest competency.",
    },
    # Instruction appended to real model prompts
    "ai.language_instruction": {
        "ru": "Write every free-text field (explanation, evidence, strengths, development_areas, headline, body, "
        "next_step) in Russian. Keep JSON keys and criterion names exactly as given.",
        "kk": "Write every free-text field (explanation, evidence, strengths, development_areas, headline, body, "
        "next_step) in Kazakh (Cyrillic). Keep JSON keys and criterion names exactly as given.",
        "en": "Write every free-text field in English. Keep JSON keys and criterion names exactly as given.",
    },
    # Development plan steps
    "step.reflect": {
        "ru": "Подведите итоги изученного",
        "kk": "Үйренгеніңізді қорытыңыз",
        "en": "Reflect on what you learned",
    },
    "step.reflect_prompt": {
        "ru": "Что вы узнали о компетенции «{name}»?",
        "kk": "«{name}» құзыреті туралы не білдіңіз?",
        "en": "What did you learn about {name}?",
    },
    "step.reassess": {"ru": "Повторная оценка: {name}", "kk": "Қайта бағалау: {name}", "en": "Reassess {name}"},
    # In-app notifications
    "notify.profile_ready": {
        "ru": "Ваш профиль компетенций готов",
        "kk": "Құзыреттер профиліңіз дайын",
        "en": "Your competency profile is ready",
    },
    # Development analysis: language instruction for real models, and the rule-based (mock) analysis texts
    "analysis.language_instruction": {
        "ru": "Write every free-text field (summary, explanation, insight, reason, objective, measure, "
        "confidence_notes) in Russian. Set \"language\" to \"ru\". Keep JSON keys and competency codes as given.",
        "kk": "Write every free-text field (summary, explanation, insight, reason, objective, measure, "
        "confidence_notes) in Kazakh (Cyrillic). Set \"language\" to \"kk\". Keep JSON keys and competency codes "
        "as given.",
        "en": "Write every free-text field in English. Set \"language\" to \"en\". Keep JSON keys and competency codes "
        "as given.",
    },
    "analysis.summary": {
        "ru": "По результатам оценки ваш общий балл — {overall} из 100. Сильнее всего проявилась компетенция «{best}», "
        "больше всего пользы даст развитие компетенции «{gap}». Это оценка по вашим ответам, а не точное измерение.",
        "kk": "Бағалау нәтижесі бойынша жалпы балыңыз — 100-ден {overall}. Ең күшті көрінген құзырет — «{best}», ал "
        "«{gap}» құзыретін дамыту ең көп пайда береді. Бұл жауаптарыңыз бойынша бағалау, нақты өлшем емес.",
        "en": "Your overall score is {overall} out of 100. {best} came out strongest, and developing {gap} will help "
        "you most. This is an estimate based on your answers, not an exact measurement.",
    },
    "analysis.summary_no_gap": {
        "ru": "По результатам оценки ваш общий балл — {overall} из 100. Сильнее всего проявилась компетенция «{best}», "
        "и все измеренные компетенции достигли цели. Это оценка по вашим ответам, а не точное измерение.",
        "kk": "Бағалау нәтижесі бойынша жалпы балыңыз — 100-ден {overall}. Ең күшті көрінген құзырет — «{best}», "
        "барлық өлшенген құзыреттер мақсатқа жетті. Бұл жауаптарыңыз бойынша бағалау, нақты өлшем емес.",
        "en": "Your overall score is {overall} out of 100. {best} came out strongest, and every measured competency "
        "meets your target. This is an estimate based on your answers, not an exact measurement.",
    },
    "analysis.strength": {
        "ru": "{score} из 100 — один из ваших самых высоких результатов; опирайтесь на эту сильную сторону.",
        "kk": "100-ден {score} — ең жоғары нәтижелеріңіздің бірі; осы күшті жағыңызға сүйеніңіз.",
        "en": "{score} out of 100 is one of your highest results; build on this strength.",
    },
    "analysis.area": {
        "ru": "{score} из 100 при цели {target}: здесь самый заметный разрыв с учётом ваших целей.",
        "kk": "Мақсат {target} болғанда 100-ден {score}: мақсаттарыңызды ескергенде ең айқын алшақтық осында.",
        "en": "{score} out of 100 against a target of {target}: the most important gap given your goals.",
    },
    "analysis.reason_learn": {
        "ru": "Материал по компетенции «{name}» подходит к вашему уровню ({score} из 100).",
        "kk": "«{name}» құзыреті бойынша материал деңгейіңізге сай ({score} / 100).",
        "en": "A resource on {name} that matches your level ({score} out of 100).",
    },
    "analysis.reason_practice": {
        "ru": "Практическое задание, чтобы применить компетенцию «{name}» на деле.",
        "kk": "«{name}» құзыретін іс жүзінде қолдануға арналған практикалық тапсырма.",
        "en": "A practical task to apply {name} in a real situation.",
    },
    "analysis.reason_reflect": {
        "ru": "Подходящих материалов пока нет: запишите, где вы уже применяли компетенцию «{name}» и что получилось.",
        "kk": "Әзірге сәйкес материал жоқ: «{name}» құзыретін қай жерде қолданғаныңызды және нәтижесін жазыңыз.",
        "en": "No matching resources yet: write down where you have used {name} and what happened.",
    },
    "analysis.reason_reflect_done": {
        "ru": "Вы уже прошли доступные материалы по компетенции «{name}»: опишите, как применяли их на практике, и "
        "пройдите повторную оценку.",
        "kk": "«{name}» құзыреті бойынша қолжетімді материалдарды өтіп қойдыңыз: оларды іс жүзінде қалай "
        "қолданғаныңызды жазып, қайта бағалаудан өтіңіз.",
        "en": "You have completed the available materials on {name}: describe how you applied them, then reassess.",
    },
    "analysis.objective": {
        "ru": "Повысить результат по компетенции «{name}» с {score} до {target}",
        "kk": "«{name}» құзыреті бойынша нәтижені {score}-ден {target}-ге көтеру",
        "en": "Raise {name} from {score} to {target}",
    },
    "analysis.measure": {
        "ru": "Пройти материал и задание из плана, затем повторную оценку этой компетенции",
        "kk": "Жоспардағы материал мен тапсырманы орындап, осы құзыретті қайта бағалаудан өту",
        "en": "Complete the plan's resource and task, then reassess this competency",
    },
    "analysis.limited_evidence": {
        "ru": "По компетенции «{name}» данных пока мало: результат предварительный. Практическое задание и повторная "
        "оценка сделают его надёжнее.",
        "kk": "«{name}» құзыреті бойынша дерек әзірге аз: нәтиже алдын ала. Практикалық тапсырма мен қайта бағалау "
        "оны сенімдірек етеді.",
        "en": "There is little evidence for {name} yet, so this result is provisional. A practical task and a "
        "reassessment will make it more reliable.",
    },
    "analysis.estimate_note": {
        "ru": "Баллы — оценка по ответам в этом тесте, а не научно подтверждённое измерение или диагноз.",
        "kk": "Баллдар — осы тесттегі жауаптар бойынша бағалау, ғылыми расталған өлшем немесе диагноз емес.",
        "en": "Scores are estimates from your answers to this assessment, not a validated measurement or diagnosis.",
    },
    "notify.overall": {
        "ru": "Общий балл {score} / 100.",
        "kk": "Жалпы балл {score} / 100.",
        "en": "Overall score {score} / 100.",
    },
}


def lang() -> str:
    return language_var.get()


def tr(key: str, **values: object) -> str:
    entry = CATALOG.get(key)
    if entry is None:
        return key
    text = next((entry[c] for c in (*FALLBACK.get(lang(), ()), "en") if entry.get(c)), key)
    return text.format(**values) if values else text
