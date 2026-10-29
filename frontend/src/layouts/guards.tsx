import { Navigate, Outlet, useLocation } from "react-router-dom";
import { can, hasAdminAccess, useMe } from "../api/auth";
import { lastSignOutReason } from "../api/client";
import { useLiveSync } from "../api/sync";
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

/** Sign-in URL that returns to `next` and, when a session was ended by the server, says why. */
export function loginUrl(next: string): string {
  const reason = lastSignOutReason();
  return `/login?next=${encodeURIComponent(next)}${reason ? `&reason=${reason}` : ""}`;
}

/** Protected routes: requires a session; sends new users to onboarding first. */
export function RequireAuth({ allowIncompleteOnboarding = false }: { allowIncompleteOnboarding?: boolean }) {
  const { data: user, isLoading, error, refetch } = useMe();
  const location = useLocation();
  useLiveSync(!!user);
  if (isLoading) return <FullPageLoading />;
  if (error) return <div style={{ maxWidth: 560, margin: "15vh auto 0", padding: 16 }}><ErrorState error={error} onRetry={() => refetch()} /></div>;
  if (!user) return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
  if (!allowIncompleteOnboarding && !user.onboarding_completed && !hasAdminAccess(user)) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** Where a learner without results should be: their open attempt, or the assessment introduction. */
export function assessmentHome(user: { in_progress_attempt_id: number | null }): string {
  return user.in_progress_attempt_id ? `/assessment/${user.in_progress_attempt_id}` : "/assessment";
}

/**
 * Pages built on assessment results (dashboard, competency profile, plan, learning, practice, progress): a learner
 * who has not completed the initial assessment is sent to it (or back to the attempt they left) instead of seeing
 * empty results. Staff accounts are not held back.
 */
export function RequireInitialAssessment() {
  const { data: user } = useMe();
  if (user && !user.initial_assessment_completed && !hasAdminAccess(user)) return <Navigate to={assessmentHome(user)} replace />;
  return <Outlet />;
}

/** The admin area: any staff role (admin.access). Each admin page additionally checks its own permission. */
export function RequireAdmin() {
  const { data: user, isLoading, error, refetch } = useMe();
  const location = useLocation();
  useLiveSync(!!user);
  if (isLoading) return <FullPageLoading />;
  // A network or server failure is not "signed out": offer a retry instead of sending the admin to sign-in.
  if (error) return <div style={{ maxWidth: 560, margin: "15vh auto 0", padding: 16 }}><ErrorState error={error} onRetry={() => refetch()} /></div>;
  if (!user) return <Navigate to={loginUrl(location.pathname)} replace />;
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
export function homeFor(user: {
  onboarding_completed: boolean;
  permissions: string[];
  initial_assessment_completed?: boolean;
  in_progress_attempt_id?: number | null;
}): string {
  if (user.permissions.includes("admin.access")) return "/admin";
  if (!user.onboarding_completed) return "/onboarding";
  if (user.initial_assessment_completed === false) return assessmentHome({ in_progress_attempt_id: user.in_progress_attempt_id ?? null });
  return "/dashboard";
}
