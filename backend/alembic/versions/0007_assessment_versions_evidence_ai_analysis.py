"""Results record what they were measured with; per-competency evidence; AI development analyses.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-29

Schema (additive, nothing is rewritten or deleted):
- assessment_attempts.assessment_version INTEGER NULL, scoring_version VARCHAR(16) NULL, language VARCHAR(8) NULL.
  Existing attempts get the version of their assessment and scoring "v1" (the only method so far); their language
  stays NULL (unknown).
- competency_scores.evidence JSON NULL, evidence_level VARCHAR(16) NULL. Existing scores keep NULL (shown as
  "not recorded"); their numbers are untouched.
- ai_analyses: one AI development analysis per attempt (status pending | succeeded | failed).

Downgrade drops the table and the columns.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0007'
down_revision: str | None = '0006'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('assessment_attempts', sa.Column('assessment_version', sa.Integer(), nullable=True))
    op.add_column('assessment_attempts', sa.Column('scoring_version', sa.String(length=16), nullable=True))
    op.add_column('assessment_attempts', sa.Column('language', sa.String(length=8), nullable=True))
    op.execute(
        "UPDATE assessment_attempts SET assessment_version = "
        "(SELECT version FROM assessments WHERE assessments.id = assessment_attempts.assessment_id)"
    )
    op.execute("UPDATE assessment_attempts SET scoring_version = 'v1' WHERE status = 'completed'")
    op.add_column('competency_scores', sa.Column('evidence', sa.JSON(), nullable=True))
    op.add_column('competency_scores', sa.Column('evidence_level', sa.String(length=16), nullable=True))
    op.create_table(
        'ai_analyses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('attempt_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('language', sa.String(length=8), nullable=False),
        sa.Column('provider', sa.String(length=32), nullable=True),
        sa.Column('model', sa.String(length=64), nullable=True),
        sa.Column('prompt_version_id', sa.Integer(), nullable=True),
        sa.Column('output', sa.JSON(), nullable=True),
        sa.Column('error_code', sa.String(length=32), nullable=True),
        sa.Column('runs', sa.Integer(), nullable=False),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'succeeded', 'failed')", name=op.f('ck_ai_analyses_status_valid')),
        sa.ForeignKeyConstraint(['attempt_id'], ['assessment_attempts.id'],
                                name=op.f('fk_ai_analyses_attempt_id_assessment_attempts'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['prompt_version_id'], ['ai_prompt_versions.id'],
                                name=op.f('fk_ai_analyses_prompt_version_id_ai_prompt_versions'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_ai_analyses_user_id_users'),
                                ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_analyses')),
        sa.UniqueConstraint('attempt_id', name=op.f('uq_ai_analyses_attempt_id')),
    )
    op.create_index(op.f('ix_ai_analyses_user_id'), 'ai_analyses', ['user_id'], unique=False)
    op.create_index(op.f('ix_ai_analyses_status'), 'ai_analyses', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_ai_analyses_status'), table_name='ai_analyses')
    op.drop_index(op.f('ix_ai_analyses_user_id'), table_name='ai_analyses')
    op.drop_table('ai_analyses')
    op.drop_column('competency_scores', 'evidence_level')
    op.drop_column('competency_scores', 'evidence')
    op.drop_column('assessment_attempts', 'language')
    op.drop_column('assessment_attempts', 'scoring_version')
    op.drop_column('assessment_attempts', 'assessment_version')
