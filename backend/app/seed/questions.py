"""Assessment question bank: 15 self-assessment, 10 situational, 4 open, 1 practical (30 questions).

Situational option scores follow EntreComp-aligned rubrics (100 = most effective response).
Open/practical rubric criteria are tagged with the competency they evidence.
"""

LIKERT_OPTIONS = [
    ("Strongly disagree", 0, 1),
    ("Disagree", 25, 2),
    ("Neutral", 50, 3),
    ("Agree", 75, 4),
    ("Strongly agree", 100, 5),
]

ASSESSMENT = {
    "code": "entrecomp-core",
    "title": "Entrepreneurial Competency Assessment",
    "description": "Measures the 15 EntreComp competencies with self-assessment, situational judgement, open "
    "answers and a short practical task.",
    "estimated_minutes": 25,
}

S_SELF, S_SJT, S_OPEN, S_PRACT = "Self-assessment", "Situational judgement", "Open answers", "Practical task"

# (competency, text, reverse_scored)
LIKERT = [
    ("spotting", "I regularly notice unmet needs or problems that people around me have.", False),
    ("creativity", "When I face a problem, I come up with several different possible solutions.", False),
    ("vision", "I can describe what I want an idea of mine to look like in a few years.", False),
    ("valuing", "I can explain why an idea is valuable and to whom.", False),
    ("ethics", "Before acting on an idea, I think about how it affects people and the environment.", False),
    ("self-awareness", "I know my strengths and weaknesses when working on a project.", False),
    ("motivation", "I tend to give up on a project when it becomes difficult.", True),
    (
        "mobilizing-resources",
        "I find ways to get the materials, tools or help I need, even with a small budget.",
        False,
    ),
    ("financial-literacy", "I can estimate the costs and the price of a product or service I want to offer.", False),
    ("mobilizing-others", "I can convince other people to support my ideas.", False),
    ("initiative", "I start working on ideas without waiting for someone to ask me.", False),
    ("planning", "I break big goals into smaller steps with deadlines.", False),
    ("uncertainty", "I postpone decisions until I have complete information.", True),
    ("teamwork", "I work well with people who think differently from me.", False),
    ("learning-experience", "After a setback, I analyse what went wrong and change my approach.", False),
]

