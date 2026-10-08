"""All ORM models. Importing this package registers every table on Base.metadata."""

from app.models.ai import AIEvaluation, AIPromptVersion
from app.models.assessment import (
    Answer,
    Assessment,
    AssessmentAttempt,
    Question,
    QuestionCompetency,
    QuestionOption,
    Reassessment,
)
from app.models.competency import Competency, CompetencyArea, CompetencyLevel
from app.models.learning import (
    LearningActivity,
    LearningResource,
    PracticalTask,
    PracticeSubmission,
    Recommendation,
    UserLearningProgress,
)
from app.models.progress import AuditLog, Notification, ProgressSnapshot
from app.models.scoring import CompetencyGap, CompetencyScore
from app.models.user import GoalCompetencyWeight, GoalDefinition, RevokedToken, User, UserGoal, UserProfile

__all__ = [
    "AIEvaluation",
    "AIPromptVersion",
    "Answer",
    "Assessment",
    "AssessmentAttempt",
    "AuditLog",
    "Competency",
    "CompetencyArea",
    "CompetencyGap",
    "CompetencyLevel",
    "CompetencyScore",
    "GoalCompetencyWeight",
    "GoalDefinition",
    "LearningActivity",
    "LearningResource",
    "Notification",
    "PracticalTask",
    "PracticeSubmission",
    "ProgressSnapshot",
    "Question",
    "QuestionCompetency",
    "QuestionOption",
    "Reassessment",
    "Recommendation",
    "RevokedToken",
    "User",
    "UserGoal",
    "UserLearningProgress",
    "UserProfile",
]
