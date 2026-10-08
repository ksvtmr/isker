import { BottomNav, ISKER_NAV, ISKER_NAV_FOOTER, Modal, NavItem, Sidebar, Wordmark, Icon } from "@isker/design-system";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLogout, useMe } from "../api/auth";
import { initials } from "../utils/format";
import { NAV_PATHS, navIdForPath } from "./nav";

/** Desktop: sidebar + content. Tablet: collapsed sidebar. Mobile: top bar + bottom nav + menu sheet. */
export function AppShell() {
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
  const hrefFor = (id: string) => NAV_PATHS[id] ?? "/dashboard";

  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const doLogout = () => logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) });
  const isAdmin = user?.role === "admin";
  const footer = (
    <>
      {isAdmin && <NavItem icon="shield" label="Admin" href="/admin" onClick={() => navigate("/admin")} />}
      <NavItem icon="log-out" label="Sign out" onClick={doLogout} />
    </>
  );

  return (
    <div className="ik-app">
      <a href="#main" className="isk-skip-link">Skip to content</a>
      <div className="ik-side">
        <Sidebar
          active={active}
          onNavigate={go}
          hrefFor={hrefFor}
          footer={footer}
          user={user ? { name: user.full_name, role: isAdmin ? "Administrator" : "Learner", initials: initials(user.full_name) } : undefined}
        />
      </div>
      <header className="ik-mobile-top">
        <Link to="/dashboard" aria-label="Isker home" style={{ textDecoration: "none" }}><Wordmark size={18} /></Link>
        <div className="ik-mobile-actions">
          <Link to="/profile" aria-label="My profile" className="ik-avatar" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>
            {user ? initials(user.full_name) : ""}
          </Link>
          <button type="button" className="ik-icon-btn" aria-label="Open menu" aria-expanded={menu} onClick={() => setMenu(true)}>
            <Icon name="menu" size={20} />
          </button>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="ik-main">
        <div className="ik-content"><Outlet /></div>
      </main>
      <div className="ik-bottom"><BottomNav active={active} onNavigate={go} hrefFor={hrefFor} /></div>
      <Modal open={menu} onClose={() => setMenu(false)} title="Menu">
        <nav aria-label="All sections" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {[...ISKER_NAV, ...ISKER_NAV_FOOTER].map((it) => (
            <NavItem key={it.id} icon={it.icon} label={it.label} active={active === it.id} href={hrefFor(it.id)} onClick={() => go(it.id)} />
          ))}
          {isAdmin && <NavItem icon="shield" label="Admin" href="/admin" onClick={() => { setMenu(false); navigate("/admin"); }} />}
          <NavItem icon="log-out" label="Sign out" onClick={doLogout} />
        </nav>
      </Modal>
    </div>
  );
}
