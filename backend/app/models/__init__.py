"""All ORM models. Importing this package registers every table on Base.metadata."""

from app.models.ai import AIAnalysis, AIEvaluation, AIPromptVersion
from app.models.assessment import (
    Answer,
    Assessment,
    AssessmentAttempt,
    Question,
    QuestionCompetency,
    QuestionOption,
    Reassessment,
)
from app.models.auth import EmailVerificationToken, OAuthIdentity, OAuthState, PasswordResetToken, UserSession
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
from app.models.progress import AuditLog, CharacterStageEvent, Notification, ProgressSnapshot
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
    "OAuthIdentity",
    "OAuthState",
    "UserSubscription",
    "AIAnalysis",
    "AIEvaluation",
    "AIPromptVersion",
    "Answer",
    "Assessment",
    "AssessmentAttempt",
    "AuditLog",
    "CharacterStageEvent",
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
