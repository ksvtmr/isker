import { AdminLayout, Icon, Modal, NavItem, Wordmark, type NavEntry } from "@isker/design-system";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { can, useLogout, useMe } from "../api/auth";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import type { User } from "../types/api";
import { initials } from "../utils/format";

export type AdminSection = Omit<NavEntry, "label"> & { path: string; permission: string; labelKey: string };

/**
 * Admin sections, each shown only to users holding its permission (the API enforces the same permissions).
 * `labelKey` is a translation key; render it with `t(section.labelKey)`.
 */
export const ADMIN_SECTIONS: AdminSection[] = [
  { id: "dashboard", labelKey: "admin:shell.sections.dashboard", icon: "layout-dashboard", path: "/admin", permission: "admin.access" },
  { id: "users", labelKey: "admin:shell.sections.users", icon: "users", path: "/admin/users", permission: "users.view" },
  { id: "roles", labelKey: "admin:shell.sections.roles", icon: "shield-check", path: "/admin/roles", permission: "roles.view" },
  { id: "subscriptions", labelKey: "admin:shell.sections.subscriptions", icon: "credit-card", path: "/admin/subscriptions", permission: "subscriptions.view" },
  { id: "plans", labelKey: "admin:shell.sections.plans", icon: "layers", path: "/admin/plans", permission: "plans.view" },
  { id: "assessments", labelKey: "admin:shell.sections.assessments", icon: "clipboard-check", path: "/admin/assessments", permission: "content.manage" },
  { id: "competencies", labelKey: "admin:shell.sections.competencies", icon: "radar", path: "/admin/competencies", permission: "content.manage" },
  { id: "learning-resources", labelKey: "admin:shell.sections.learningResources", icon: "library", path: "/admin/learning-resources", permission: "content.manage" },
  { id: "analytics", labelKey: "admin:shell.sections.analytics", icon: "chart-column", path: "/admin/analytics", permission: "analytics.view" },
  { id: "ai", labelKey: "admin:shell.sections.ai", icon: "bot", path: "/admin/ai", permission: "ai.view" },
  { id: "audit-logs", labelKey: "admin:shell.sections.auditLogs", icon: "scroll-text", path: "/admin/audit-logs", permission: "audit.view" },
  { id: "settings", labelKey: "admin:shell.sections.settings", icon: "settings", path: "/admin/settings", permission: "settings.view" },
];

const ROLE_ORDER = ["super_admin", "admin", "support", "content_manager"] as const;

/** Highest role of the user, as an API role key (translated with common:roles.*). */
function topRole(user: User): string {
  return ROLE_ORDER.find((r) => (user.roles as string[] | undefined)?.includes(r)) ?? "user";
}

function activeSection(pathname: string): string {
  const seg = pathname.split("/")[2] ?? "";
  return ADMIN_SECTIONS.find((s) => s.path === `/admin/${seg}`)?.id ?? "dashboard";
}

export function AdminShell() {
  const { t } = useTranslation("admin");
  const { data: user } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useLogout();
  const [menu, setMenu] = useState(false);
  const nav: (NavEntry & AdminSection)[] = ADMIN_SECTIONS.filter((s) => can(user, s.permission)).map((s) => ({ ...s, label: t(s.labelKey) }));
  const pathFor = (id: string) => ADMIN_SECTIONS.find((s) => s.id === id)?.path ?? "/admin";
  const go = (id: string) => { setMenu(false); navigate(pathFor(id)); };

  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("admin-main")?.focus({ preventScroll: true });
  }, [location.pathname]);

  const doLogout = () => logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) });
  const footer = (
    <>
      <div style={{ padding: "4px 12px 8px" }}><LanguageSwitcher /></div>
      <NavItem icon="arrow-left" label={t("shell.backToApp")} href="/dashboard" onClick={() => navigate("/dashboard")} />
      <NavItem icon="log-out" label={t("shell.signOut")} onClick={doLogout} />
    </>
  );
  return (
    <AdminLayout
      nav={nav}
      active={activeSection(location.pathname)}
      hrefFor={pathFor}
      onNavigate={go}
      footer={footer}
      user={user ? { name: user.full_name, role: t(`common:roles.${topRole(user)}`), initials: initials(user.full_name) } : undefined}
      mobileBar={
        <>
          <Link to="/admin" aria-label={t("shell.adminDashboard")} style={{ textDecoration: "none", display: "flex", gap: 8, alignItems: "center" }}>
            <Wordmark size={18} /><span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-brand-700)" }}>{t("shell.admin")}</span>
          </Link>
          <button type="button" className="ik-icon-btn" aria-label={t("shell.openMenu")} aria-expanded={menu} onClick={() => setMenu(true)}>
            <Icon name="menu" size={20} />
          </button>
        </>
      }
    >
      <Outlet />
      <Modal open={menu} onClose={() => setMenu(false)} title={t("shell.administration")}>
        <nav aria-label={t("shell.sectionsNav")} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {nav.map((it) => <NavItem key={it.id} icon={it.icon} label={it.label} active={activeSection(location.pathname) === it.id} href={it.path} onClick={() => go(it.id)} />)}
          {footer}
        </nav>
      </Modal>
    </AdminLayout>
  );
}
