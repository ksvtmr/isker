import { AdminLayout, Icon, Modal, NavItem, Wordmark, type NavEntry } from "@isker/design-system";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { can, roleLabel, useLogout, useMe } from "../api/auth";
import { initials } from "../utils/format";

/** Admin sections, each shown only to users holding its permission (the API enforces the same permissions). */
export const ADMIN_SECTIONS: (NavEntry & { path: string; permission: string })[] = [
  { id: "dashboard", label: "Dashboard", icon: "layout-dashboard", path: "/admin", permission: "admin.access" },
  { id: "users", label: "Users", icon: "users", path: "/admin/users", permission: "users.view" },
  { id: "roles", label: "Roles & permissions", icon: "shield-check", path: "/admin/roles", permission: "roles.view" },
  { id: "subscriptions", label: "Subscriptions", icon: "credit-card", path: "/admin/subscriptions", permission: "subscriptions.view" },
  { id: "plans", label: "Plans", icon: "layers", path: "/admin/plans", permission: "plans.view" },
  { id: "assessments", label: "Assessments", icon: "clipboard-check", path: "/admin/assessments", permission: "content.manage" },
  { id: "competencies", label: "Competencies", icon: "radar", path: "/admin/competencies", permission: "content.manage" },
  { id: "learning-resources", label: "Learning content", icon: "library", path: "/admin/learning-resources", permission: "content.manage" },
  { id: "analytics", label: "Analytics", icon: "chart-column", path: "/admin/analytics", permission: "analytics.view" },
  { id: "ai", label: "AI governance", icon: "bot", path: "/admin/ai", permission: "ai.view" },
  { id: "audit-logs", label: "Audit log", icon: "scroll-text", path: "/admin/audit-logs", permission: "audit.view" },
  { id: "settings", label: "Settings", icon: "settings", path: "/admin/settings", permission: "settings.view" },
];

function activeSection(pathname: string): string {
  const seg = pathname.split("/")[2] ?? "";
  return ADMIN_SECTIONS.find((s) => s.path === `/admin/${seg}`)?.id ?? "dashboard";
}

export function AdminShell() {
  const { data: user } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useLogout();
  const [menu, setMenu] = useState(false);
  const nav = ADMIN_SECTIONS.filter((s) => can(user, s.permission));
  const pathFor = (id: string) => ADMIN_SECTIONS.find((s) => s.id === id)?.path ?? "/admin";
  const go = (id: string) => { setMenu(false); navigate(pathFor(id)); };

  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("admin-main")?.focus({ preventScroll: true });
  }, [location.pathname]);

  const doLogout = () => logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) });
  const footer = (
    <>
      <NavItem icon="arrow-left" label="Back to Isker" href="/dashboard" onClick={() => navigate("/dashboard")} />
      <NavItem icon="log-out" label="Sign out" onClick={doLogout} />
    </>
  );
  return (
    <AdminLayout
      nav={nav}
      active={activeSection(location.pathname)}
      hrefFor={pathFor}
      onNavigate={go}
      footer={footer}
      user={user ? { name: user.full_name, role: roleLabel(user), initials: initials(user.full_name) } : undefined}
      mobileBar={
        <>
          <Link to="/admin" aria-label="Admin dashboard" style={{ textDecoration: "none", display: "flex", gap: 8, alignItems: "center" }}>
            <Wordmark size={18} /><span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-brand-700)" }}>Admin</span>
          </Link>
          <button type="button" className="ik-icon-btn" aria-label="Open admin menu" aria-expanded={menu} onClick={() => setMenu(true)}>
            <Icon name="menu" size={20} />
          </button>
        </>
      }
    >
      <Outlet />
      <Modal open={menu} onClose={() => setMenu(false)} title="Administration">
        <nav aria-label="Admin sections" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {nav.map((it) => <NavItem key={it.id} icon={it.icon} label={it.label} active={activeSection(location.pathname) === it.id} href={it.path} onClick={() => go(it.id)} />)}
          {footer}
        </nav>
      </Modal>
    </AdminLayout>
  );
}
