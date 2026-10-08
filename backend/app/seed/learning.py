"""Learning resources (2 per competency) and practical tasks (1 per competency)."""

from app.seed.questions import R

# slug, competency, title, description, type, difficulty, minutes, content (markdown)
RESOURCES = [
    (
        "customer-discovery-interviews",
        "spotting",
        "Customer Discovery Interviews",
        "How to talk to people about their problems without pitching your solution.",
        "video",
        "beginner",
        18,
        """## Why interviews come first
Most opportunities are found by listening, not by brainstorming alone. A customer discovery interview checks
whether a problem is real, frequent and painful enough that people would change their behaviour.

## How to run one
- Ask about the **last time** the problem happened, not about hypothetical futures.
- Ask what they already tried and what it cost them in time or money.
- Do not describe your idea until the end — it biases every answer.
- Write down exact phrases people use; they become your marketing language later.

## What to look for
A strong opportunity shows up as: the problem happens often, people already spend effort on workarounds,
and they can name a moment when it really hurt.

**Try it:** interview three people this week with the question "Tell me about the last time you…".""",
    ),
    (
        "trend-spotting-canvas",
        "spotting",
        "Trend Spotting: From Change to Opportunity",
        "Use changes in technology, regulation and habits to find opportunities early.",
        "exercise",
        "intermediate",
        25,
        """## Opportunities follow change
New opportunities appear when something changes: a new technology, a new rule, a new habit or a new group of
people with a need.

## Exercise
1. List five changes you see around you (for example, more remote study, new payment apps, rising rent).
2. For each change, ask: *who is now worse off?* and *who now has a new option?*
3. Pick the two most interesting combinations and write one sentence each: "Because of X, Y now needs Z."
4. Rate each on frequency (how often), intensity (how painful) and reach (how many people).

## Output
Two opportunity statements you can test with customer interviews.""",
    ),
    (
        "idea-generation-techniques",
        "creativity",
        "Five Idea-Generation Techniques",
        "SCAMPER, reverse brainstorming and three more methods to produce many ideas quickly.",
        "article",
        "beginner",
        12,
        """## Quantity before quality
Good ideas usually come after many ordinary ones. Generate first, judge later.

## Techniques
- **SCAMPER** — Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Reverse.
- **Reverse brainstorming** — ask "how could we make this problem worse?", then invert each answer.
- **Analogies** — how does another industry solve a similar problem?
- **Constraints** — "what if it had to cost nothing?" or "work without internet?"
- **Crazy 8s** — fold a sheet into eight boxes and sketch eight ideas in eight minutes.

**Practice:** take one problem and produce 20 ideas using two of these techniques.""",
    ),
    (
        "creative-constraints-lab",
        "creativity",
        "Creative Constraints Lab",
        "Turn limits on budget, time and tools into design input.",
        "exercise",
        "intermediate",
        20,
        """## Constraints help creativity
When a budget is cut or a tool is missing, teams that treat the limit as a design input often find better
solutions than teams with plenty of resources.

## Lab
1. Pick a project idea.
2. Apply three constraints one by one: half the budget, one week only, no paid tools.
3. For each constraint, redesign the idea and note what became *simpler* or *more original*.
4. Combine the best elements into one version.

Reflect: which constraint produced the most surprising idea?""",
    ),
    (
        "vision-statement-workshop",
        "vision",
        "Writing a Vision That Guides Action",
        "Describe a concrete future and work backwards to the first steps.",
        "article",
        "beginner",
        12,
        """## A vision is a picture, not a slogan
A useful vision describes what will be different for real people at a specific time: "In 2030, first-year
students in Astana find housing in one day instead of three weeks."

## Backcasting
1. Write your five-year picture in three sentences.
2. Ask what must be true one year before that, then one year before that.
3. Stop when you reach something you can start this month.

A good vision makes it easier to say **no** to work that does not move you towards it.""",
    ),
    (
        "scenario-planning-basics",
        "vision",
        "Scenario Planning for Founders",
        "Explore several possible futures so your plan survives surprises.",
        "course",
        "advanced",
        40,
        """## Why scenarios
Founders who imagine only one future are surprised more often. Scenario planning prepares you for several.

## Module 1 — Drivers
List forces that shape your market: technology, regulation, customer habits, competition.

## Module 2 — Two axes
Pick the two most uncertain and most important drivers. Combine them into four scenarios.

## Module 3 — Strategy test
For each scenario, ask whether your current strategy still works and what early signals would tell you that
this scenario is becoming real.

## Module 4 — Signals dashboard
Choose three signals to watch every month.""",
    ),
    (
        "value-proposition-canvas",
        "valuing",
        "Value Proposition Canvas",
        "Map customer jobs, pains and gains to what your idea offers.",
        "template",
        "beginner",
        15,
        """## The canvas
**Customer side:** jobs they try to get done, pains on the way, gains they hope for.
**Your side:** products and services, pain relievers, gain creators.

## How to use it
1. Fill in the customer side from interviews, not from guesses.
2. Fill in your side.
3. Draw lines between pains and relievers. Unmatched pains are opportunities; unmatched features may be waste.

A fit exists when your top three features address the customer's top three pains.""",
    ),
    (
        "testing-business-assumptions",
        "valuing",
        "Testing Your Riskiest Assumptions",
        "Find the assumption that would kill your idea and test it in a week.",
        "case_study",
        "intermediate",
        20,
        """## Case: the campus meal-prep idea
Aruzhan wanted to sell weekly meal boxes to students. Her riskiest assumption was not the recipe; it was
"students will pay in advance for a whole week."

## The test
She built a one-page form with three box options and a "reserve with payment" button and shared it in two
student chats. In five days, 14 students paid a deposit.

## Lessons
- List assumptions, then rank them by *risk × uncertainty*.
- Design the cheapest test that could prove the riskiest one wrong.
- Decide the success threshold **before** running the test.""",
    ),
    (
        "ethics-in-business-decisions",
        "ethics",
        "Ethics in Everyday Business Decisions",
        "A short framework for checking the impact of a decision on people and the planet.",
        "article",
        "beginner",
        10,
        """## Four questions before you decide
1. **Who is affected?** Customers, workers, suppliers, neighbours, the environment.
2. **What could go wrong for them?** Think one step beyond the obvious.
3. **Would you be comfortable if it were public?** The newspaper test.
4. **Is there a better option?** Often a small change removes most of the harm.

Ethical choices can cost margin in the short term but build trust, which is a long-term asset.""",
    ),
    (
        "sustainable-business-models",
        "ethics",
        "Sustainable Business Models",
        "Case examples of businesses that create value for people and the environment.",
        "case_study",
        "intermediate",
        25,
        """## Three patterns
- **Product as a service** — renting instead of selling reduces waste (tool libraries, clothing rental).
- **Circular supply** — waste from one business is input for another (coffee grounds for mushroom farming).
- **Inclusive value chains** — buying from small local producers at fair prices.

## Case questions
For each pattern, identify who pays, who benefits and what would make the model fail. Then ask how one of
these patterns could apply to your own idea.""",
    ),
    (
        "know-your-strengths",
        "self-awareness",
        "Know Your Strengths",
        "Collect evidence about your strengths from your own projects and from people around you.",
        "exercise",
        "beginner",
        15,
        """## Evidence, not guesses
1. List three moments when you felt energised and did good work. What were you doing?
2. Ask three people who know you: "When have you seen me at my best?"
3. Look for patterns between your list and their answers.

## Self-efficacy
Believing you can influence results grows from small wins. Pick one strength and use it deliberately this week
on a task that matters.""",
    ),
    (
        "growth-mindset-for-founders",
        "self-awareness",
        "Self-efficacy and Growth Mindset",
        "How beliefs about ability shape what founders attempt.",
        "video",
        "intermediate",
        14,
        """## Key ideas
- Self-efficacy is your belief that you can succeed at a specific task. It predicts effort and persistence.
- It grows through mastery experiences, seeing peers succeed, encouragement and managing stress.
- A growth mindset treats skills as learnable: "I can't do this **yet**."

## Practice
Write one skill you avoid because you think you are "not that type of person". Plan one small mastery
experience for it.""",
    ),
    (
        "staying-motivated",
        "motivation",
        "Staying Motivated on Long Projects",
        "Practical techniques to keep going when progress is slow.",
        "article",
        "beginner",
        10,
        """## Why motivation drops
Progress on entrepreneurial projects is uneven. Long periods without visible results drain energy.

## Techniques
- Make progress **visible**: a simple weekly log of what moved forward.
- Connect tasks to your *why* — write it at the top of your task list.
- Use small commitments: "work on it for 20 minutes" is easier to start than "finish the plan".
- Share goals with a peer who asks about them weekly.""",
    ),
    (
        "resilience-after-rejection",
        "motivation",
        "Resilience After Rejection",
        "How founders handle 'no' from customers, investors and partners.",
        "case_study",
        "intermediate",
        18,
        """## Case: forty rejections
A student team pitching a recycling app to cafés heard "no" forty times. Instead of quitting, they wrote down
the reason for each rejection. Twenty-six were about the same thing: staff time.

## What changed
They redesigned the service so the café did nothing extra. The next ten pitches produced four pilots.

## Takeaways
Treat rejection as data. Separate "no to the idea" from "no to this version" and from "no to me".""",
    ),
    (
        "bootstrapping-resources",
        "mobilizing-resources",
        "Bootstrapping: Doing More With Less",
        "Find free and borrowed resources before spending money.",
        "article",
        "beginner",
        12,
        """## Resource map
List what you need in four groups: **people**, **money**, **materials and space**, **knowledge**.

## Before buying, ask
- Can I borrow it? (university labs, libraries, makerspaces)
- Can I exchange it? (skills swap with other students)
- Can a partner provide it in kind? (a café hosting an event)
- Is there a free digital tool that is good enough?

Bootstrapping keeps your options open and forces you to validate before you scale.""",
    ),
    (
        "partnerships-and-in-kind-support",
        "mobilizing-resources",
        "Partnerships and In-kind Support",
        "How to ask organisations for space, tools and expertise.",
        "template",
        "intermediate",
        20,
        """## The ask template
1. **Who you are** — one sentence.
2. **What you are doing** — the project and why it matters to *them*.
3. **The specific ask** — what, how much, when.
4. **What they get** — visibility, data, access to students, a solved problem.
5. **Next step** — a 15-minute call.

Send it to five organisations. Track replies in a simple table: contacted, replied, outcome.""",
    ),
    (
        "unit-economics-basics",
        "financial-literacy",
        "Understanding Unit Economics",
        "Learn how revenue, cost per customer and margin decide whether a startup can grow.",
        "article",
        "beginner",
        15,
        """## The unit
Pick the unit your business sells: one meal box, one subscription month, one notebook.

## Three numbers
- **Price per unit** — what the customer pays.
- **Variable cost per unit** — materials, packaging, delivery, payment fees.
- **Contribution margin** — price minus variable cost.

## Example
A notebook sells for 2 500 ₸. Paper, cover and binding cost 1 100 ₸, the fair stand fee shared across 50
notebooks adds 200 ₸. Contribution margin: 2 500 − 1 300 = **1 200 ₸**.

## Break-even
Fixed costs ÷ contribution margin = units needed to break even. If fixed costs are 60 000 ₸, you need 50
notebooks.

**Rule of thumb:** if the margin is negative, selling more makes the loss bigger.""",
    ),
    (
        "cash-flow-for-founders",
        "financial-literacy",
        "Reading a Simple Cash-Flow Plan",
        "Understand when money comes in and goes out — and why profitable businesses still run out of cash.",
        "video",
        "intermediate",
        12,
        """## Profit is not cash
A business can be profitable on paper and still unable to pay suppliers if customers pay late.

## A 12-week cash-flow table
Columns are weeks. Rows: opening cash, cash in (sales, grants), cash out (materials, rent, salaries),
closing cash.

## Warning signs
- Closing cash below zero in any week.
- Large one-off payments clustered together.
- Revenue that depends on one customer.

Build the table for your idea and find the lowest week.""",
    ),
    (
        "pitching-your-idea",
        "mobilizing-others",
        "Pitching Your Idea in Two Minutes",
        "A simple structure to make others care about your idea.",
        "video",
        "beginner",
        12,
        """## Structure
1. **Hook** — a real moment that shows the problem.
2. **Problem** — who has it and how often.
3. **Solution** — what you do, in one sentence.
4. **Proof** — any evidence: interviews, pre-orders, a pilot.
5. **Ask** — exactly what you need from this audience.

Rehearse out loud three times and cut every sentence that does not serve the ask.""",
    ),
    (
        "building-a-support-network",
        "mobilizing-others",
        "Building a Support Network",
        "Identify and approach the people who can help your idea succeed.",
        "exercise",
        "intermediate",
        20,
        """## Stakeholder map
Draw four circles: users, helpers (mentors, experts), gatekeepers (people who approve), and amplifiers (people
with an audience).

## Exercise
1. Put at least two real names in each circle.
2. For each name, write what they care about.
3. Write a one-line message that connects your idea to what they care about.
4. Send three messages this week.""",
    ),
    (
        "from-idea-to-first-step",
        "initiative",
        "From Idea to First Step",
        "Beat procrastination by defining the smallest useful action.",
        "article",
        "beginner",
        8,
        """## The smallest useful action
Big ideas stall because the first step is unclear. Define an action that takes under 30 minutes and produces
evidence: send a message, sketch a page, ask one person.

## The 48-hour rule
When you notice an opportunity, take one small action within 48 hours. Momentum matters more than the
perfect plan.""",
    ),
    (
        "leading-without-authority",
        "initiative",
        "Leading Without Authority",
        "How to take initiative in teams and organisations where you are not the boss.",
        "case_study",
        "advanced",
        22,
        """## Case: the internship project
An intern noticed customers repeatedly asking the same question. Instead of waiting, she collected 30
examples, drafted an FAQ and asked her manager for 15 minutes to show it. The FAQ cut support emails by a
quarter.

## Pattern
Notice → collect evidence → propose a small, reversible step → ask for permission to try → report results.""",
    ),
    (
        "goal-to-milestones",
        "planning",
        "From Goal to Milestones",
        "Break a goal into milestones with owners and deadlines.",
        "article",
        "beginner",
        12,
        """## Goal → milestones → tasks
- **Goal:** the outcome, with a date ("100 paying users by 1 December").
- **Milestones:** 4–6 checkpoints that show you are on track.
- **Tasks:** concrete actions, each with one owner and a deadline.

## Weekly review
Every week ask: what moved, what is blocked, what changes? Update the plan — a plan that never changes is
not being used.""",
    ),
    (
        "lean-project-planning",
        "planning",
        "Lean Project Planning",
        "Plan in short cycles and adapt to what you learn.",
        "course",
        "intermediate",
        45,
        """## Module 1 — Outcomes over outputs
Define what success looks like for users, not just what you will build.

## Module 2 — Two-week cycles
Plan only two weeks in detail. Keep the rest as milestones.

## Module 3 — Visual boards
Use To do / Doing / Done columns and limit work in progress.

## Module 4 — Retrospectives
At the end of each cycle: what worked, what didn't, what we will try next.""",
    ),
    (
        "deciding-with-incomplete-information",
        "uncertainty",
        "Deciding With Incomplete Information",
        "Tools for making good decisions when you cannot know everything.",
        "article",
        "beginner",
        10,
        """## Reversible or not?
Most decisions are reversible. Make those quickly, and slow down only for one-way doors.

## The 70% rule
If you have about 70% of the information you wish you had, decide. Waiting for 90% usually costs more than a
correctable mistake.

## Make risk smaller
Run a small experiment before a big commitment: a pilot, a pre-order, a one-week trial.""",
    ),
    (
        "pre-mortem-exercise",
        "uncertainty",
        "Pre-mortem: Find Risks Before They Find You",
        "Imagine your project failed and work out why — before you start.",
        "exercise",
        "intermediate",
        20,
        """## How it works
1. Imagine it is six months from now and the project has failed.
2. Everyone writes down reasons why, silently, for five minutes.
3. Group the reasons and rate each by likelihood and impact.
4. For the top three, agree on an early warning signal and a prevention step.

Pre-mortems make it safe to voice doubts and reduce over-confidence.""",
    ),
    (
        "effective-team-collaboration",
        "teamwork",
        "Effective Team Collaboration",
        "Roles, communication habits and agreements that make small teams work.",
        "article",
        "beginner",
        12,
        """## Team agreement
Agree early on: how decisions are made, how you communicate, how often you meet, and what happens when someone
cannot deliver.

## Healthy habits
- Short weekly check-ins with three questions: done, next, blocked.
- Disagree about ideas, not people.
- Make roles explicit, and revisit them as the project changes.""",
    ),
    (
        "resolving-team-conflict",
        "teamwork",
        "Resolving Team Conflict",
        "A step-by-step approach to turn disagreement into better decisions.",
        "video",
        "intermediate",
        15,
        """## Steps
1. Separate the people from the problem.
2. Restate the shared goal.
3. Let each side explain their reasoning and what evidence would change their mind.
4. Agree on a small test or criteria to decide.
5. Write down the decision and when you will review it.""",
    ),
    (
        "reflective-practice",
        "learning-experience",
        "Reflective Practice for Founders",
        "A simple routine to learn systematically from what happens.",
        "article",
        "beginner",
        10,
        """## What? So what? Now what?
- **What happened?** Facts only.
- **So what?** Why it matters and what it tells you.
- **Now what?** What you will do differently next time.

Spend ten minutes on this after every important event — a pitch, a failed test, a team conflict.""",
    ),
    (
        "learning-from-failure-case",
        "learning-experience",
        "What I Learned From a Failed Experiment",
        "A founder's story of a failed launch and the changes that followed.",
        "case_study",
        "intermediate",
        15,
        """## The launch that didn't work
A student team launched a tutoring marketplace with 40 tutors and no students. They had tested whether tutors
wanted work — not whether students would pay.

## What they changed
They started over with one subject, five tutors and a waiting list of students, and only added tutors when
demand appeared.

## Lessons
Run the test that could prove you wrong. Write lessons down so the whole team learns, not just one person.""",
    ),
]

