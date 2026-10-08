import { Button, Card, Input, LevelBadge, StatusBadge } from "@isker/design-system";
import { useState } from "react";
import { useAdminUsers } from "../../api/admin";
import { ErrorState, PageSkeleton } from "../../components/States";
import { formatDate } from "../../utils/format";

export function AdminUsers() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useAdminUsers(q, page);
  return (
    <Card style={{ overflow: "hidden" }}>
      <div style={{ padding: 16, maxWidth: 360 }}><Input aria-label="Search users" placeholder="Search by name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      {isLoading ? <div style={{ padding: 16 }}><PageSkeleton cards={0} chart={false} /></div> : error || !data ? <div style={{ padding: 16 }}><ErrorState error={error} onRetry={() => refetch()} /></div> : (
        <>
          <div className="ik-table-wrap">
            <table className="ik-table">
              <thead><tr><th>User</th><th>Role</th><th>Onboarded</th><th className="num">Assessments</th><th>Latest score</th><th>Joined</th><th>Last login</th></tr></thead>
              <tbody>{data.items.map((u) => (
                <tr key={u.id}>
                  <td><b style={{ fontWeight: 500 }}>{u.full_name}</b><div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{u.email}</div></td>
                  <td>{u.role === "admin" ? <StatusBadge status="recommended">Admin</StatusBadge> : "Learner"}</td>
                  <td>{u.onboarding_completed ? "Yes" : "No"}</td>
                  <td className="num">{u.completed_attempts}</td>
                  <td>{u.latest_overall !== null ? <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><b>{u.latest_overall}</b><LevelBadge score={u.latest_overall} /></span> : "—"}</td>
                  <td>{formatDate(u.created_at)}</td><td>{formatDate(u.last_login_at) || "—"}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--color-neutral-100)", fontSize: 13, color: "var(--color-neutral-500)" }}>
            <span>{data.total} users</span>
            <span style={{ display: "flex", gap: 8 }}>
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
