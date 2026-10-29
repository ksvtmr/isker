"""Character progression: append-only history of the learner's development stage.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-29

Schema (additive, nothing is rewritten or deleted):
- character_stage_events: one row per confirmed stage change (stage 1–4, previous stage, direction, the scores it
  rests on, rules version, the attempt or practical task that confirmed it, when it was shown to the learner).
  Existing learners get no rows here; their first stage is recorded once, as already shown, when they next open the
  app (services/character.ensure_baseline), so nobody sees a false congratulation.

Downgrade drops the table.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op


revision: str = '0008'
down_revision: str | None = '0007'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('character_stage_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('sequence', sa.Integer(), nullable=False),
    sa.Column('stage', sa.Integer(), nullable=False),
    sa.Column('previous_stage', sa.Integer(), nullable=True),
    sa.Column('direction', sa.String(length=8), nullable=False),
    sa.Column('score', sa.Integer(), nullable=False),
    sa.Column('assessment_score', sa.Integer(), nullable=False),
    sa.Column('practice_score', sa.Integer(), nullable=True),
    sa.Column('practice_tasks', sa.Integer(), nullable=False),
    sa.Column('basis', sa.JSON(), nullable=True),
    sa.Column('rules_version', sa.String(length=16), nullable=False),
    sa.Column('trigger', sa.String(length=16), nullable=False),
    sa.Column('attempt_id', sa.Integer(), nullable=True),
    sa.Column('practice_submission_id', sa.Integer(), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('seen_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("direction IN ('initial', 'up', 'down')", name=op.f('ck_character_stage_events_direction_valid')),
    sa.CheckConstraint('stage >= 1 AND stage <= 4', name=op.f('ck_character_stage_events_stage_range')),
    sa.ForeignKeyConstraint(['attempt_id'], ['assessment_attempts.id'], name=op.f('fk_character_stage_events_attempt_id_assessment_attempts'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['practice_submission_id'], ['practice_submissions.id'], name=op.f('fk_character_stage_events_practice_submission_id_practice_submissions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_character_stage_events_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_character_stage_events')),
    sa.UniqueConstraint('user_id', 'sequence', name=op.f('uq_character_stage_events_user_id'))
    )
    op.create_index(op.f('ix_character_stage_events_confirmed_at'), 'character_stage_events', ['confirmed_at'], unique=False)
    op.create_index(op.f('ix_character_stage_events_user_id'), 'character_stage_events', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_character_stage_events_user_id'), table_name='character_stage_events')
    op.drop_index(op.f('ix_character_stage_events_confirmed_at'), table_name='character_stage_events')
    op.drop_table('character_stage_events')
