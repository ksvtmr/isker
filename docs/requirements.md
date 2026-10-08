# Requirements

## Business requirements
| ID | Requirement |
|---|---|
| BR-1 | Measure entrepreneurial competencies against a recognised framework (EntreComp, 15 competencies, 3 areas). |
| BR-2 | Turn measurement into development: identify gaps and recommend specific learning and practice. |
| BR-3 | Show measurable development over time (reassessment and history). |
| BR-4 | AI must be explainable, governed and must not decide scores unconstrained. |
| BR-5 | The platform must be operable by non-developers (content and question management). |

## Product requirements
| ID | Requirement | BR |
|---|---|---|
| PR-1 | Accounts with secure registration, login, logout and protected routes | – |
| PR-2 | Onboarding: background, experience, goals, learning format, weekly time | BR-2 |
| PR-3 | Assessment with likert, situational, open and practical items; one question per screen; autosave; resume | BR-1 |
| PR-4 | Deterministic scoring per competency with levels; rubric-constrained AI for open answers | BR-1, BR-4 |
| PR-5 | Competency profile with radar or bars, strengths, priority gaps and an AI explanation | BR-1 |
| PR-6 | Gap analysis (current, target, gap, priority) stored per attempt | BR-2 |
| PR-7 | Recommendation engine linked to competency, gap, goal and resource/task, with a reason | BR-2 |
| PR-8 | Development plan Learn → Practice → Reflect → Reassess | BR-2 |
| PR-9 | Learning resources (start, continue, complete) and practical tasks (start, submit, AI feedback, complete) | BR-2 |
| PR-10 | Full or single-competency reassessment preserving history; progress page with charts | BR-3 |
| PR-11 | "Why this score?" — evidence, method breakdown, rubric criteria, model and prompt version | BR-4 |
| PR-12 | AI governance: prompt versions, evaluation log, fallback statistics | BR-4 |
| PR-13 | Admin: competencies, questions, assessments, resources, tasks, users, statistics | BR-5 |
| PR-14 | Responsive (desktop sidebar, tablet collapsed, mobile bottom nav), accessible, consistent design system | – |

## User stories
| ID | As a learner I want to… | PR |
|---|---|---|
| US-1 | create an account and sign in securely | PR-1 |
| US-2 | tell Isker my goals so recommendations fit me | PR-2 |
| US-3 | take the assessment on my phone and continue later without losing answers | PR-3 |
| US-4 | see my score, level and gaps per competency | PR-4, PR-5, PR-6 |
| US-5 | understand why I received a score | PR-11 |
| US-6 | get a personal plan that tells me what to learn and practise first, and why | PR-7, PR-8 |
| US-7 | complete lessons and practical tasks and get feedback | PR-9 |
| US-8 | reassess and see how much I improved | PR-10 |
| US-9 (admin) | manage questions, content and prompts, and inspect AI evaluations | PR-12, PR-13 |
