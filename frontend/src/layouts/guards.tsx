import { Navigate, Outlet, useLocation } from "react-router-dom";
import { can, hasAdminAccess, useMe } from "../api/auth";
import { ErrorState } from "../components/States";
import { EmptyState, SkeletonCard } from "@isker/design-system";
import { useTranslation } from "react-i18next";

function FullPageLoading() {
  const { t } = useTranslation();
  return (
    <div style={{ maxWidth: 560, margin: "15vh auto 0", padding: 16 }} aria-busy="true">
      <span className="isk-sr-only">{t("state.loading")}</span>
      <SkeletonCard lines={4} />
    </div>
  );
}

/** Protected routes: requires a session; sends new users to onboarding first. */
export function RequireAuth({ allowIncompleteOnboarding = false }: { allowIncompleteOnboarding?: boolean }) {
  const { data: user, isLoading, error, refetch } = useMe();
  const location = useLocation();
  if (isLoading) return <FullPageLoading />;
  if (error) return <div style={{ maxWidth: 560, margin: "15vh auto 0", padding: 16 }}><ErrorState error={error} onRetry={() => refetch()} /></div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!allowIncompleteOnboarding && !user.onboarding_completed && !hasAdminAccess(user)) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** The admin area: any staff role (admin.access). Each admin page additionally checks its own permission. */
export function RequireAdmin() {
  const { data: user, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <FullPageLoading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (!hasAdminAccess(user)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

/** Inside the admin area: shows an explanation (not a blank page) when a section needs a permission the user lacks. */
export function RequirePermission({ permission }: { permission: string }) {
  const { t } = useTranslation();
  const { data: user } = useMe();
  if (!can(user, permission)) {
    return (
      <EmptyState icon="lock" title={t("state.noAccessTitle")}
        description={t("state.noAccessText")} />
    );
  }
  return <Outlet />;
}

/** Login/register: signed-in users go straight to the app. */
export function RedirectIfAuthed() {
  const { data: user, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <FullPageLoading />;
  if (user) {
    const next = new URLSearchParams(location.search).get("next");
    const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
    return <Navigate to={safe ?? homeFor(user)} replace />;
  }
  return <Outlet />;
}

/** Where a signed-in user lands by default. */
export function homeFor(user: { onboarding_completed: boolean; permissions: string[] }): string {
  if (user.permissions.includes("admin.access")) return "/admin";
  return user.onboarding_completed ? "/dashboard" : "/onboarding";
}