# (text, [(competency, weight)], [(option, score)])
SITUATIONAL = [
    (
        "You discover that customers are not using your product the way you expected. What would you do first?",
        [("learning-experience", 1.0), ("spotting", 0.5)],
        [
            ("Keep the plan — customers will adapt over time", 0),
            ("Look at how they actually use it and talk to five customers about why", 100),
            ("Explain the intended use more clearly in the onboarding", 55),
            ("Add the features customers asked for most", 40),
        ],
    ),
    (
        "You are working on a startup idea and discover that your initial assumptions about customers are wrong. "
        "What would you do?",
        [("uncertainty", 1.0), ("learning-experience", 0.5)],
        [
            ("Continue with the original plan", 0),
            ("Ask customers for additional feedback before deciding", 100),
            ("Change the product immediately", 40),
            ("Stop the project", 10),
        ],
    ),
    (
        "Two weeks before an event you organise, its budget is cut in half. What do you do?",
        [("mobilizing-resources", 1.0), ("creativity", 0.5)],
        [
            ("Postpone the event until next semester", 10),
            ("Pay the difference yourself", 25),
            ("List what you need, then ask partners, sponsors and the university for in-kind support", 100),
            ("Reduce the event to what the remaining budget covers", 55),
        ],
    ),
    (
        "You plan to sell handmade notebooks at a campus fair. How do you set the price?",
        [("financial-literacy", 1.0)],
        [
            ("Pick a price that feels fair", 10),
            ("Add up material and time cost per notebook, check similar products, then add a margin", 100),
            ("Match the price of similar notebooks online", 50),
            ("Set a low price so that many people buy", 20),
        ],
    ),
    (
        "Two teammates disagree strongly about the product direction and the team has stopped making progress. "
        "What do you do?",
        [("teamwork", 1.0), ("mobilizing-others", 0.4)],
        [
            ("Bring both together, restate the shared goal and agree on a small test to decide", 100),
            ("Ask the most experienced member to decide", 45),
            ("Let them work it out themselves", 15),
            ("Make the decision yourself without discussion", 25),
        ],
    ),
    (
        "You need two volunteers to help you run a pilot of your idea, but everyone is busy. What do you do?",
        [("mobilizing-others", 1.0), ("vision", 0.5)],
        [
            ("Post a general request in the group chat", 35),
            (
                "Explain to specific people what the pilot will change and what they will gain, and ask for a specific time",
                100,
            ),
            ("Offer a payment you cannot really afford", 30),
            ("Run the pilot alone", 10),
        ],
    ),
    (
        "A supplier offers you a much lower price, but you learn its factory has poor working conditions. "
        "What do you do?",
        [("ethics", 1.0), ("valuing", 0.3)],
        [
            ("Accept the offer — it is legal", 10),
            ("Accept now and plan to switch later", 35),
            ("Ask your customers whether they care, then decide", 55),
            ("Check the facts and look for an alternative supplier, even if your margin is lower at first", 100),
        ],
    ),
    (
        "You have six weeks to launch a small online store and a long list of tasks. How do you start?",
        [("planning", 1.0), ("initiative", 0.3)],
        [
            ("Break the launch into weekly milestones, assign owners and review progress every week", 100),
            ("Start with the most interesting task", 20),
            ("Write a complete detailed plan before doing anything", 50),
            ("Work on whatever feels urgent each day", 15),
        ],
    ),
    (
        "You notice that students in your dormitory struggle to find affordable second-hand textbooks. What do you do?",
        [("initiative", 1.0), ("spotting", 0.6)],
        [
            ("Mention the idea to friends and wait to see if someone builds it", 10),
            ("Complain to the university administration", 20),
            ("Write a full business plan for a textbook marketplace app", 45),
            ("Talk to a few students to confirm the problem and test a simple exchange board this week", 100),
        ],
    ),
    (
        "A classmate wants to present your idea at a competition without mentioning you. What do you do?",
        [("valuing", 1.0), ("ethics", 0.3)],
        [
            ("Let it go — ideas are free", 20),
            ("Talk to them, explain the idea's value and agree on credit or joint participation", 100),
            ("Report them to the organisers immediately", 40),
            ("Quickly submit the idea yourself first", 45),
        ],
    ),
]


def R(criterion: str, description: str, competency: str, keywords: list[str]) -> dict:
    return {"criterion": criterion, "description": description, "competency": competency, "keywords": keywords}


