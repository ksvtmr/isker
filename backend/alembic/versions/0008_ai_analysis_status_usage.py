"""AI analysis lifecycle pending → processing → completed | failed; token usage and input digest.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-29

Schema (additive; existing rows are kept and relabelled, nothing is deleted):
- ai_analyses.status: 'succeeded' becomes 'completed', 'pending' (a run in progress) becomes 'processing'; the check
  constraint allows pending | processing | completed | failed ('pending' now means queued, not started).
- ai_analyses.prompt_tokens INTEGER NULL, completion_tokens INTEGER NULL, input_digest VARCHAR(64) NULL. Existing rows
  keep NULL (usage unknown; a regeneration of an old analysis always runs).

Downgrade maps the statuses back (pending and processing → pending, completed → succeeded) and drops the columns.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0008'
down_revision: str | None = '0007'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW = "status IN ('pending', 'processing', 'completed', 'failed')"
OLD = "status IN ('pending', 'succeeded', 'failed')"


def upgrade() -> None:
    with op.batch_alter_table('ai_analyses') as batch:
        batch.drop_constraint(op.f('ck_ai_analyses_status_valid'), type_='check')
        batch.add_column(sa.Column('prompt_tokens', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('completion_tokens', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('input_digest', sa.String(length=64), nullable=True))
    op.execute("UPDATE ai_analyses SET status = 'processing' WHERE status = 'pending'")
    op.execute("UPDATE ai_analyses SET status = 'completed' WHERE status = 'succeeded'")
    with op.batch_alter_table('ai_analyses') as batch:
        batch.create_check_constraint(op.f('ck_ai_analyses_status_valid'), NEW)


def downgrade() -> None:
    with op.batch_alter_table('ai_analyses') as batch:
        batch.drop_constraint(op.f('ck_ai_analyses_status_valid'), type_='check')
    op.execute("UPDATE ai_analyses SET status = 'pending' WHERE status IN ('pending', 'processing')")
    op.execute("UPDATE ai_analyses SET status = 'succeeded' WHERE status = 'completed'")
    with op.batch_alter_table('ai_analyses') as batch:
        batch.create_check_constraint(op.f('ck_ai_analyses_status_valid'), OLD)
        batch.drop_column('input_digest')
        batch.drop_column('completion_tokens')
        batch.drop_column('prompt_tokens')
