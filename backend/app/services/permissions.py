"""Central authorization policy (RBAC).

Every protected backend operation checks a permission key from `PERMISSIONS` via `require_permission` (see
`app/api/deps.py`) or one of the policy functions below. Nothing else in the codebase may compare role names.

Rules
- Deny by default: a user has only the permissions granted through their roles.
- `super_admin` implicitly holds every permission.
- Role ranks: staff may grant/revoke only roles ranked strictly below their own highest rank
  (super_admin may grant super_admin). Nobody may change their own roles.
- Staff may act on another account only if that account's highest rank is below their own
  (super_admin may act on anyone except where the last-super-admin guard applies).
- The last active super_admin cannot be demoted, suspended, deactivated or deleted.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AuthorizationError, ConflictError
from app.models import Permission, Role, RolePermission, User, UserRole
from app.models.enums import AccountStatus

PERMISSIONS: dict[str, str] = {
    "admin.access": "Open the administration area",
    "analytics.view": "View platform analytics and the admin dashboard figures",
    "users.view": "Search and list user accounts",
    "users.view_details": "View a user's profile, assessments, progress and subscription",
    "users.support": "Send password resets and revoke a user's sessions",
    "users.manage": "Edit user profiles, suspend and reactivate accounts",
    "users.delete": "Permanently delete deactivated accounts",
    "roles.view": "View roles and permissions",
    "roles.assign": "Grant or revoke roles of lower rank",
    "roles.manage": "Create roles and change role permissions",
    "plans.view": "View subscription plans",
    "plans.manage": "Create and edit plans, prices and entitlements",
    "subscriptions.view": "View subscriptions and their history",
    "subscriptions.manage": "Assign, extend and cancel subscriptions",
    "content.manage": "Manage competencies, questions, assessments, resources and tasks",
    "ai.view": "View AI evaluations and prompt versions",
    "ai.manage": "Create and activate AI prompt versions",
    "audit.view": "View audit logs and security events",
    "settings.view": "View platform configuration status",
}

# key, name, rank, description, permissions
ROLE_DEFINITIONS: list[tuple[str, str, int, str, list[str]]] = [
    ("user", "Learner", 0, "Default role for registered learners. No administrative access.", []),
    ("content_manager", "Content manager", 10, "Maintains the competency model, questions and learning content.",
     ["admin.access", "content.manage", "ai.view", "plans.view"]),
    ("support", "Support", 10, "Helps learners with their accounts. Cannot change roles, plans or content.",
     ["admin.access", "users.view", "users.view_details", "users.support", "subscriptions.view", "plans.view"]),
    ("admin", "Administrator", 20, "Operates the platform: users, plans, subscriptions, content and analytics.",
     ["admin.access", "analytics.view", "users.view", "users.view_details", "users.support", "users.manage",
      "roles.view", "roles.assign", "plans.view", "plans.manage", "subscriptions.view", "subscriptions.manage",
      "content.manage", "ai.view", "ai.manage", "audit.view", "settings.view"]),
    ("super_admin", "Super administrator", 30, "Full control, including role definitions and account deletion.",
     list(PERMISSIONS)),
]
SUPER_ADMIN = "super_admin"
DEFAULT_ROLE = "user"


# --- Seeding --------------------------------------------------------------------------------------

def ensure_rbac(db: Session) -> None:
    """Create missing permissions and built-in roles (idempotent; never overwrites edited role permissions)."""
    perms = {p.key: p for p in db.scalars(select(Permission))}
    for key, desc in PERMISSIONS.items():
        if key not in perms:
            perms[key] = Permission(key=key, description=desc)
            db.add(perms[key])
    db.flush()
    for key, name, rank, desc, perm_keys in ROLE_DEFINITIONS:
        role = db.scalar(select(Role).where(Role.key == key))
        if role is None:
            role = Role(key=key, name=name, rank=rank, description=desc, is_system=True)
            db.add(role)
            db.flush()
            for pk in perm_keys:
                db.add(RolePermission(role_id=role.id, permission_id=perms[pk].id))
        elif key == SUPER_ADMIN:
            have = {link.permission_id for link in role.permission_links}
            for p in perms.values():
                if p.id not in have:
                    db.add(RolePermission(role_id=role.id, permission_id=p.id))
    db.flush()


def role_by_key(db: Session, key: str) -> Role:
    role = db.scalar(select(Role).where(Role.key == key))
    if role is None:
        raise ConflictError(f"Role '{key}' does not exist. Run the seed.", "ROLE_MISSING")
    return role


def give_role(db: Session, user: User, key: str, granted_by: User | None = None) -> None:
    role = role_by_key(db, key)
    if any(link.role_id == role.id for link in user.role_links):
        return
    user.role_links.append(UserRole(role_id=role.id, role=role, granted_by_id=granted_by.id if granted_by else None))


# --- Queries --------------------------------------------------------------------------------------

def user_permissions(user: User) -> set[str]:
    keys = {link.role.key for link in user.role_links}
    if SUPER_ADMIN in keys:
        return set(PERMISSIONS)
    return {p.permission.key for link in user.role_links for p in link.role.permission_links}


def user_rank(user: User) -> int:
    return max((link.role.rank for link in user.role_links), default=0)


def has_permission(user: User, permission: str) -> bool:
    return permission in user_permissions(user)


def is_super_admin(user: User) -> bool:
    return any(link.role.key == SUPER_ADMIN for link in user.role_links)


def active_super_admin_count(db: Session) -> int:
    return db.scalar(
        select(func.count(func.distinct(UserRole.user_id)))
        .join(Role, Role.id == UserRole.role_id)
        .join(User, User.id == UserRole.user_id)
        .where(Role.key == SUPER_ADMIN, User.status == AccountStatus.ACTIVE)
    ) or 0


# --- Policies (raise on violation) ----------------------------------------------------------------

def assert_can_act_on(actor: User, target: User) -> None:
    """Staff may only act on accounts ranked below them (super_admin may act on anyone but themselves via staff
    tools is still allowed for profile edits; status/role changes on self are blocked separately)."""
    if actor.id == target.id:
        return
    if is_super_admin(actor):
        return
    if user_rank(target) >= user_rank(actor):
        raise AuthorizationError("You can't manage an account with an equal or higher role.", "INSUFFICIENT_RANK")


def assert_not_self(actor: User, target: User, what: str) -> None:
    if actor.id == target.id:
        raise AuthorizationError(f"You can't {what} your own account.", "SELF_ACTION_FORBIDDEN")


def assert_can_assign_role(actor: User, target: User, role: Role) -> None:
    assert_not_self(actor, target, "change the roles of")
    if not has_permission(actor, "roles.assign"):
        raise AuthorizationError("You don't have permission to change roles.")
    assert_can_act_on(actor, target)
    if role.key == SUPER_ADMIN and not is_super_admin(actor):
        raise AuthorizationError("Only a super administrator can grant or revoke super administrator.",
                                 "INSUFFICIENT_RANK")
    if not is_super_admin(actor) and role.rank >= user_rank(actor):
        raise AuthorizationError("You can only grant or revoke roles ranked below your own.", "INSUFFICIENT_RANK")


def assert_keeps_a_super_admin(db: Session, target: User, *, removing_role: Role | None = None,
                               deactivating: bool = False) -> None:
    affects = (removing_role is not None and removing_role.key == SUPER_ADMIN) or deactivating
    if affects and is_super_admin(target) and target.status == AccountStatus.ACTIVE \
            and active_super_admin_count(db) <= 1:
        raise ConflictError("This is the last active super administrator. Assign another super administrator first.",
                            "LAST_SUPER_ADMIN")
