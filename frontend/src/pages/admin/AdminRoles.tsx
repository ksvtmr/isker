import { Badge, Button, Card, Checkbox, ConfirmActionDialog, InlineAlert } from "@isker/design-system";
import { useState } from "react";
import { useAdminMutation } from "../../api/admin";
import { manageApi, usePermissionCatalog, useRoles, type RoleInfo } from "../../api/adminManage";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import { AdminPageHeader, Muted } from "./common";

const RESERVED = new Set(["users.delete", "roles.manage"]);

export function AdminRoles() {
  const roles = useRoles();
  const catalog = usePermissionCatalog();
  const [editing, setEditing] = useState<RoleInfo | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const save = useAdminMutation((v: { id: number; permissions: string[]; reason: string }) => manageApi.setRolePermissions(v.id, v.permissions, v.reason));
  const toast = useToast();
  const header = <AdminPageHeader crumbs={[{ label: "Roles & permissions" }]} title="Roles & permissions"
    subtitle="Access is denied unless a role grants it. Staff can only grant roles ranked below their own; super administrators always hold every permission." />;
  if (roles.isLoading || catalog.isLoading) return <>{header}<PageSkeleton cards={0} chart={false} /></>;
  if (roles.error || !roles.data || !catalog.data) return <>{header}<ErrorState error={roles.error ?? catalog.error} onRetry={() => { roles.refetch(); catalog.refetch(); }} /></>;
  const perms = catalog.data;
  const startEdit = (r: RoleInfo) => { setSelected(new Set(r.permissions)); setEditing(r); save.reset(); };
  return (
    <>
      {header}
      <Card style={{ overflow: "hidden" }}>
        <div className="isk-table-wrap">
          <table className="isk-table">
            <caption className="isk-sr-only">Permissions granted to each role</caption>
            <thead>
              <tr>
                <th scope="col">Permission</th>
                {roles.data.map((r) => (
                  <th key={r.id} scope="col" style={{ textAlign: "center" }}>
                    <span style={{ display: "block" }}>{r.name}</span>
                    <Muted>rank {r.rank} · {r.user_count} user{r.user_count === 1 ? "" : "s"}</Muted>
                    {r.editable && <div style={{ marginTop: 6 }}><Button size="sm" variant="ghost" onClick={() => startEdit(r)} aria-label={`Edit permissions of ${r.name}`}>Edit</Button></div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perms.map((p) => (
                <tr key={p.key}>
                  <th scope="row" style={{ fontWeight: 400, background: "transparent", whiteSpace: "normal", color: "var(--color-neutral-800)", fontSize: 14 }}>
                    {p.description}<span style={{ display: "block" }}><Muted>{p.key}</Muted></span>
                  </th>
                  {roles.data.map((r) => {
                    const on = r.permissions.includes(p.key);
                    return <td key={r.id} style={{ textAlign: "center" }}>{on ? <Badge tone="success" icon="check">Yes</Badge> : <span style={{ color: "var(--color-neutral-500)", fontSize: 13 }}>No</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ConfirmActionDialog open={!!editing} title={`Permissions of ${editing?.name ?? ""}`} confirmLabel="Save permissions" tone="primary" requireReason busy={save.isPending}
        error={save.error ? errorMessage(save.error) : undefined} onCancel={() => setEditing(null)}
        description="Changes apply immediately to everyone with this role."
        onConfirm={(reason) => editing && save.mutate({ id: editing.id, permissions: [...selected], reason }, { onSuccess: () => { toast({ title: "Permissions saved" }); setEditing(null); } })}>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
          <legend className="isk-sr-only">Permissions</legend>
          {perms.map((p) => (
            <Checkbox key={p.key} label={p.description} description={RESERVED.has(p.key) ? `${p.key} — reserved for super administrators` : p.key} disabled={RESERVED.has(p.key)}
              checked={selected.has(p.key)} onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(p.key); else n.delete(p.key); setSelected(n); }} />
          ))}
        </fieldset>
        {editing && !selected.has("admin.access") && selected.size > 0 && <InlineAlert tone="warning">Without “Open the administration area”, people with this role can't reach any admin page.</InlineAlert>}
      </ConfirmActionDialog>
    </>
  );
}
