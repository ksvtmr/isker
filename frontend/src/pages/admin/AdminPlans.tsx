import { Badge, Button, Card, Checkbox, ConfirmActionDialog, Input, Select, Textarea } from "@isker/design-system";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminApi, isVersionConflict, useAdminMutation, type PlanWithVersion } from "../../api/admin";
import { manageApi, useAdminPlans, type PlanAdmin, type PlanEntitlementInput } from "../../api/adminManage";
import { can, useMe } from "../../api/auth";
import { errorMessage } from "../../api/client";
import { ErrorState, PageSkeleton } from "../../components/States";
import { useToast } from "../../components/Toaster";
import { formatCurrency, formatNumber } from "../../utils/format";
import { AdminPageHeader, Muted } from "./common";
import { SaveError, TranslationFields, fromTranslationForm, toTranslationForm, type TranslationField, type TranslationForm } from "./contentSync";

const FEATURE_KEYS = ["assessment.full", "assessment.reassessment", "plan.personalized", "learning.advanced_resources", "practice.tasks", "practice.ai_feedback", "progress.history", "export.data"] as const;
const LIMIT_FEATURES = new Set<string>(["assessment.full", "practice.tasks"]);
type Form = { key: string; name: string; description: string; price: string; currency: string; billing_interval: "none" | "month" | "year"; trial_days: string; is_active: boolean; sort_order: string; ents: Record<string, { enabled: boolean; limit: string }>; tr: TranslationForm };

function toForm(p: PlanWithVersion | undefined, trFields: TranslationField[]): Form {
  const ents: Form["ents"] = {};
  for (const k of FEATURE_KEYS) {
    const e = p?.entitlements.find((x) => x.feature_key === k);
    ents[k] = { enabled: e ? e.enabled : true, limit: e?.limit_value != null ? String(e.limit_value) : "" };
  }
  return { key: p?.key ?? "", name: p?.name ?? "", description: p?.description ?? "", price: p ? (p.price_cents / 100).toFixed(2) : "0.00", currency: p?.currency ?? "USD",
    billing_interval: p?.billing_interval ?? "month", trial_days: String(p?.trial_days ?? 0), is_active: p?.is_active ?? true, sort_order: String(p?.sort_order ?? 10), ents,
    tr: toTranslationForm(p?.translations, trFields) };
}

