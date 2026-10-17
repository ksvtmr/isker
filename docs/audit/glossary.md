# Isker terminology glossary (ru / kk / en)

One term per concept, used in every locale file (`frontend/src/i18n/locales/{ru,kk,en}`), in content written by
editors and in the design-system strings. English is the base language of the code and of stored content; Russian is
the default interface language. When a word could mean two Isker concepts, the table says which one it is reserved for.

| Concept | Russian | Kazakh | English | Notes |
|---|---|---|---|---|
| Competency | компетенция | құзырет | competency | kk: always «құзырет» (not «құзыреттілік»). |
| Competency area | область компетенций | құзырет саласы | competency area | The three EntreComp areas. |
| Competency profile | профиль компетенций | құзыреттер профилі | competency profile | |
| Assessment | оценка | бағалау | assessment | The full questionnaire. |
| Reassessment | повторная оценка | қайта бағалау | reassessment | ru: never «переоценка» (also means "overestimation"). Verb: «оценить повторно» / «пройти повторную оценку»; kk «қайта бағалау». |
| Self-assessment | самооценка | өзін-өзі бағалау | self-assessment | Likert section. |
| Situational question | ситуационный вопрос | жағдаяттық сұрақ | situational question | Section «Ситуационные вопросы / Жағдаяттық сұрақтар / Situational judgement». |
| Open answer | открытый (развёрнутый) ответ | ашық жауап | open answer | |
| Practical task | практическое задание | практикалық тапсырма | practical task | |
| Practice (section, activity) | практика | практика | practice | kk: «тәжірибе» is reserved for *experience* (entrepreneurial experience in the profile). |
| Experience (person's) | опыт | тәжірибе | experience | |
| Attempt | попытка | әрекет | attempt | |
| Score | балл | балл | score | 0–100. |
| Target | цель (целевой балл) | мақсат | target | |
| Gap | разрыв | алшақтық | gap | target − score. ru: never «пробел»; kk: never «олқылық». |
| Gap level High / Medium / Low | высокий / умеренный / низкий | жоғары / орташа / төмен | high / medium / low | ru «умеренный» so it is not confused with the level «средний». |
| Priority | приоритет | басымдық | priority | «приоритетный разрыв / басым алшақтық / priority gap». |
| Level: Foundation | начальный | бастапқы | Foundation | Competency levels (5). |
| Level: Developing | развивающийся | дамушы | Developing | |
| Level: Intermediate | средний | орта | Intermediate | kk «орта» (gap Medium is «орташа»). |
| Level: Advanced | продвинутый | озық | Advanced | |
| Level: Proficient | профессиональный | кәсіби | Proficient | |
| Difficulty (resource/task) | для начинающих / средняя сложность / высокая сложность | бастаушыларға / орташа күрделілік / жоғары күрделілік | beginner / intermediate / advanced | Worded differently from competency levels. |
| Development plan | план развития | даму жоспары | development plan | |
| Plan step: learn / practise / reflect / reassess | изучить / практика / рефлексия / повторная оценка | оқу / практика / рефлексия / қайта бағалау | learn / practice / reflect / reassess | |
| Learning resource | учебный материал | оқу материалы | learning resource | |
| Recommendation | рекомендация | ұсыныс | recommendation | |
| AI feedback | обратная связь ИИ | ЖИ кері байланысы | AI feedback | Generic feedback: «обратная связь / кері байланыс / feedback». «Отзыв / пікір» only for a person's own feedback to us. |
| Rule-based feedback | автоматическая проверка по критериям (без ИИ) | критерийлер бойынша автоматты тексеру (ЖИ-сіз) | rule-based feedback | Learners never see engine/model names. |
| AI insight | вывод ИИ | ЖИ қорытындысы | AI insight | Summary card on results. |
| Rubric | рубрика (критерии оценивания) | рубрика | rubric | |
| Criterion | критерий | критерий | criterion | |
| Subscription | подписка | жазылым | subscription | The user's period of access to a plan. |
| Plan (tariff) | тариф | тариф | plan | ru/kk never «план» for a tariff (план = development plan). Plan names come from the database — copy says «бесплатный тариф / тегін тариф / free plan», never a hard-coded "Free"/"Pro". |
| Default plan | тариф по умолчанию | әдепкі тариф | default plan | |
| Entitlement / feature | возможность тарифа | тариф мүмкіндігі | feature | |
| Limit | лимит | лимит | limit | Always with its period, taken from the API window («за 30 дней / 30 күн ішінде»). |
| Trial | пробный период | сынақ кезеңі | trial | |
| Profile | профиль | профиль | profile | |
| Progress | прогресс | прогресс | progress | |
| Draft / Published / Archived | черновик / опубликовано / в архиве | жоба / жарияланған / мұрағатта | draft / published / archived | Content status. |
| Translation | перевод | аударма | translation | Status: complete / partial / missing / outdated = переведено / частично / нет перевода / устарел. |
| Role / permission | роль / право | рөл / құқық | role / permission | |
| Audit log | журнал аудита | аудит журналы | audit log | |

## Rules

- Counts that the API knows (number of competencies, questions, minutes, limit windows) are interpolated, never typed
  into the copy. Static marketing copy avoids exact numbers that depend on the content.
- IDs are written with «№» in ru/kk and «#» in en (`common:format.id`).
- Codes coming from the API (audit actions, statuses, permission keys) are always shown through translated labels;
  unknown codes get a translated generic label with the raw code in parentheses.
