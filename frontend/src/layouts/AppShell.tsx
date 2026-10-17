import { BottomNav, ISKER_NAV, ISKER_NAV_FOOTER, Modal, NavItem, Sidebar, Wordmark, Icon } from "@isker/design-system";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { hasAdminAccess, useLogout, useMe } from "../api/auth";
import { EmailVerificationBanner } from "../components/AccountNotices";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import type { User } from "../types/api";
import { initials } from "../utils/format";
import { NAV_PATHS, navIdForPath } from "./nav";
import { appHref } from "../utils/appHref";

const ROLE_PRIORITY = ["super_admin", "admin", "support", "content_manager"] as const;

/** The most senior role, used for the role caption under the user's name. */
function primaryRole(user: User): string {
  return ROLE_PRIORITY.find((r) => user.roles.includes(r)) ?? "user";
}

/**
 * Desktop: sidebar + content. Tablet: collapsed sidebar. Mobile: top bar + bottom nav + menu sheet.
 * Used as a route layout (renders the matched child route) or directly with `children` (the public /plans page).
 */
export function AppShell({ children }: { children?: ReactNode } = {}) {
  const { t } = useTranslation("public");
  const { data: user } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useLogout();
  const [menu, setMenu] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const active = navIdForPath(location.pathname);
  const go = (id: string) => {
    setMenu(false);
    navigate(NAV_PATHS[id] ?? "/dashboard");
  };
  const hrefFor = (id: string) => appHref(NAV_PATHS[id] ?? "/dashboard");

  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const doLogout = () => logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) });
  const isAdmin = hasAdminAccess(user);
  const footer = (
    <>
      <div style={{ padding: "4px 12px 8px" }}><LanguageSwitcher /></div>
      <NavItem icon="award" label={t("common:nav.plans")} href={appHref("/plans")} active={active === "plans"} onClick={() => navigate("/plans")} />
      {isAdmin && <NavItem icon="shield" label={t("common:nav.admin")} href={appHref("/admin")} onClick={() => navigate("/admin")} />}
      <NavItem icon="log-out" label={t("common:actions.signOut")} onClick={doLogout} />
    </>
  );

  return (
    <div className="ik-app">
      <a href="#main" className="isk-skip-link">{t("common:ds.skipToContent")}</a>
      <div className="ik-side">
        <Sidebar
          active={active}
          onNavigate={go}
          hrefFor={hrefFor}
          footer={footer}
          user={user ? { name: user.full_name, role: t(`common:roles.${primaryRole(user)}`), initials: initials(user.full_name) } : undefined}
        />
      </div>
      <header className="ik-mobile-top">
        <Link to="/dashboard" aria-label={t("common:app.home")} style={{ textDecoration: "none" }}><Wordmark size={18} /></Link>
        <div className="ik-mobile-actions">
          <LanguageSwitcher />
          <Link to="/profile" aria-label={t("common:nav.myProfile")} className="ik-avatar" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>
            {user ? initials(user.full_name) : ""}
          </Link>
          <button type="button" className="ik-icon-btn" aria-label={t("common:actions.openMenu")} aria-expanded={menu} onClick={() => setMenu(true)}>
            <Icon name="menu" size={20} />
          </button>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="ik-main">
        <div className="ik-content">
          {user && <EmailVerificationBanner user={user} />}
          {children ?? <Outlet />}
        </div>
      </main>
      <div className="ik-bottom"><BottomNav active={active} onNavigate={go} hrefFor={hrefFor} /></div>
      <Modal open={menu} onClose={() => setMenu(false)} title={t("common:actions.menu")}>
        <nav aria-label={t("common:nav.allSections")} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {[...ISKER_NAV, ...ISKER_NAV_FOOTER].map((it) => (
            <NavItem key={it.id} icon={it.icon} label={t(`common:nav.${it.id}`, { defaultValue: it.label })} active={active === it.id} href={hrefFor(it.id)} onClick={() => go(it.id)} />
          ))}
          <NavItem icon="award" label={t("common:nav.plans")} href={appHref("/plans")} active={active === "plans"} onClick={() => { setMenu(false); navigate("/plans"); }} />
          {isAdmin && <NavItem icon="shield" label={t("common:nav.admin")} href={appHref("/admin")} onClick={() => { setMenu(false); navigate("/admin"); }} />}
          <NavItem icon="log-out" label={t("common:actions.signOut")} onClick={doLogout} />
        </nav>
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--color-neutral-200)" }}>
          <LanguageSwitcher compact={false} />
        </div>
      </Modal>
    </div>
  );
}
