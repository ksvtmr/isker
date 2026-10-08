import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { setUnauthorizedHandler } from "./api/client";
import { keys } from "./api/keys";
import { AppShell } from "./layouts/AppShell";
import { FocusLayout } from "./layouts/FocusLayout";
import { RedirectIfAuthed, RequireAdmin, RequireAuth } from "./layouts/guards";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminAI } from "./pages/admin/AdminAI";
import { AdminAssessments } from "./pages/admin/AdminAssessments";
import { AdminCompetencies } from "./pages/admin/AdminCompetencies";
import { AdminOverview } from "./pages/admin/AdminOverview";
import { AdminQuestions } from "./pages/admin/AdminQuestions";
import { AdminResources } from "./pages/admin/AdminResources";
import { AdminUsers } from "./pages/admin/AdminUsers";
import { AssessmentIntro } from "./pages/AssessmentIntro";
import { AssessmentRunner } from "./pages/AssessmentRunner";
import { CompetencyDetailPage } from "./pages/CompetencyDetail";
import { CompetenciesPage } from "./pages/Competencies";
import { DashboardPage } from "./pages/Dashboard";
import { DevelopmentPlanPage } from "./pages/DevelopmentPlan";
import { Landing } from "./pages/Landing";
import { LearningPage } from "./pages/Learning";
import { LearningDetailPage } from "./pages/LearningDetail";
import { LoginPage } from "./pages/Login";
import { NotFound } from "./pages/NotFound";
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
  useEffect(() => {
    // An expired/revoked session anywhere in the app returns the user to sign-in.
    setUnauthorizedHandler(() => {
      qc.setQueryData(keys.me, null);
      navigate(`/login?next=${encodeURIComponent(window.location.pathname)}`, { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [qc, navigate]);

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<RedirectIfAuthed />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
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
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/assessment" element={<AssessmentIntro />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/competencies" element={<CompetenciesPage />} />
          <Route path="/competencies/:id" element={<CompetencyDetailPage />} />
          <Route path="/development-plan" element={<DevelopmentPlanPage />} />
          <Route path="/learning" element={<LearningPage />} />
          <Route path="/learning/:id" element={<LearningDetailPage />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/practice/:id" element={<PracticeDetailPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route element={<RequireAdmin />}>
        <Route element={<AppShell />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminOverview />} />
            <Route path="competencies" element={<AdminCompetencies />} />
            <Route path="questions" element={<AdminQuestions />} />
            <Route path="assessments" element={<AdminAssessments />} />
            <Route path="resources" element={<AdminResources />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="ai" element={<AdminAI />} />
          </Route>
        </Route>
      </Route>

      <Route path="/home" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
