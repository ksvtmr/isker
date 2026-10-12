import { Badge, Button, Card, Checkbox, ConfirmActionDialog, InlineAlert } from "@isker/design-system";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminMutation } from "../../api/admin";
import { manageApi, usePermissionCatalog, useRoles, type RoleInfo } from "../../api/adminManage";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import { AdminPageHeader, Muted } from "./common";

const RESERVED = new Set(["users.delete", "roles.manage"]);

export function AdminRoles() {
  const { t } = useTranslation("admin");
  const roles = useRoles();
  const catalog = usePermissionCatalog();
  const [editing, setEditing] = useState<RoleInfo | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const save = useAdminMutation((v: { id: number; permissions: string[]; reason: string }) => manageApi.setRolePermissions(v.id, v.permissions, v.reason));
  const toast = useToast();
  const header = <AdminPageHeader crumbs={[{ label: t("crumbs.roles") }]} title={t("roles.title")} subtitle={t("roles.subtitle")} />;
  if (roles.isLoading || catalog.isLoading) return <>{header}<PageSkeleton cards={0} chart={false} /></>;
  if (roles.error || !roles.data || !catalog.data) return <>{header}<ErrorState error={roles.error ?? catalog.error} onRetry={() => { roles.refetch(); catalog.refetch(); }} /></>;
  const perms = catalog.data;
  const roleName = (r: RoleInfo) => t(`common:roles.${r.key}`, { defaultValue: r.name });
  const permLabel = (p: { key: string; description: string }) => t(`admin:permissions.${p.key}`, { defaultValue: p.description });
  const accessLabel = permLabel(perms.find((p) => p.key === "admin.access") ?? { key: "admin.access", description: "admin.access" });
  const startEdit = (r: RoleInfo) => { setSelected(new Set(r.permissions)); setEditing(r); save.reset(); };
  return (
    <>
      {header}
      <Card style={{ overflow: "hidden" }}>
        <div className="isk-table-wrap">
          <table className="isk-table">
            <caption className="isk-sr-only">{t("roles.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("roles.permissionColumn")}</th>
                {roles.data.map((r) => (
                  <th key={r.id} scope="col" style={{ textAlign: "center" }}>
                    <span style={{ display: "block" }}>{roleName(r)}</span>
                    <Muted>{t("roles.rankUsers", { rank: r.rank, count: r.user_count })}</Muted>
                    {r.editable && <div style={{ marginTop: 6 }}><Button size="sm" variant="ghost" onClick={() => startEdit(r)} aria-label={t("roles.editAria", { role: roleName(r) })}>{t("common:actions.edit")}</Button></div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perms.map((p) => (
                <tr key={p.key}>
                  <th scope="row" style={{ fontWeight: 400, background: "transparent", whiteSpace: "normal", color: "var(--color-neutral-800)", fontSize: 14 }}>
                    {permLabel(p)}<span style={{ display: "block" }}><Muted>{p.key}</Muted></span>
                  </th>
                  {roles.data.map((r) => {
                    const on = r.permissions.includes(p.key);
                    return <td key={r.id} style={{ textAlign: "center" }}>{on ? <Badge tone="success" icon="check">{t("common:state.yes")}</Badge> : <span style={{ color: "var(--color-neutral-500)", fontSize: 13 }}>{t("common:state.no")}</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ConfirmActionDialog open={!!editing} title={t("roles.dialogTitle", { role: editing ? roleName(editing) : "" })} confirmLabel={t("roles.save")} tone="primary" requireReason busy={save.isPending}
        error={save.error ? errorMessage(save.error) : undefined} onCancel={() => setEditing(null)}
        description={t("roles.dialogDescription")}
        onConfirm={(reason) => editing && save.mutate({ id: editing.id, permissions: [...selected], reason }, { onSuccess: () => { toast({ title: t("roles.saved") }); setEditing(null); } })}>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
          <legend className="isk-sr-only">{t("roles.permissionsLegend")}</legend>
          {perms.map((p) => (
            <Checkbox key={p.key} label={permLabel(p)} description={RESERVED.has(p.key) ? t("roles.reserved", { key: p.key }) : p.key} disabled={RESERVED.has(p.key)}
              checked={selected.has(p.key)} onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(p.key); else n.delete(p.key); setSelected(n); }} />
          ))}
        </fieldset>
        {editing && !selected.has("admin.access") && selected.size > 0 && <InlineAlert tone="warning">{t("roles.noAccessWarning", { permission: accessLabel })}</InlineAlert>}
      </ConfirmActionDialog>
    </>
  );
}
