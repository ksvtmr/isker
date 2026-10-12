import { Badge, Button, Card, Checkbox, ConfirmActionDialog, Input, Select, Textarea } from "@isker/design-system";
import { useState } from "react";
import { useAdminMutation } from "../../api/admin";
import { manageApi, useAdminPlans, type PlanAdmin, type PlanEntitlementInput } from "../../api/adminManage";
import { can, useMe } from "../../api/auth";
import { FEATURE_LABELS, formatPrice } from "../../api/billing";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import { AdminPageHeader, Muted } from "./common";

const LIMIT_FEATURES = new Set(["assessment.full", "practice.tasks"]);
type Form = { key: string; name: string; description: string; price: string; currency: string; billing_interval: "none" | "month" | "year"; trial_days: string; is_active: boolean; sort_order: string; ents: Record<string, { enabled: boolean; limit: string }> };

function toForm(p?: PlanAdmin): Form {
  const ents: Form["ents"] = {};
  for (const k of Object.keys(FEATURE_LABELS)) {
    const e = p?.entitlements.find((x) => x.feature_key === k);
    ents[k] = { enabled: e ? e.enabled : true, limit: e?.limit_value != null ? String(e.limit_value) : "" };
  }
  return { key: p?.key ?? "", name: p?.name ?? "", description: p?.description ?? "", price: p ? (p.price_cents / 100).toFixed(2) : "0.00", currency: p?.currency ?? "USD",
    billing_interval: p?.billing_interval ?? "month", trial_days: String(p?.trial_days ?? 0), is_active: p?.is_active ?? true, sort_order: String(p?.sort_order ?? 10), ents };
}

export function AdminPlans() {
  const { data: me } = useMe();
  const plans = useAdminPlans();
  const [editing, setEditing] = useState<PlanAdmin | "new" | null>(null);
  const [form, setForm] = useState<Form>(toForm());
  const toast = useToast();
  const save = useAdminMutation(async (v: { reason: string }) => {
    const entitlements: PlanEntitlementInput[] = Object.entries(form.ents).map(([feature_key, e]) => ({ feature_key, enabled: e.enabled, limit_value: LIMIT_FEATURES.has(feature_key) && e.limit !== "" ? Number(e.limit) : null }));
    const base = { name: form.name.trim(), description: form.description.trim() || null, price_cents: Math.round(Number(form.price) * 100), currency: form.currency.toUpperCase(),
      billing_interval: form.billing_interval, trial_days: Number(form.trial_days) || 0, is_active: form.is_active, sort_order: Number(form.sort_order) || 0, entitlements };
    if (editing === "new") return manageApi.createPlan({ key: form.key.trim(), ...base });
    return manageApi.updatePlan((editing as PlanAdmin).id, { ...base, reason: v.reason });
  });
  const canManage = can(me, "plans.manage");
  const header = <AdminPageHeader crumbs={[{ label: "Plans" }]} title="Plans" subtitle="Prices and limits are enforced by the server for every request. Changing a plan affects all its subscribers immediately."
    action={canManage ? <Button iconLeft="plus" onClick={() => { setForm(toForm()); setEditing("new"); save.reset(); }}>New plan</Button> : undefined} />;
  if (plans.isLoading) return <>{header}<PageSkeleton cards={3} chart={false} /></>;
  if (plans.error || !plans.data) return <>{header}<ErrorState error={plans.error} onRetry={() => plans.refetch()} /></>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const isDefault = editing !== "new" && editing?.is_default;
  const priceValid = /^\d+(\.\d{1,2})?$/.test(form.price);
  return (
    <>
      {header}
      <div className="ik-grid3">
        {plans.data.map((p) => (
          <Card key={p.id} padding={24}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{p.name}</h2>
              <span style={{ display: "inline-flex", gap: 4 }}>{p.is_default && <Badge tone="brand">Default</Badge>}{!p.is_active && <Badge tone="neutral">Inactive</Badge>}</span>
            </div>
            <p style={{ marginTop: 6, fontSize: 20, fontWeight: 600 }}>{formatPrice(p)}</p>
            <p style={{ marginTop: 4 }}><Muted>{p.subscriber_count} user{p.subscriber_count === 1 ? "" : "s"} · key “{p.key}”</Muted></p>
            <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              {Object.entries(FEATURE_LABELS).map(([k, label]) => {
                const e = p.entitlements.find((x) => x.feature_key === k);
                return <li key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{label}</span><b style={{ fontWeight: 500 }}>{!e?.enabled ? "No" : e.limit_value != null ? `${e.limit_value} / 30 days` : "Yes"}</b></li>;
              })}
            </ul>
            {canManage && <div style={{ marginTop: 16 }}><Button size="sm" variant="secondary" iconLeft="pencil" onClick={() => { setForm(toForm(p)); setEditing(p); save.reset(); }}>Edit plan</Button></div>}
          </Card>
        ))}
      </div>
      <ConfirmActionDialog open={!!editing} title={editing === "new" ? "New plan" : `Edit ${form.name}`} confirmLabel={editing === "new" ? "Create plan" : "Save plan"} tone="primary"
        requireReason={editing !== "new"} busy={save.isPending} error={save.error ? errorMessage(save.error) : undefined} onCancel={() => setEditing(null)}
        confirmDisabled={form.name.trim().length < 2 || !priceValid || (editing === "new" && !/^[a-z0-9_-]{2,48}$/.test(form.key))}
        onConfirm={(reason) => save.mutate({ reason }, { onSuccess: () => { toast({ title: editing === "new" ? "Plan created" : "Plan saved" }); setEditing(null); } })}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "55vh", overflowY: "auto", paddingRight: 4 }}>
          {editing === "new" && <Input label="Key" hint="Lowercase letters, numbers, - and _. Can't be changed later." value={form.key} onChange={(e) => set("key", e.target.value)} />}
          <Input label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <Textarea label="Description" rows={2} maxLength={1000} value={form.description} onChange={(e) => set("description", e.target.value)} />
          <div className="ik-form2">
            <Input label="Price" inputMode="decimal" value={form.price} disabled={!!isDefault} error={priceValid ? undefined : "Use a number like 9.00"} onChange={(e) => set("price", e.target.value)} hint={isDefault ? "The default plan stays free." : undefined} />
            <Select label="Billing" value={form.billing_interval} onChange={(e) => set("billing_interval", e.target.value as Form["billing_interval"])}
              options={[{ value: "none", label: "One-off / none" }, { value: "month", label: "Monthly" }, { value: "year", label: "Yearly" }]} />
          </div>
          <Checkbox label="Available" description={isDefault ? "The default plan can't be deactivated." : "Inactive plans can't be assigned."} disabled={!!isDefault} checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Features</legend>
            {Object.entries(FEATURE_LABELS).map(([k, label]) => (
              <div key={k} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Checkbox label={label} checked={form.ents[k].enabled} onChange={(e) => set("ents", { ...form.ents, [k]: { ...form.ents[k], enabled: e.target.checked } })} />
                {LIMIT_FEATURES.has(k) && form.ents[k].enabled && (
                  <div style={{ width: 170 }}><Input aria-label={`${label}: limit per 30 days (empty = unlimited)`} placeholder="Unlimited" type="number" min={0} value={form.ents[k].limit}
                    onChange={(e) => set("ents", { ...form.ents, [k]: { ...form.ents[k], limit: e.target.value } })} /></div>
                )}
              </div>
            ))}
          </fieldset>
        </div>
      </ConfirmActionDialog>
    </>
  );
}
