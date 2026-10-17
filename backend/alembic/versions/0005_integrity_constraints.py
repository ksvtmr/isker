"""Integrity constraints: one open attempt, one current subscription, one default plan; content FKs RESTRICT.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-17

Data cleanup (runs first, so the new unique indexes can be built on existing data; nothing is deleted):
- assessment_attempts: for a user with several `in_progress` attempts, all but the newest (highest id) are marked
  `abandoned` (their answers are kept), as the application already does when a new attempt replaces an open one.
- user_subscriptions: for a user with several current subscriptions (trialing / active / past_due / incomplete),
  all but the newest are moved to `expired` with `ended_at` set, and a `subscription_events` row
  (event_type `expired`, source `system`, reason "Duplicate current subscription closed by migration 0005") records
  each change.
- subscription_plans: if several plans are marked default, only the lowest id (the one the application already
  used, see services/subscriptions.default_plan) keeps `is_default`.

Schema:
- Partial unique index uq_assessment_attempts_user_in_progress on assessment_attempts(user_id)
  WHERE status = 'in_progress'.
- Partial unique index uq_user_subscriptions_user_current on user_subscriptions(user_id)
  WHERE status IN ('trialing', 'active', 'past_due', 'incomplete').
- Partial unique index uq_subscription_plans_single_default on subscription_plans(is_default) WHERE is_default.
- Content-side foreign keys change from ON DELETE CASCADE to RESTRICT, so deleting content can no longer silently
  erase learner history: competency_scores / competency_gaps / recommendations / question_competencies
  (competency_id), answers (question_id), practice_submissions (task_id), user_learning_progress (resource_id).
  Content is archived, not deleted (admin endpoints already archive). User-side cascades (account deletion) are
  unchanged.

Downgrade drops the indexes and restores the CASCADE foreign keys. The data cleanup is not reversed (abandoned
attempts and expired duplicate subscriptions stay as they are; their history rows explain why).
"""
# ruff: noqa: S608 - the SQL below is built only from module constants, never from input.
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0005'
down_revision: str | None = '0004'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CURRENT = "status IN ('trialing', 'active', 'past_due', 'incomplete')"

# (table, column, referred table, constraint name)
CONTENT_FKS = [
    ('answers', 'question_id', 'questions', 'fk_answers_question_id_questions'),
    ('competency_gaps', 'competency_id', 'competencies', 'fk_competency_gaps_competency_id_competencies'),
    ('competency_scores', 'competency_id', 'competencies', 'fk_competency_scores_competency_id_competencies'),
    ('practice_submissions', 'task_id', 'practical_tasks', 'fk_practice_submissions_task_id_practical_tasks'),
    ('question_competencies', 'competency_id', 'competencies',
     'fk_question_competencies_competency_id_competencies'),
    ('recommendations', 'competency_id', 'competencies', 'fk_recommendations_competency_id_competencies'),
    ('user_learning_progress', 'resource_id', 'learning_resources',
     'fk_user_learning_progress_resource_id_learning_resources'),
]


def _cleanup() -> None:
    # 1. One open attempt per user: abandon the older ones.
    op.execute(
        "UPDATE assessment_attempts SET status = 'abandoned', updated_at = CURRENT_TIMESTAMP "
        "WHERE status = 'in_progress' AND id NOT IN "
        "(SELECT max(id) FROM assessment_attempts WHERE status = 'in_progress' GROUP BY user_id)"
    )
    # 2. One current subscription per user: expire the older ones, with a history event each.
    dup = (
        f"SELECT id FROM user_subscriptions WHERE {CURRENT} AND id NOT IN "
        f"(SELECT max(id) FROM user_subscriptions WHERE {CURRENT} GROUP BY user_id)"
    )
    op.execute(
        "INSERT INTO subscription_events "
        "(subscription_id, user_id, event_type, from_status, to_status, plan_id, actor_id, source, reason, created_at) "
        "SELECT id, user_id, 'expired', status, 'expired', plan_id, NULL, 'system', "
        "'Duplicate current subscription closed by migration 0005', CURRENT_TIMESTAMP "
        f"FROM user_subscriptions WHERE id IN ({dup})"
    )
    op.execute(
        "UPDATE user_subscriptions SET status = 'expired', ended_at = CURRENT_TIMESTAMP, "
        f"updated_at = CURRENT_TIMESTAMP WHERE id IN ({dup})"
    )
    # 3. One default plan: keep the lowest id.
    op.execute(
        "UPDATE subscription_plans SET is_default = false, lock_version = lock_version + 1 "
        "WHERE is_default AND id <> (SELECT min(id) FROM subscription_plans WHERE is_default)"
    )


def _set_fk_ondelete(ondelete: str) -> None:
    for table, column, referred, name in CONTENT_FKS:
        op.drop_constraint(name, table, type_='foreignkey')
        op.create_foreign_key(name, table, referred, [column], ['id'], ondelete=ondelete)


def upgrade() -> None:
    _cleanup()
    op.create_index('uq_assessment_attempts_user_in_progress', 'assessment_attempts', ['user_id'], unique=True,
                    postgresql_where=sa.text("status = 'in_progress'"),
                    sqlite_where=sa.text("status = 'in_progress'"))
    op.create_index('uq_user_subscriptions_user_current', 'user_subscriptions', ['user_id'], unique=True,
                    postgresql_where=sa.text(CURRENT), sqlite_where=sa.text(CURRENT))
    op.create_index('uq_subscription_plans_single_default', 'subscription_plans', ['is_default'], unique=True,
                    postgresql_where=sa.text('is_default'), sqlite_where=sa.text('is_default = 1'))
    _set_fk_ondelete('RESTRICT')


def downgrade() -> None:
    _set_fk_ondelete('CASCADE')
    op.drop_index('uq_subscription_plans_single_default', table_name='subscription_plans')
    op.drop_index('uq_user_subscriptions_user_current', table_name='user_subscriptions')
    op.drop_index('uq_assessment_attempts_user_in_progress', table_name='assessment_attempts')
