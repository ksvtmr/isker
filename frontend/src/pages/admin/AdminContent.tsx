import { Tabs } from "@isker/design-system";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { AdminAI } from "./AdminAI";
import { AdminAssessments } from "./AdminAssessments";
import { AdminCompetencies } from "./AdminCompetencies";
import { AdminQuestions } from "./AdminQuestions";
import { AdminResources } from "./AdminResources";
import { AdminPageHeader } from "./common";

export function AdminAssessmentsPage() {
  const { t } = useTranslation("adminContent");
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "questions" ? "questions" : "assessments";
  return (
    <>
      <AdminPageHeader crumbs={[{ label: t("content.assessmentsPage.title") }]} title={t("content.assessmentsPage.title")} subtitle={t("content.assessmentsPage.subtitle")} />
      <div style={{ marginBottom: 20 }}>
        <Tabs variant="line" ariaLabel={t("content.assessmentsPage.tabsLabel")} value={tab} onChange={(v) => setParams(v === "questions" ? { tab: v } : {}, { replace: true })}
          tabs={[{ value: "assessments", label: t("content.assessmentsPage.tabAssessments") }, { value: "questions", label: t("content.assessmentsPage.tabQuestions") }]} />
      </div>
      <div role="tabpanel" aria-label={tab === "questions" ? t("content.assessmentsPage.tabQuestions") : t("content.assessmentsPage.tabAssessments")}>{tab === "questions" ? <AdminQuestions /> : <AdminAssessments />}</div>
    </>
  );
}

export function AdminCompetenciesPage() {
  const { t } = useTranslation("adminContent");
  return (
    <>
      <AdminPageHeader crumbs={[{ label: t("content.competenciesPage.title") }]} title={t("content.competenciesPage.title")} subtitle={t("content.competenciesPage.subtitle")} />
      <AdminCompetencies />
    </>
  );
}

export function AdminLearningPage() {
  const { t } = useTranslation("adminContent");
  return (
    <>
      <AdminPageHeader crumbs={[{ label: t("content.learningPage.title") }]} title={t("content.learningPage.title")} subtitle={t("content.learningPage.subtitle")} />
      <AdminResources />
    </>
  );
}

export function AdminAIPage() {
  const { t } = useTranslation("adminContent");
  return (
    <>
      <AdminPageHeader crumbs={[{ label: t("content.aiPage.title") }]} title={t("content.aiPage.title")} subtitle={t("content.aiPage.subtitle")} />
      <AdminAI />
    </>
  );
}
