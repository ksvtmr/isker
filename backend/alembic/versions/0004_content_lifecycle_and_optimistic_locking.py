"""Content lifecycle (draft / published / archived), question versioning, optimistic locking.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-13

- competencies, questions, learning_resources, practical_tasks: `status` (+ index). Backfilled from the existing
  booleans: resources/tasks `is_published` → published / draft; questions `is_active` → published / archived (the old
  "deactivate" was a soft delete); competencies → published. The booleans stay and are kept in sync by the models.
- questions: `version` (1) and `previous_id` (FK to the version it replaced, ON DELETE SET NULL).
- `lock_version` (1) on users, competencies, assessments, questions, learning_resources, practical_tasks,
  subscription_plans: optimistic locking for concurrent admin edits.

Nothing is dropped or rewritten except the status backfill above. Downgrade removes the added columns; rows that
were archived/drafted keep their boolean, so no visibility information is lost.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0004'
down_revision: str | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('assessments', sa.Column('lock_version', sa.Integer(), server_default='1', nullable=False))
    op.add_column('competencies', sa.Column('status', sa.Enum('draft', 'published', 'archived', name='content_status', native_enum=False, create_constraint=True, length=32), server_default='published', nullable=False))
    op.add_column('competencies', sa.Column('lock_version', sa.Integer(), server_default='1', nullable=False))
    op.create_index(op.f('ix_competencies_status'), 'competencies', ['status'], unique=False)
    op.add_column('learning_resources', sa.Column('status', sa.Enum('draft', 'published', 'archived', name='content_status', native_enum=False, create_constraint=True, length=32), server_default='published', nullable=False))
    op.add_column('learning_resources', sa.Column('lock_version', sa.Integer(), server_default='1', nullable=False))
    op.create_index(op.f('ix_learning_resources_status'), 'learning_resources', ['status'], unique=False)
    op.add_column('practical_tasks', sa.Column('status', sa.Enum('draft', 'published', 'archived', name='content_status', native_enum=False, create_constraint=True, length=32), server_default='published', nullable=False))
    op.add_column('practical_tasks', sa.Column('lock_version', sa.Integer(), server_default='1', nullable=False))
    op.create_index(op.f('ix_practical_tasks_status'), 'practical_tasks', ['status'], unique=False)
    op.add_column('questions', sa.Column('version', sa.Integer(), server_default='1', nullable=False))
    op.add_column('questions', sa.Column('previous_id', sa.Integer(), nullable=True))
    op.add_column('questions', sa.Column('status', sa.Enum('draft', 'published', 'archived', name='content_status', native_enum=False, create_constraint=True, length=32), server_default='published', nullable=False))
    op.add_column('questions', sa.Column('lock_version', sa.Integer(), server_default='1', nullable=False))
    op.create_index(op.f('ix_questions_previous_id'), 'questions', ['previous_id'], unique=False)
    op.create_index(op.f('ix_questions_status'), 'questions', ['status'], unique=False)
    op.create_foreign_key(op.f('fk_questions_previous_id_questions'), 'questions', 'questions', ['previous_id'], ['id'], ondelete='SET NULL')
    op.add_column('subscription_plans', sa.Column('lock_version', sa.Integer(), server_default='1', nullable=False))
    op.add_column('users', sa.Column('lock_version', sa.Integer(), server_default='1', nullable=False))

    # Backfill status from the legacy booleans.
    op.execute("UPDATE learning_resources SET status = CASE WHEN is_published THEN 'published' ELSE 'draft' END")
    op.execute("UPDATE practical_tasks SET status = CASE WHEN is_published THEN 'published' ELSE 'draft' END")
    op.execute("UPDATE questions SET status = CASE WHEN is_active THEN 'published' ELSE 'archived' END")


def downgrade() -> None:
    op.drop_column('users', 'lock_version')
    op.drop_column('subscription_plans', 'lock_version')
    op.drop_constraint(op.f('fk_questions_previous_id_questions'), 'questions', type_='foreignkey')
    op.drop_index(op.f('ix_questions_status'), table_name='questions')
    op.drop_index(op.f('ix_questions_previous_id'), table_name='questions')
    op.drop_column('questions', 'lock_version')
    op.drop_column('questions', 'status')
    op.drop_column('questions', 'previous_id')
    op.drop_column('questions', 'version')
    op.drop_index(op.f('ix_practical_tasks_status'), table_name='practical_tasks')
    op.drop_column('practical_tasks', 'lock_version')
    op.drop_column('practical_tasks', 'status')
    op.drop_index(op.f('ix_learning_resources_status'), table_name='learning_resources')
    op.drop_column('learning_resources', 'lock_version')
    op.drop_column('learning_resources', 'status')
    op.drop_index(op.f('ix_competencies_status'), table_name='competencies')
    op.drop_column('competencies', 'lock_version')
    op.drop_column('competencies', 'status')
    op.drop_column('assessments', 'lock_version')