# slug, competency, title, description, instructions, difficulty, minutes, rubric, min_length
TASKS = [
    (
        "identify-customer-problems",
        "spotting",
        "Identify 3 Customer Problems",
        "Find three real problems people around you have and describe them precisely.",
        "Talk to or observe at least three people. For each problem write: who has it, when it happens, what they do "
        "today and why that is not good enough.",
        "intermediate",
        30,
        [
            R(
                "Specific problems",
                "Each problem is concrete and observable.",
                "spotting",
                ["problem", "when", "struggle", "need"],
            ),
            R(
                "Who has it",
                "Names the people affected.",
                "spotting",
                ["students", "people", "who", "customers", "users"],
            ),
            R(
                "Current workaround",
                "Describes what people do today.",
                "spotting",
                ["today", "currently", "now", "instead", "workaround"],
            ),
        ],
        120,
    ),
    (
        "twenty-ideas",
        "creativity",
        "Twenty Ideas in Twenty Minutes",
        "Generate twenty solutions to one problem using two creativity techniques.",
        "Choose one problem. Use two techniques (for example SCAMPER and reverse brainstorming). List at least 20 "
        "ideas, then pick the two most original and explain why.",
        "beginner",
        20,
        [
            R("Quantity", "Lists many ideas.", "creativity", ["1.", "2.", "idea", "-", "10", "20"]),
            R(
                "Technique use",
                "Shows the techniques used.",
                "creativity",
                ["scamper", "reverse", "combine", "analogy", "constraint"],
            ),
            R(
                "Selection reasoning",
                "Explains why two ideas are most original.",
                "creativity",
                ["because", "original", "different", "new"],
            ),
        ],
        150,
    ),
    (
        "five-year-vision",
        "vision",
        "Write a Five-Year Vision",
        "Describe your idea in five years and backcast the first steps.",
        "Write three sentences describing the future state, then list what must be true at year 3, year 1 and this "
        "month.",
        "intermediate",
        25,
        [
            R("Concrete future", "Describes a specific future.", "vision", ["years", "will", "future", "by 20"]),
            R(
                "Backcasting steps",
                "Works back to near-term steps.",
                "vision",
                ["year 1", "year 3", "this month", "first", "then"],
            ),
            R(
                "Ambition and realism",
                "Balances ambition with feasibility.",
                "vision",
                ["realistic", "possible", "need", "resources"],
            ),
        ],
        120,
    ),
    (
        "riskiest-assumption-test",
        "valuing",
        "Design a Riskiest-Assumption Test",
        "Choose the assumption that would kill your idea and design a one-week test.",
        "List five assumptions behind your idea, rank them by risk, and describe a test for the riskiest one with a "
        "success threshold decided in advance.",
        "intermediate",
        30,
        [
            R("Assumption list", "Lists and ranks assumptions.", "valuing", ["assumption", "risk", "rank", "believe"]),
            R(
                "Test design",
                "Describes a concrete cheap test.",
                "valuing",
                ["test", "survey", "landing", "pre-order", "interview"],
            ),
            R(
                "Success threshold",
                "States a threshold before testing.",
                "valuing",
                ["threshold", "if", "at least", "%", "success"],
            ),
        ],
        150,
    ),
    (
        "impact-check",
        "ethics",
        "Impact Check of Your Idea",
        "Assess who your idea could affect and how to reduce harm.",
        "Identify at least four groups affected by your idea (including the environment). For each, describe one "
        "possible negative effect and one change that reduces it.",
        "beginner",
        20,
        [
            R(
                "Stakeholders",
                "Identifies affected groups.",
                "ethics",
                ["customers", "workers", "community", "environment", "suppliers"],
            ),
            R("Negative effects", "Names possible harm.", "ethics", ["harm", "negative", "risk", "waste", "unfair"]),
            R(
                "Mitigation",
                "Proposes changes to reduce harm.",
                "ethics",
                ["reduce", "change", "instead", "avoid", "sustainable"],
            ),
        ],
        120,
    ),
    (
        "strengths-evidence",
        "self-awareness",
        "Collect Evidence of Your Strengths",
        "Gather feedback from three people and compare it with your own view.",
        "Ask three people when they have seen you at your best. Compare their answers with your own list of strengths "
        "and describe one surprise.",
        "beginner",
        25,
        [
            R(
                "Feedback collected",
                "Reports others' feedback.",
                "self-awareness",
                ["said", "told", "feedback", "asked"],
            ),
            R(
                "Comparison",
                "Compares feedback with own view.",
                "self-awareness",
                ["i thought", "compared", "same", "different"],
            ),
            R(
                "Insight",
                "Names a specific insight.",
                "self-awareness",
                ["surprise", "realized", "realised", "learned", "strength"],
            ),
        ],
        120,
    ),
    (
        "progress-log",
        "motivation",
        "Two-Week Progress Log",
        "Keep a short daily log of progress on one project and reflect on your energy.",
        "For two weeks write one line a day about what moved forward. Then summarise what kept you going and what "
        "drained your energy.",
        "beginner",
        20,
        [
            R("Consistency", "Shows regular entries or progress.", "motivation", ["day", "week", "every", "log"]),
            R(
                "Energy drivers",
                "Identifies what keeps motivation.",
                "motivation",
                ["kept", "motivated", "energy", "because"],
            ),
            R("Adjustment", "Plans a change to stay motivated.", "motivation", ["next", "will", "change", "plan"]),
        ],
        120,
    ),
    (
        "resource-map",
        "mobilizing-resources",
        "Build a Resource Map",
        "Map the people, money, materials and knowledge your idea needs and where to get them for free.",
        "List what you need in four groups. For each item, name at least one free or borrowed source and who you will "
        "ask.",
        "intermediate",
        25,
        [
            R(
                "Needs identified",
                "Lists needed resources by group.",
                "mobilizing-resources",
                ["people", "money", "materials", "knowledge", "space"],
            ),
            R(
                "Sources",
                "Names free or borrowed sources.",
                "mobilizing-resources",
                ["borrow", "free", "university", "partner", "library"],
            ),
            R("Concrete asks", "Names who to ask.", "mobilizing-resources", ["ask", "contact", "email", "meet"]),
        ],
        120,
    ),
    (
        "startup-budget",
        "financial-literacy",
        "Build a Simple Startup Budget",
        "Estimate costs, price and break-even for a small venture.",
        "For your idea (or a campus coffee stand), list fixed and variable costs, set a price per unit, calculate the "
        "contribution margin and the number of units needed to break even.",
        "intermediate",
        30,
        [
            R(
                "Cost estimate",
                "Separates fixed and variable costs.",
                "financial-literacy",
                ["fixed", "variable", "cost", "rent", "materials"],
            ),
            R(
                "Pricing logic",
                "Justifies a price.",
                "financial-literacy",
                ["price", "margin", "competitor", "customers pay"],
            ),
            R(
                "Break-even",
                "Calculates break-even.",
                "financial-literacy",
                ["break-even", "break even", "units", "divide", "÷"],
            ),
        ],
        150,
    ),
    (
        "two-minute-pitch",
        "mobilizing-others",
        "Write a Two-Minute Pitch",
        "Write and test a pitch that ends with a clear ask.",
        "Write a pitch using hook, problem, solution, proof and ask. Deliver it to one person and note their reaction "
        "and one improvement.",
        "intermediate",
        25,
        [
            R("Structure", "Follows a clear structure.", "mobilizing-others", ["problem", "solution", "hook", "proof"]),
            R(
                "Clear ask",
                "Ends with a specific ask.",
                "mobilizing-others",
                ["ask", "need", "join", "support", "help"],
            ),
            R(
                "Audience reaction",
                "Reports reaction and improvement.",
                "mobilizing-others",
                ["reaction", "said", "feedback", "improve"],
            ),
        ],
        150,
    ),
    (
        "forty-eight-hour-action",
        "initiative",
        "The 48-Hour Action",
        "Take one small action on an idea within 48 hours and report the result.",
        "Choose an idea you have postponed. Within 48 hours take one action that produces evidence (message, sketch, "
        "conversation). Describe what you did and what you learned.",
        "beginner",
        20,
        [
            R(
                "Action taken",
                "Describes a concrete action.",
                "initiative",
                ["i sent", "i asked", "i made", "i called", "i talked", "did"],
            ),
            R("Speed", "Acted quickly.", "initiative", ["hours", "today", "yesterday", "immediately"]),
            R("Result", "Reports evidence gained.", "initiative", ["result", "learned", "found", "response"]),
        ],
        100,
    ),
    (
        "six-week-milestone-plan",
        "planning",
        "Six-Week Milestone Plan",
        "Break a project into a six-week plan with milestones and owners.",
        "Define the goal with a date, six weekly milestones, and for the first two weeks list tasks with one owner and "
        "a deadline each.",
        "intermediate",
        30,
        [
            R("Goal", "States a dated goal.", "planning", ["goal", "by", "date", "deadline"]),
            R("Milestones", "Lists weekly milestones.", "planning", ["week 1", "week 2", "milestone", "week"]),
            R("Owners and tasks", "Assigns owners and tasks.", "planning", ["owner", "responsible", "task", "who"]),
        ],
        150,
    ),
    (
        "run-a-pre-mortem",
        "uncertainty",
        "Run a Pre-mortem on Your Idea",
        "Imagine your idea failed and list the three most likely reasons and their warning signs.",
        "Imagine it is six months later and your idea failed. List reasons, choose the top three, and for each name an "
        "early warning signal and a prevention step.",
        "intermediate",
        20,
        [
            R(
                "Failure reasons",
                "Lists plausible failure reasons.",
                "uncertainty",
                ["fail", "because", "risk", "reason"],
            ),
            R("Warning signals", "Names early signals.", "uncertainty", ["signal", "sign", "warning", "if we see"]),
            R("Prevention", "Plans prevention steps.", "uncertainty", ["prevent", "test", "reduce", "plan b", "small"]),
        ],
        120,
    ),
    (
        "team-agreement",
        "teamwork",
        "Draft a Team Agreement",
        "Agree with your team on decisions, communication and handling conflict.",
        "With your team (or for a team you were in) write down how you make decisions, communicate, meet and resolve "
        "disagreements. Note one rule you would add after a past conflict.",
        "beginner",
        25,
        [
            R(
                "Decision making",
                "Explains how decisions are made.",
                "teamwork",
                ["decide", "vote", "consensus", "decision"],
            ),
            R(
                "Communication",
                "Agrees on communication habits.",
                "teamwork",
                ["meet", "chat", "weekly", "communicate"],
            ),
            R(
                "Conflict handling",
                "Covers how conflicts are resolved.",
                "teamwork",
                ["conflict", "disagree", "resolve", "discuss"],
            ),
        ],
        120,
    ),
    (
        "what-so-what-now-what",
        "learning-experience",
        "What? So What? Now What?",
        "Reflect on a recent experience with a structured model.",
        "Pick an event from the last month (a presentation, a test, a project). Answer: What happened? So what does it "
        "mean? Now what will you do differently?",
        "beginner",
        15,
        [
            R("What happened", "Describes facts.", "learning-experience", ["happened", "i did", "we", "event"]),
            R(
                "Meaning",
                "Interprets the experience.",
                "learning-experience",
                ["means", "learned", "realized", "realised", "because"],
            ),
            R(
                "Next action",
                "Commits to a change.",
                "learning-experience",
                ["next time", "will", "differently", "change"],
            ),
        ],
        120,
    ),
]
