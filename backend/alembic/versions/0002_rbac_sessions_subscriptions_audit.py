"""RBAC, server-side sessions, email/password tokens, plans & subscriptions, richer append-only audit log.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-12

Data migration (no user data is lost)
- users.role → user_roles: every user gets `user`; former `admin` accounts also get `super_admin`.
- users.is_active → users.status: true → active, false → deactivated.
- audit_logs.user_id/entity_type/entity_id → actor_id/target_type/target_id (values copied). The FK to users is
  dropped on purpose so audit rows survive account deletion (only the numeric id is kept).

Destructive steps and justification
- users.role and users.is_active are dropped only after their values are copied (see above).
- revoked_tokens is dropped: it only held ids of logged-out JWTs that expire within JWT_EXPIRES_MINUTES. Sessions are
  now server-side (user_sessions), and tokens issued before this migration have no session and are rejected, so
  everyone simply signs in again. No user data is involved.

Backup strategy: take `pg_dump -Fc` before upgrading (see docs/database.md). `alembic downgrade 0001` restores the
previous columns with values mapped back (super_admin → admin; status != active → is_active false).

PostgreSQL only: a trigger makes audit_logs append-only (UPDATE/DELETE/TRUNCATE raise an error).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('payment_webhook_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('provider', sa.String(length=32), nullable=False),
    sa.Column('event_id', sa.String(length=128), nullable=False),
    sa.Column('event_type', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('error', sa.String(length=500), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_payment_webhook_events')),
    sa.UniqueConstraint('provider', 'event_id', name=op.f('uq_payment_webhook_events_provider'))
    )
    op.create_table('permissions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('description', sa.String(length=255), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_permissions')),
    sa.UniqueConstraint('key', name=op.f('uq_permissions_key'))
    )
    op.create_table('roles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('key', sa.String(length=48), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('rank', sa.Integer(), nullable=False),
    sa.Column('is_system', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_roles')),
    sa.UniqueConstraint('key', name=op.f('uq_roles_key'))
    )
    op.create_table('subscription_plans',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('key', sa.String(length=48), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('price_cents', sa.Integer(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('billing_interval', sa.Enum('none', 'month', 'year', name='billing_interval', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('trial_days', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('price_cents >= 0', name=op.f('ck_subscription_plans_price_non_negative')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_subscription_plans')),
    sa.UniqueConstraint('key', name=op.f('uq_subscription_plans_key'))
    )
    op.create_table('email_verification_tokens',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_email_verification_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_email_verification_tokens')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_email_verification_tokens_token_hash'))
    )
    op.create_index(op.f('ix_email_verification_tokens_user_id'), 'email_verification_tokens', ['user_id'], unique=False)
    op.create_table('password_reset_tokens',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('requested_by_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_password_reset_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_password_reset_tokens')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_password_reset_tokens_token_hash'))
    )
    op.create_index(op.f('ix_password_reset_tokens_user_id'), 'password_reset_tokens', ['user_id'], unique=False)
    op.create_table('plan_entitlements',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('plan_id', sa.Integer(), nullable=False),
    sa.Column('feature_key', sa.String(length=64), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('limit_value', sa.Integer(), nullable=True),
    sa.CheckConstraint('limit_value IS NULL OR limit_value >= 0', name=op.f('ck_plan_entitlements_limit_non_negative')),
    sa.ForeignKeyConstraint(['plan_id'], ['subscription_plans.id'], name=op.f('fk_plan_entitlements_plan_id_subscription_plans'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_plan_entitlements')),
    sa.UniqueConstraint('plan_id', 'feature_key', name=op.f('uq_plan_entitlements_plan_id'))
    )
    op.create_index(op.f('ix_plan_entitlements_plan_id'), 'plan_entitlements', ['plan_id'], unique=False)
    op.create_table('role_permissions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('role_id', sa.Integer(), nullable=False),
    sa.Column('permission_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], name=op.f('fk_role_permissions_permission_id_permissions'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], name=op.f('fk_role_permissions_role_id_roles'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_role_permissions')),
    sa.UniqueConstraint('role_id', 'permission_id', name=op.f('uq_role_permissions_role_id'))
    )
    op.create_index(op.f('ix_role_permissions_permission_id'), 'role_permissions', ['permission_id'], unique=False)
    op.create_index(op.f('ix_role_permissions_role_id'), 'role_permissions', ['role_id'], unique=False)
    op.create_table('user_roles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('role_id', sa.Integer(), nullable=False),
    sa.Column('granted_by_id', sa.Integer(), nullable=True),
    sa.Column('granted_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['granted_by_id'], ['users.id'], name=op.f('fk_user_roles_granted_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], name=op.f('fk_user_roles_role_id_roles'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_roles_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_roles')),
    sa.UniqueConstraint('user_id', 'role_id', name=op.f('uq_user_roles_user_id'))
    )
    op.create_index(op.f('ix_user_roles_role_id'), 'user_roles', ['role_id'], unique=False)
    op.create_index(op.f('ix_user_roles_user_id'), 'user_roles', ['user_id'], unique=False)
    op.create_table('user_sessions',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_reason', sa.String(length=64), nullable=True),
    sa.Column('user_agent', sa.String(length=255), nullable=True),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_sessions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_sessions'))
    )
    op.create_index(op.f('ix_user_sessions_expires_at'), 'user_sessions', ['expires_at'], unique=False)
    op.create_index(op.f('ix_user_sessions_user_id'), 'user_sessions', ['user_id'], unique=False)
    op.create_table('user_subscriptions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('plan_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.Enum('trialing', 'active', 'past_due', 'canceled', 'expired', 'incomplete', name='subscription_status', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('source', sa.Enum('system', 'admin', 'payment', 'trial', name='subscription_source', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancel_at_period_end', sa.Boolean(), nullable=False),
    sa.Column('canceled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('provider', sa.String(length=32), nullable=True),
    sa.Column('provider_reference', sa.String(length=128), nullable=True),
    sa.Column('note', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_user_subscriptions_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['plan_id'], ['subscription_plans.id'], name=op.f('fk_user_subscriptions_plan_id_subscription_plans'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_subscriptions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_subscriptions'))
    )
    op.create_index(op.f('ix_user_subscriptions_expires_at'), 'user_subscriptions', ['expires_at'], unique=False)
    op.create_index(op.f('ix_user_subscriptions_plan_id'), 'user_subscriptions', ['plan_id'], unique=False)
    op.create_index(op.f('ix_user_subscriptions_provider_reference'), 'user_subscriptions', ['provider_reference'], unique=False)
    op.create_index(op.f('ix_user_subscriptions_status'), 'user_subscriptions', ['status'], unique=False)
    op.create_index(op.f('ix_user_subscriptions_user_id'), 'user_subscriptions', ['user_id'], unique=False)
    op.create_table('subscription_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('subscription_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('event_type', sa.String(length=48), nullable=False),
    sa.Column('from_status', sa.String(length=32), nullable=True),
    sa.Column('to_status', sa.String(length=32), nullable=True),
    sa.Column('plan_id', sa.Integer(), nullable=True),
    sa.Column('actor_id', sa.Integer(), nullable=True),
    sa.Column('source', sa.String(length=32), nullable=False),
    sa.Column('reason', sa.String(length=500), nullable=True),
    sa.Column('details', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['plan_id'], ['subscription_plans.id'], name=op.f('fk_subscription_events_plan_id_subscription_plans'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['subscription_id'], ['user_subscriptions.id'], name=op.f('fk_subscription_events_subscription_id_user_subscriptions'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_subscription_events_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_subscription_events'))
    )
    op.create_index(op.f('ix_subscription_events_created_at'), 'subscription_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_subscription_events_subscription_id'), 'subscription_events', ['subscription_id'], unique=False)
    op.create_index(op.f('ix_subscription_events_user_id'), 'subscription_events', ['user_id'], unique=False)
    op.drop_index(op.f('ix_revoked_tokens_expires_at'), table_name='revoked_tokens')
    op.drop_table('revoked_tokens')

    # --- Roles: seed the two roles needed to map existing accounts (the app seed adds the rest + permissions).
    op.execute("""INSERT INTO roles (key, name, description, rank, is_system, created_at) VALUES
        ('user', 'Learner', 'Default role for registered learners. No administrative access.', 0, true, now()),
        ('super_admin', 'Super administrator', 'Full control, including role definitions and account deletion.',
         30, true, now())""")
    op.execute("""INSERT INTO user_roles (user_id, role_id, granted_at)
        SELECT u.id, r.id, now() FROM users u JOIN roles r ON r.key = 'user'""")
    op.execute("""INSERT INTO user_roles (user_id, role_id, granted_at)
        SELECT u.id, r.id, now() FROM users u JOIN roles r ON r.key = 'super_admin' WHERE u.role = 'admin'""")

    # --- Audit log: new columns, copy values, then drop the old ones.
    op.add_column('audit_logs', sa.Column('actor_id', sa.Integer(), nullable=True))
    op.add_column('audit_logs', sa.Column('target_type', sa.String(length=64), nullable=True))
    op.add_column('audit_logs', sa.Column('target_id', sa.Integer(), nullable=True))
    op.add_column('audit_logs', sa.Column('outcome', sa.String(length=16), nullable=False,
                                          server_default='success'))
    op.add_column('audit_logs', sa.Column('reason', sa.String(length=500), nullable=True))
    op.add_column('audit_logs', sa.Column('request_id', sa.String(length=64), nullable=True))
    op.add_column('audit_logs', sa.Column('ip_address', sa.String(length=64), nullable=True))
    op.execute("UPDATE audit_logs SET actor_id = user_id, target_type = entity_type, target_id = entity_id")
    op.alter_column('audit_logs', 'outcome', server_default=None)
    op.drop_index(op.f('ix_audit_logs_user_id'), table_name='audit_logs')
    op.create_index(op.f('ix_audit_logs_actor_id'), 'audit_logs', ['actor_id'], unique=False)
    op.create_index(op.f('ix_audit_logs_outcome'), 'audit_logs', ['outcome'], unique=False)
    op.create_index(op.f('ix_audit_logs_target_id'), 'audit_logs', ['target_id'], unique=False)
    op.drop_constraint(op.f('fk_audit_logs_user_id_users'), 'audit_logs', type_='foreignkey')
    op.drop_column('audit_logs', 'entity_id')
    op.drop_column('audit_logs', 'entity_type')
    op.drop_column('audit_logs', 'user_id')

    # --- Users: status replaces is_active; lifecycle columns.
    op.add_column('users', sa.Column('status', sa.Enum('active', 'suspended', 'deactivated', name='account_status', native_enum=False, create_constraint=True, length=32), nullable=False, server_default='active'))
    op.execute("UPDATE users SET status = 'deactivated' WHERE is_active = false")
    op.alter_column('users', 'status', server_default=None)
    op.add_column('users', sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('terms_accepted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('terms_version', sa.String(length=16), nullable=True))
    op.add_column('users', sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('status_changed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('status_reason', sa.String(length=500), nullable=True))
    op.add_column('users', sa.Column('deletion_requested_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f('ix_users_last_seen_at'), 'users', ['last_seen_at'], unique=False)
    op.create_index(op.f('ix_users_status'), 'users', ['status'], unique=False)
    op.drop_column('users', 'is_active')
    op.drop_column('users', 'role')

    if op.get_bind().dialect.name == 'postgresql':
        op.execute("""CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
            BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql""")
        op.execute("""CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()""")
        op.execute("""CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
            FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only()""")


def downgrade() -> None:
    if op.get_bind().dialect.name == 'postgresql':
        op.execute("DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs")
        op.execute("DROP TRIGGER IF EXISTS audit_logs_no_update_delete ON audit_logs")
        op.execute("DROP FUNCTION IF EXISTS audit_logs_append_only()")
    op.add_column('users', sa.Column('role', sa.Enum('user', 'admin', name='user_role', native_enum=False, create_constraint=True, length=32), nullable=False, server_default='user'))
    op.add_column('users', sa.Column('is_active', sa.BOOLEAN(), nullable=False, server_default=sa.true()))
    op.execute("""UPDATE users SET role = 'admin' WHERE id IN (SELECT ur.user_id FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id WHERE r.key IN ('super_admin', 'admin'))""")
    op.execute("UPDATE users SET is_active = (status = 'active')")
    op.alter_column('users', 'role', server_default=None)
    op.alter_column('users', 'is_active', server_default=None)
    op.drop_index(op.f('ix_users_status'), table_name='users')
    op.drop_index(op.f('ix_users_last_seen_at'), table_name='users')
    op.drop_column('users', 'deletion_requested_at')
    op.drop_column('users', 'status_reason')
    op.drop_column('users', 'status_changed_at')
    op.drop_column('users', 'last_seen_at')
    op.drop_column('users', 'terms_version')
    op.drop_column('users', 'terms_accepted_at')
    op.drop_column('users', 'email_verified_at')
    op.drop_column('users', 'status')
    op.add_column('audit_logs', sa.Column('user_id', sa.INTEGER(), autoincrement=False, nullable=True))
    op.add_column('audit_logs', sa.Column('entity_type', sa.VARCHAR(length=64), autoincrement=False, nullable=True))
    op.add_column('audit_logs', sa.Column('entity_id', sa.INTEGER(), autoincrement=False, nullable=True))
    op.execute("""UPDATE audit_logs SET user_id = CASE WHEN actor_id IN (SELECT id FROM users) THEN actor_id END,
        entity_type = target_type, entity_id = target_id""")
    op.create_foreign_key(op.f('fk_audit_logs_user_id_users'), 'audit_logs', 'users', ['user_id'], ['id'], ondelete='SET NULL')
    op.drop_index(op.f('ix_audit_logs_target_id'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_outcome'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_actor_id'), table_name='audit_logs')
    op.create_index(op.f('ix_audit_logs_user_id'), 'audit_logs', ['user_id'], unique=False)
    op.drop_column('audit_logs', 'ip_address')
    op.drop_column('audit_logs', 'request_id')
    op.drop_column('audit_logs', 'reason')
    op.drop_column('audit_logs', 'outcome')
    op.drop_column('audit_logs', 'target_id')
    op.drop_column('audit_logs', 'target_type')
    op.drop_column('audit_logs', 'actor_id')
    op.create_table('revoked_tokens',
    sa.Column('jti', sa.VARCHAR(length=64), autoincrement=False, nullable=False),
    sa.Column('expires_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False),
    sa.PrimaryKeyConstraint('jti', name=op.f('pk_revoked_tokens'))
    )
    op.create_index(op.f('ix_revoked_tokens_expires_at'), 'revoked_tokens', ['expires_at'], unique=False)
    op.drop_index(op.f('ix_subscription_events_user_id'), table_name='subscription_events')
    op.drop_index(op.f('ix_subscription_events_subscription_id'), table_name='subscription_events')
    op.drop_index(op.f('ix_subscription_events_created_at'), table_name='subscription_events')
    op.drop_table('subscription_events')
    op.drop_index(op.f('ix_user_subscriptions_user_id'), table_name='user_subscriptions')
    op.drop_index(op.f('ix_user_subscriptions_status'), table_name='user_subscriptions')
    op.drop_index(op.f('ix_user_subscriptions_provider_reference'), table_name='user_subscriptions')
    op.drop_index(op.f('ix_user_subscriptions_plan_id'), table_name='user_subscriptions')
    op.drop_index(op.f('ix_user_subscriptions_expires_at'), table_name='user_subscriptions')
    op.drop_table('user_subscriptions')
    op.drop_index(op.f('ix_user_sessions_user_id'), table_name='user_sessions')
    op.drop_index(op.f('ix_user_sessions_expires_at'), table_name='user_sessions')
    op.drop_table('user_sessions')
    op.drop_index(op.f('ix_user_roles_user_id'), table_name='user_roles')
    op.drop_index(op.f('ix_user_roles_role_id'), table_name='user_roles')
    op.drop_table('user_roles')
    op.drop_index(op.f('ix_role_permissions_role_id'), table_name='role_permissions')
    op.drop_index(op.f('ix_role_permissions_permission_id'), table_name='role_permissions')
    op.drop_table('role_permissions')
    op.drop_index(op.f('ix_plan_entitlements_plan_id'), table_name='plan_entitlements')
    op.drop_table('plan_entitlements')
    op.drop_index(op.f('ix_password_reset_tokens_user_id'), table_name='password_reset_tokens')
    op.drop_table('password_reset_tokens')
    op.drop_index(op.f('ix_email_verification_tokens_user_id'), table_name='email_verification_tokens')
    op.drop_table('email_verification_tokens')
    op.drop_table('subscription_plans')
    op.drop_table('roles')
    op.drop_table('permissions')
    op.drop_table('payment_webhook_events')
