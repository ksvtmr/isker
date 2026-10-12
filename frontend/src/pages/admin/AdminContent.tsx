import { Tabs } from "@isker/design-system";
import { useSearchParams } from "react-router-dom";
import { AdminAI } from "./AdminAI";
import { AdminAssessments } from "./AdminAssessments";
import { AdminCompetencies } from "./AdminCompetencies";
import { AdminQuestions } from "./AdminQuestions";
import { AdminResources } from "./AdminResources";
import { AdminPageHeader } from "./common";

export function AdminAssessmentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "questions" ? "questions" : "assessments";
  return (
    <>
      <AdminPageHeader crumbs={[{ label: "Assessments" }]} title="Assessments" subtitle="Assessment versions and the question bank. Questions with answers can't change type; deactivate and replace them instead." />
      <div style={{ marginBottom: 20 }}>
        <Tabs variant="line" ariaLabel="Assessment content" value={tab} onChange={(v) => setParams(v === "questions" ? { tab: v } : {}, { replace: true })}
          tabs={[{ value: "assessments", label: "Assessments" }, { value: "questions", label: "Question bank" }]} />
      </div>
      <div role="tabpanel" aria-label={tab === "questions" ? "Question bank" : "Assessments"}>{tab === "questions" ? <AdminQuestions /> : <AdminAssessments />}</div>
    </>
  );
}

export function AdminCompetenciesPage() {
  return (
    <>
      <AdminPageHeader crumbs={[{ label: "Competencies" }]} title="Competencies" subtitle="The 15 EntreComp competencies, their descriptions, priorities and default targets." />
      <AdminCompetencies />
    </>
  );
}

export function AdminLearningPage() {
  return (
    <>
      <AdminPageHeader crumbs={[{ label: "Learning content" }]} title="Learning content" subtitle="Learning resources and practical tasks. Unpublishing keeps learners' history." />
      <AdminResources />
    </>
  );
}

export function AdminAIPage() {
  return (
    <>
      <AdminPageHeader crumbs={[{ label: "AI governance" }]} title="AI governance" subtitle="Every AI evaluation is logged with its provider, prompt version, latency and fallback status." />
      <AdminAI />
    </>
  );
}
