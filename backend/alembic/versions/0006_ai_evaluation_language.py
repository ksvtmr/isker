"""AI evaluations record the language their texts were generated in.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-17

Schema:
- ai_evaluations.language VARCHAR(8) NULL: "ru" | "kk" | "en". Existing rows stay NULL (unknown): rule-based texts
  are rendered again in the reader's language anyway, and the interface shows no language mark for NULL.

Downgrade drops the column.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0006'
down_revision: str | None = '0005'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('ai_evaluations', sa.Column('language', sa.String(length=8), nullable=True))


def downgrade() -> None:
    op.drop_column('ai_evaluations', 'language')
