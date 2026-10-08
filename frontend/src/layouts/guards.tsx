import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useMe } from "../api/auth";
import { ErrorState } from "../components/States";
import { SkeletonCard } from "@isker/design-system";

function FullPageLoading() {
  return (
    <div style={{ maxWidth: 560, margin: "15vh auto 0", padding: 16 }} aria-busy="true">
      <span className="isk-sr-only">Loading…</span>
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
  if (!allowIncompleteOnboarding && !user.onboarding_completed && user.role !== "admin") return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { data: user, isLoading } = useMe();
  if (isLoading) return <FullPageLoading />;
  if (!user) return <Navigate to="/login?next=/admin" replace />;
  if (user.role !== "admin") return <Navigate to="/dashboard" replace />;
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
    return <Navigate to={safe ?? (user.onboarding_completed ? "/dashboard" : "/onboarding")} replace />;
  }
  return <Outlet />;
}