export function AdminPlans() {
  const { t } = useTranslation("adminContent");
  const { data: me } = useMe();
  const plans = useAdminPlans();
  const [editing, setEditing] = useState<PlanWithVersion | "new" | null>(null);
  const trFields: TranslationField[] = useMemo(() => [
    { key: "name", label: t("plans.form.name") }, { key: "description", label: t("plans.form.description"), multiline: true },
  ], [t]);
  const [form, setForm] = useState<Form>(() => toForm(undefined, trFields));
  const toast = useToast();
  const save = useAdminMutation(async (v: { reason: string }) => {
    const entitlements: PlanEntitlementInput[] = Object.entries(form.ents).map(([feature_key, e]) => ({ feature_key, enabled: e.enabled, limit_value: LIMIT_FEATURES.has(feature_key) && e.limit !== "" ? Number(e.limit) : null }));
    const base = { name: form.name.trim(), description: form.description.trim() || null, price_cents: Math.round(Number(form.price) * 100), currency: form.currency.toUpperCase(),
      billing_interval: form.billing_interval, trial_days: Number(form.trial_days) || 0, is_active: form.is_active, sort_order: Number(form.sort_order) || 0, entitlements };
    const translations = fromTranslationForm(form.tr, trFields, (lang, field) => t("sync.translations.invalidJson", { lang, field }));
    if (editing === "new") return manageApi.createPlan({ key: form.key.trim(), ...base, translations } as Parameters<typeof manageApi.createPlan>[0]);
    const plan = editing as PlanWithVersion;
    return adminApi.updatePlan(plan.id, { ...base, translations, expected_version: plan.lock_version, reason: v.reason });
  });
  const reload = async () => {
    const fresh = await plans.refetch();
    const row = fresh.data?.find((p) => editing !== "new" && p.id === editing?.id) as PlanWithVersion | undefined;
    if (row) { setForm(toForm(row, trFields)); setEditing(row); save.reset(); toast({ title: t("sync.conflict.reloaded") }); }
  };
  const canManage = can(me, "plans.manage");
  const header = <AdminPageHeader crumbs={[{ label: t("plans.title") }]} title={t("plans.title")} subtitle={t("plans.subtitle")}
    action={canManage ? <Button iconLeft="plus" onClick={() => { setForm(toForm(undefined, trFields)); setEditing("new"); save.reset(); }}>{t("plans.newPlan")}</Button> : undefined} />;
  if (plans.isLoading) return <>{header}<PageSkeleton cards={3} chart={false} /></>;
  if (plans.error || !plans.data) return <>{header}<ErrorState error={plans.error} onRetry={() => plans.refetch()} /></>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const isDefault = editing !== "new" && editing?.is_default;
  const priceValid = /^\d+(\.\d{1,2})?$/.test(form.price);
  const featureLabel = (k: string) => t(`plans.features.${k.replace(/\./g, "_")}`);
  const intervalLabel = (i: PlanAdmin["billing_interval"]) => (i === "month" ? t("plans.perMonth") : t("plans.perYear"));
  const priceLabel = (p: PlanAdmin) => {
    if (p.price_cents === 0) return t("plans.free");
    const amount = formatCurrency(p.price_cents, p.currency);
    return p.billing_interval === "none" ? amount : t("plans.pricePer", { amount, interval: intervalLabel(p.billing_interval) });
  };
  return (
    <>
      {header}
      <div className="ik-grid3">
        {plans.data.map((p) => (
          <Card key={p.id} padding={24}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{p.name}</h2>
              <span style={{ display: "inline-flex", gap: 4 }}>{p.is_default && <Badge tone="brand">{t("plans.badgeDefault")}</Badge>}{!p.is_active && <Badge tone="neutral">{t("plans.badgeInactive")}</Badge>}</span>
            </div>
            <p style={{ marginTop: 6, fontSize: 20, fontWeight: 600 }}>{priceLabel(p)}</p>
            <p style={{ marginTop: 4 }}><Muted>{t("plans.subscribers", { count: p.subscriber_count, n: formatNumber(p.subscriber_count) })} · {t("plans.keyLabel", { key: p.key })}</Muted></p>
            <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              {FEATURE_KEYS.map((k) => {
                const e = p.entitlements.find((x) => x.feature_key === k);
                return <li key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{featureLabel(k)}</span><b style={{ fontWeight: 500 }}>{!e?.enabled ? t("common:state.no") : e.limit_value != null ? t("plans.limitPer30Days", { limit: formatNumber(e.limit_value) }) : t("common:state.yes")}</b></li>;
              })}
            </ul>
            {canManage && <div style={{ marginTop: 16 }}><Button size="sm" variant="secondary" iconLeft="pencil" onClick={() => { setForm(toForm(p, trFields)); setEditing(p); save.reset(); }}>{t("plans.editPlan")}</Button></div>}
          </Card>
        ))}
      </div>
      <ConfirmActionDialog open={!!editing} title={editing === "new" ? t("plans.newPlan") : t("plans.editTitle", { name: form.name })} confirmLabel={editing === "new" ? t("plans.createPlan") : t("plans.savePlan")} tone="primary"
        requireReason={editing !== "new"} busy={save.isPending} error={save.error && !isVersionConflict(save.error) ? errorMessage(save.error) : undefined} onCancel={() => setEditing(null)}
        confirmDisabled={form.name.trim().length < 2 || !priceValid || (editing === "new" && !/^[a-z0-9_-]{2,48}$/.test(form.key))}
        onConfirm={(reason) => save.mutate({ reason }, { onSuccess: () => { toast({ title: editing === "new" ? t("plans.created") : t("plans.saved") }); setEditing(null); } })}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "55vh", overflowY: "auto", paddingRight: 4 }}>
          {isVersionConflict(save.error) && <SaveError error={save.error} onReload={reload} />}
          {editing === "new" && <Input label={t("plans.form.key")} hint={t("plans.form.keyHint")} value={form.key} onChange={(e) => set("key", e.target.value)} />}
          <Input label={t("plans.form.name")} value={form.name} onChange={(e) => set("name", e.target.value)} />
          <Textarea label={t("plans.form.description")} rows={2} maxLength={1000} value={form.description} onChange={(e) => set("description", e.target.value)} />
          <div className="ik-form2">
            <Input label={t("plans.form.price")} inputMode="decimal" value={form.price} disabled={!!isDefault} error={priceValid ? undefined : t("plans.form.priceInvalid")} onChange={(e) => set("price", e.target.value)} hint={isDefault ? t("plans.form.priceDefaultHint") : undefined} />
            <Select label={t("plans.form.billing")} value={form.billing_interval} onChange={(e) => set("billing_interval", e.target.value as Form["billing_interval"])}
              options={[{ value: "none", label: t("plans.form.billingNone") }, { value: "month", label: t("plans.form.billingMonth") }, { value: "year", label: t("plans.form.billingYear") }]} />
          </div>
          <Checkbox label={t("plans.form.available")} description={isDefault ? t("plans.form.availableDefaultHint") : t("plans.form.availableHint")} disabled={!!isDefault} checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{t("plans.form.features")}</legend>
            {FEATURE_KEYS.map((k) => (
              <div key={k} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Checkbox label={featureLabel(k)} checked={form.ents[k].enabled} onChange={(e) => set("ents", { ...form.ents, [k]: { ...form.ents[k], enabled: e.target.checked } })} />
                {LIMIT_FEATURES.has(k) && form.ents[k].enabled && (
                  <div style={{ width: 170 }}><Input aria-label={t("plans.form.limitAria", { feature: featureLabel(k) })} placeholder={t("plans.form.unlimited")} type="number" min={0} value={form.ents[k].limit}
                    onChange={(e) => set("ents", { ...form.ents, [k]: { ...form.ents[k], limit: e.target.value } })} /></div>
                )}
              </div>
            ))}
          </fieldset>
          <TranslationFields fields={trFields} value={form.tr} onChange={(tr) => set("tr", tr)} />
        </div>
      </ConfirmActionDialog>
    </>
  );
}
