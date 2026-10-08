import { PageHeader, Tabs } from "@isker/design-system";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

const TABS = [
  { value: "/admin", label: "Overview" }, { value: "/admin/competencies", label: "Competencies" },
  { value: "/admin/questions", label: "Questions" }, { value: "/admin/assessments", label: "Assessments" },
  { value: "/admin/resources", label: "Resources & tasks" }, { value: "/admin/users", label: "Users" }, { value: "/admin/ai", label: "AI governance" },
];

export function AdminLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader eyebrow="Administration" title="Isker Admin" subtitle="Manage the competency model, question bank, learning content and AI evaluations." />
      <div className="ik-admin-nav" style={{ overflowX: "auto" }}>
        <Tabs variant="line" ariaLabel="Admin sections" value={TABS.find((t) => t.value === pathname)?.value ?? "/admin"} onChange={(v) => navigate(v)} tabs={TABS} />
      </div>
      <Outlet />
    </>
  );
}
