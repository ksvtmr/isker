"""Localization, Google sign-in and "Remember me" sessions.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-12

- oauth_identities: external sign-in identities (provider + stable subject), linked to one user each.
- oauth_states: single-use OAuth requests (hashed state, nonce, PKCE verifier), expire after 10 minutes.
- user_sessions: remember (persistent cookie), token_version + rotated_at (token rotation and reuse detection),
  auth_method (password | google).
- translations JSON on content tables (English stays the base text in the existing columns).
- user_profiles.language becomes nullable: NULL means "not chosen yet" so the interface language detected in the
  browser is used and then saved. Existing rows held the old default 'en' that nobody chose, so they become NULL.

Nothing is dropped. Downgrade removes the new tables/columns and fills language back with 'en'.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('oauth_identities',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('provider', sa.String(length=32), nullable=False),
    sa.Column('subject', sa.String(length=255), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_oauth_identities_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_oauth_identities')),
    sa.UniqueConstraint('provider', 'subject', name=op.f('uq_oauth_identities_provider')),
    sa.UniqueConstraint('user_id', 'provider', name=op.f('uq_oauth_identities_user_id'))
    )
    op.create_index(op.f('ix_oauth_identities_user_id'), 'oauth_identities', ['user_id'], unique=False)
    op.create_table('oauth_states',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('state_hash', sa.String(length=64), nullable=False),
    sa.Column('nonce', sa.String(length=128), nullable=False),
    sa.Column('code_verifier', sa.String(length=128), nullable=False),
    sa.Column('mode', sa.String(length=16), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('next_path', sa.String(length=255), nullable=True),
    sa.Column('remember', sa.Boolean(), nullable=False),
    sa.Column('language', sa.String(length=8), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_oauth_states_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_oauth_states')),
    sa.UniqueConstraint('state_hash', name=op.f('uq_oauth_states_state_hash'))
    )
    op.create_index(op.f('ix_oauth_states_expires_at'), 'oauth_states', ['expires_at'], unique=False)
    op.add_column('assessments', sa.Column('translations', sa.JSON(), nullable=True))
    op.add_column('competencies', sa.Column('translations', sa.JSON(), nullable=True))
    op.add_column('competency_areas', sa.Column('translations', sa.JSON(), nullable=True))
    op.add_column('competency_levels', sa.Column('translations', sa.JSON(), nullable=True))
    op.add_column('goal_definitions', sa.Column('translations', sa.JSON(), nullable=True))
    op.add_column('learning_resources', sa.Column('translations', sa.JSON(), nullable=True))
    op.add_column('practical_tasks', sa.Column('translations', sa.JSON(), nullable=True))
    op.add_column('question_options', sa.Column('translations', sa.JSON(), nullable=True))
    op.add_column('questions', sa.Column('translations', sa.JSON(), nullable=True))
    op.add_column('subscription_plans', sa.Column('translations', sa.JSON(), nullable=True))
    op.alter_column('user_profiles', 'language',
               existing_type=sa.VARCHAR(length=8),
               nullable=True,
               existing_server_default=None)
    op.execute("UPDATE user_profiles SET language = NULL WHERE language = 'en'")
    op.add_column('user_sessions', sa.Column('remember', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('user_sessions', sa.Column('token_version', sa.Integer(), server_default='0', nullable=False))
    op.add_column('user_sessions', sa.Column('rotated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('user_sessions', sa.Column('auth_method', sa.String(length=16), server_default='password', nullable=False))


def downgrade() -> None:
    op.drop_column('user_sessions', 'auth_method')
    op.drop_column('user_sessions', 'rotated_at')
    op.drop_column('user_sessions', 'token_version')
    op.drop_column('user_sessions', 'remember')
    op.execute("UPDATE user_profiles SET language = 'en' WHERE language IS NULL")
    op.alter_column('user_profiles', 'language',
               existing_type=sa.VARCHAR(length=8),
               nullable=False)
    op.drop_column('subscription_plans', 'translations')
    op.drop_column('questions', 'translations')
    op.drop_column('question_options', 'translations')
    op.drop_column('practical_tasks', 'translations')
    op.drop_column('learning_resources', 'translations')
    op.drop_column('goal_definitions', 'translations')
    op.drop_column('competency_levels', 'translations')
    op.drop_column('competency_areas', 'translations')
    op.drop_column('competencies', 'translations')
    op.drop_column('assessments', 'translations')
    op.drop_index(op.f('ix_oauth_states_expires_at'), table_name='oauth_states')
    op.drop_table('oauth_states')
    op.drop_index(op.f('ix_oauth_identities_user_id'), table_name='oauth_identities')
    op.drop_table('oauth_identities')
