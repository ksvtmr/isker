import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { SIGN_OUT_CODES, setUnauthorizedHandler } from "./api/client";
import { keys } from "./api/keys";
import { useMe } from "./api/auth";
import { useLanguageSync } from "./i18n/useLanguage";
import { AppShell } from "./layouts/AppShell";
import { FocusLayout } from "./layouts/FocusLayout";
import { AdminShell } from "./layouts/AdminShell";
import { RedirectIfAuthed, RequireAdmin, RequireAuth, RequireInitialAssessment, RequirePermission } from "./layouts/guards";
import { AdminAnalytics } from "./pages/admin/AdminAnalytics";
import { AdminAuditLogs } from "./pages/admin/AdminAuditLogs";
import { AdminAIPage, AdminAssessmentsPage, AdminCompetenciesPage, AdminLearningPage } from "./pages/admin/AdminContent";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { AdminPlans } from "./pages/admin/AdminPlans";
import { AdminRoles } from "./pages/admin/AdminRoles";
import { AdminSettings } from "./pages/admin/AdminSettings";
import { AdminSubscriptions } from "./pages/admin/AdminSubscriptions";
import { AdminTranslations } from "./pages/admin/AdminTranslations";
import { AdminUserDetailPage } from "./pages/admin/AdminUserDetail";
import { AdminUsersList } from "./pages/admin/AdminUsersList";
import { AssessmentIntro } from "./pages/AssessmentIntro";
import { AssessmentRunner } from "./pages/AssessmentRunner";
import { CompetencyDetailPage } from "./pages/CompetencyDetail";
import { CompetenciesPage } from "./pages/Competencies";
import { DashboardPage } from "./pages/Dashboard";
import { DevelopmentPlanPage } from "./pages/DevelopmentPlan";
import { ForgotPasswordPage } from "./pages/ForgotPassword";
import { PrivacyPage, TermsPage } from "./pages/Legal";
import { PlansRoute } from "./pages/Plans";
import { ResetPasswordPage } from "./pages/ResetPassword";
import { VerifyEmailPage } from "./pages/VerifyEmail";
import { Landing } from "./pages/Landing";
import { LearningPage } from "./pages/Learning";
import { LearningDetailPage } from "./pages/LearningDetail";
import { LoginPage } from "./pages/Login";
import { NotFound, NotFoundInline } from "./pages/NotFound";
import { OnboardingPage } from "./pages/Onboarding";
import { PracticePage } from "./pages/Practice";
import { PracticeDetailPage } from "./pages/PracticeDetail";
import { ProfilePage } from "./pages/Profile";
import { ProgressPage } from "./pages/Progress";
import { RegisterPage } from "./pages/Register";
import { ResultsPage } from "./pages/Results";
import { SettingsPage } from "./pages/Settings";

export function App() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  // The signed-in user's saved language applies everywhere (app, admin area, assessment and onboarding).
  const { data: me } = useMe();
  useLanguageSync(me);
  const here = useRef(location.pathname);
  here.current = location.pathname;
  useEffect(() => {
    // An expired, revoked or blocked session anywhere in the app returns the user to sign-in with the reason.
    setUnauthorizedHandler((err, path) => {
      const wasSignedIn = !!qc.getQueryData(keys.me);
      if (path === "/api/auth/me" && !wasSignedIn) return; // anonymous visitor: nothing to end
      // Drop every cached private response (another person may sign in next), keep the signed-out state.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      qc.setQueryData(keys.me, null);
      const reason = SIGN_OUT_CODES.has(err.code) ? `&reason=${err.code}` : "";
      const next = here.current.startsWith("/login") ? "/" : here.current;
      navigate(`/login?next=${encodeURIComponent(next)}${reason}`, { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [qc, navigate]);

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {/* Public: anonymous visitors see the plans with a sign-up call to action, signed-in users their current plan. */}
      <Route path="/plans" element={<PlansRoute />} />
      <Route element={<RedirectIfAuthed />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      <Route element={<RequireAuth allowIncompleteOnboarding />}>
        <Route element={<FocusLayout />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
        </Route>
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<FocusLayout />}>
          <Route path="/assessment/:id" element={<AssessmentRunner />} />
        </Route>
        <Route element={<AppShell />}>
          <Route path="/assessment" element={<AssessmentIntro />} />
          {/* Built on results: learners go through the initial assessment first. */}
          <Route element={<RequireInitialAssessment />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/competencies" element={<CompetenciesPage />} />
            <Route path="/competencies/:id" element={<CompetencyDetailPage />} />
            <Route path="/development-plan" element={<DevelopmentPlanPage />} />
            <Route path="/learning" element={<LearningPage />} />
            <Route path="/learning/:id" element={<LearningDetailPage />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/practice/:id" element={<PracticeDetailPage />} />
            <Route path="/progress" element={<ProgressPage />} />
          </Route>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route element={<RequireAdmin />}>
        <Route element={<AdminShell />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route element={<RequirePermission permission="users.view" />}>
            <Route path="/admin/users" element={<AdminUsersList />} />
          </Route>
          <Route element={<RequirePermission permission="users.view_details" />}>
            <Route path="/admin/users/:id" element={<AdminUserDetailPage />} />
          </Route>
          <Route element={<RequirePermission permission="roles.view" />}>
            <Route path="/admin/roles" element={<AdminRoles />} />
          </Route>
          <Route element={<RequirePermission permission="subscriptions.view" />}>
            <Route path="/admin/subscriptions" element={<AdminSubscriptions />} />
          </Route>
          <Route element={<RequirePermission permission="plans.view" />}>
            <Route path="/admin/plans" element={<AdminPlans />} />
          </Route>
          <Route element={<RequirePermission permission="content.manage" />}>
            <Route path="/admin/assessments" element={<AdminAssessmentsPage />} />
            <Route path="/admin/competencies" element={<AdminCompetenciesPage />} />
            <Route path="/admin/learning-resources" element={<AdminLearningPage />} />
            <Route path="/admin/translations" element={<AdminTranslations />} />
            <Route path="/admin/questions" element={<Navigate to="/admin/assessments?tab=questions" replace />} />
            <Route path="/admin/resources" element={<Navigate to="/admin/learning-resources" replace />} />
          </Route>
          <Route element={<RequirePermission permission="analytics.view" />}>
            <Route path="/admin/analytics" element={<AdminAnalytics />} />
          </Route>
          <Route element={<RequirePermission permission="ai.view" />}>
            <Route path="/admin/ai" element={<AdminAIPage />} />
          </Route>
          <Route element={<RequirePermission permission="audit.view" />}>
            <Route path="/admin/audit-logs" element={<AdminAuditLogs />} />
          </Route>
          <Route element={<RequirePermission permission="settings.view" />}>
            <Route path="/admin/settings" element={<AdminSettings />} />
          </Route>
          <Route path="/admin/*" element={<NotFoundInline />} />
        </Route>
      </Route>

      <Route path="/home" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