# (type, section, text, help, min_length, [(competency, weight)], rubric)
OPEN = [
    (
        "open",
        S_OPEN,
        "Describe how you would validate a new business idea with limited resources.",
        "Name the steps you would take, what you would measure and how you would decide what to do next.",
        80,
        [("valuing", 1.0), ("mobilizing-resources", 0.6), ("learning-experience", 0.5)],
        [
            R(
                "Testable assumptions",
                "States which assumptions must be true and turns them into tests.",
                "valuing",
                ["assumption", "hypothesis", "test", "validate", "prove", "check"],
            ),
            R(
                "Customer evidence",
                "Plans to collect evidence from real potential customers.",
                "valuing",
                ["customer", "interview", "survey", "user", "talk to", "feedback"],
            ),
            R(
                "Low-cost methods",
                "Uses cheap or free methods and existing resources.",
                "mobilizing-resources",
                ["free", "cheap", "low-cost", "prototype", "landing page", "budget", "mvp", "existing"],
            ),
            R(
                "Decision and iteration",
                "Explains how results change the next step.",
                "learning-experience",
                ["learn", "iterate", "adjust", "result", "decide", "pivot", "change"],
            ),
        ],
    ),
    (
        "open",
        S_OPEN,
        "Describe a situation where you had to convince someone to support your idea. What did you "
        "do, and what was the result?",
        "Describe what you did and why. At least 80 characters.",
        80,
        [("mobilizing-others", 1.0), ("motivation", 0.5), ("self-awareness", 0.5)],
        [
            R(
                "Understanding the other person",
                "Considers the other person's interests and needs.",
                "mobilizing-others",
                ["they", "needs", "interest", "listened", "benefit", "wanted", "their"],
            ),
            R(
                "Persuasive communication",
                "Uses clear arguments, examples or evidence.",
                "mobilizing-others",
                ["explained", "showed", "example", "data", "presented", "demo", "argument"],
            ),
            R(
                "Persistence",
                "Keeps going after an initial no.",
                "motivation",
                ["again", "kept", "tried", "despite", "persist", "follow", "second time"],
            ),
            R(
                "Self-reflection",
                "Reflects on own role and result honestly.",
                "self-awareness",
                ["learned", "realized", "realised", "my strength", "i could", "result", "next time"],
            ),
        ],
    ),
    (
        "open",
        S_OPEN,
        "Imagine your idea is successful five years from now. Describe what has changed for the "
        "people it serves and the main steps that got you there.",
        "If you do not have an idea yet, use one you would like to work on.",
        80,
        [("vision", 1.0), ("creativity", 0.5), ("ethics", 0.4)],
        [
            R(
                "Clear picture of the future",
                "Describes a concrete future state.",
                "vision",
                ["years", "future", "will", "imagine", "become", "grow"],
            ),
            R(
                "Path to get there",
                "Names the steps or milestones towards it.",
                "vision",
                ["first", "then", "step", "milestone", "phase", "after that"],
            ),
            R(
                "Original elements",
                "Includes something new, different or combined.",
                "creativity",
                ["new", "different", "unique", "combine", "alternative", "instead"],
            ),
            R(
                "Impact on people and environment",
                "Considers social or environmental impact.",
                "ethics",
                ["community", "environment", "sustainable", "people", "social", "impact", "fair"],
            ),
        ],
    ),
    (
        "open",
        S_OPEN,
        "Describe a time when something you did failed or did not go as planned. What did you learn, "
        "and what did you do differently afterwards?",
        "Any project counts: study, work, sport, volunteering.",
        80,
        [("learning-experience", 1.0), ("motivation", 0.6), ("self-awareness", 0.5)],
        [
            R(
                "Honest description",
                "Describes what went wrong without blaming others only.",
                "learning-experience",
                ["failed", "mistake", "wrong", "didn't", "did not", "missed", "lost"],
            ),
            R(
                "Insight",
                "Names a specific lesson.",
                "learning-experience",
                ["learned", "learnt", "realized", "realised", "understood", "lesson"],
            ),
            R(
                "Changed behaviour",
                "Shows what was done differently afterwards.",
                "learning-experience",
                ["next time", "now i", "differently", "changed", "afterwards", "since then"],
            ),
            R(
                "Persistence",
                "Kept going after the setback.",
                "motivation",
                ["continued", "kept", "again", "tried", "did not give up", "didn't give up"],
            ),
            R(
                "Self-knowledge",
                "Connects the result to own strengths or weaknesses.",
                "self-awareness",
                ["my weakness", "my strength", "i tend", "i am", "about myself"],
            ),
        ],
    ),
    (
        "practical",
        S_PRACT,
        "Identify a problem in your environment (campus, city or workplace) and propose a "
        "business opportunity to solve it. Name who has the problem, your solution and how it would earn money.",
        "Aim for 5–8 sentences. There is no single right answer.",
        120,
        [("spotting", 1.0), ("creativity", 0.7), ("financial-literacy", 0.4)],
        [
            R(
                "Specific problem",
                "Describes a concrete, observable problem.",
                "spotting",
                ["problem", "struggle", "need", "difficult", "waste", "hard to", "lack"],
            ),
            R(
                "Target users",
                "Names who has the problem.",
                "spotting",
                ["customers", "users", "students", "people", "who", "parents", "owners"],
            ),
            R(
                "Creative solution",
                "Proposes a solution with something new in it.",
                "creativity",
                ["idea", "solution", "app", "service", "new", "combine", "platform"],
            ),
            R(
                "Revenue logic",
                "Explains how it would earn money.",
                "financial-literacy",
                ["price", "pay", "revenue", "subscription", "fee", "cost", "margin", "commission"],
            ),
        ],
    ),
]
