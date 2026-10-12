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
from app.models.auth import EmailVerificationToken, PasswordResetToken, UserSession
from app.models.billing import (
    PaymentWebhookEvent,
    PlanEntitlement,
    SubscriptionEvent,
    SubscriptionPlan,
    UserSubscription,
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
from app.models.rbac import Permission, Role, RolePermission, UserRole
from app.models.scoring import CompetencyGap, CompetencyScore
from app.models.user import GoalCompetencyWeight, GoalDefinition, User, UserGoal, UserProfile

__all__ = [
    "EmailVerificationToken",
    "PasswordResetToken",
    "PaymentWebhookEvent",
    "Permission",
    "PlanEntitlement",
    "Role",
    "RolePermission",
    "SubscriptionEvent",
    "SubscriptionPlan",
    "UserRole",
    "UserSession",
    "UserSubscription",
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
    "User",
    "UserGoal",
    "UserLearningProgress",
    "UserProfile",
]
