/**
 * Building blocks shared by the content editor pages: publication status, ru/kk translations, version conflicts
 * and the save/reset footer. Every save sends the `lock_version` the editor loaded as `expected_version`; a 409
 * VERSION_CONFLICT is shown with a "Reload" action and never overwrites someone else's change.
 */
import { Badge, Button, InlineAlert, Input, Textarea, type BadgeTone } from "@isker/design-system";
import { useTranslation } from "react-i18next";
import { adminApi, isVersionConflict, useAdminMutation, type ContentStatus, type StatusEntity, type TranslationLang, type Translations } from "../../api/admin";
import { errorMessage } from "../../api/client";
import { useConfirmAction } from "./common";

export const LANGS: TranslationLang[] = ["ru", "kk"];

const STATUS_TONE: Record<ContentStatus, BadgeTone> = { published: "success", draft: "neutral", archived: "warning" };

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  const { t } = useTranslation("adminContent");
  return <Badge tone={STATUS_TONE[status]}>{t(`sync.status.${status}`)}</Badge>;
}

export interface StatusTarget { entity: StatusEntity; id: number; status: ContentStatus; lock_version: number; title: string }

/** Publish / unpublish / archive buttons with a confirmation; success is announced only after the API confirms. */
export function useStatusActions() {
  const { t } = useTranslation("adminContent");
  const confirm = useConfirmAction();
  const change = useAdminMutation(adminApi.setStatus);
  const ask = (row: StatusTarget, status: ContentStatus) => {
    const kind = status === "published" ? "publish" : status === "draft" ? "unpublish" : "archive";
    confirm.ask({
      title: t(`sync.confirm.${kind}Title`, { title: row.title }),
      description: t(`sync.confirm.${kind}Text`),
      confirmLabel: t(`sync.actions.${kind}`),
      success: t(`sync.done.${kind}`),
      run: () => change.mutateAsync({ entity: row.entity, id: row.id, status, expected_version: row.lock_version }),
    });
  };
  const buttons = (row: StatusTarget) => (
    <>
      {row.status !== "published" && <Button size="sm" variant="ghost" onClick={() => ask(row, "published")}>{t("sync.actions.publish")}</Button>}
      {row.status === "published" && <Button size="sm" variant="ghost" onClick={() => ask(row, "draft")}>{t("sync.actions.unpublish")}</Button>}
      {row.status !== "archived" && <Button size="sm" variant="ghost" onClick={() => ask(row, "archived")}>{t("sync.actions.archive")}</Button>}
    </>
  );
  return { dialog: confirm.dialog, buttons };
}

/** Status filter options for the content lists. */
export function useStatusOptions() {
  const { t } = useTranslation("adminContent");
  return (["draft", "published", "archived"] as ContentStatus[]).map((value) => ({ value, label: t(`sync.status.${value}`) }));
}

// --- Translations ------------------------------------------------------------------------------------------------

export type TranslationForm = Record<TranslationLang, Record<string, string>>;
export interface TranslationField { key: string; label: string; multiline?: boolean; rows?: number; json?: boolean; hint?: string }

/** Editable strings for each language. JSON fields (rubric) are edited as formatted JSON text. */
export function toTranslationForm(tr: Translations | null | undefined, fields: TranslationField[]): TranslationForm {
  const out = { ru: {}, kk: {} } as TranslationForm;
  for (const lang of LANGS) {
    for (const f of fields) {
      const v = tr?.[lang]?.[f.key];
      out[lang][f.key] = v == null ? "" : f.json ? JSON.stringify(v, null, 2) : String(v);
    }
  }
  return out;
}

/** Back to the API shape; empty texts are left out. Throws a localized Error when a JSON field is invalid. */
export function fromTranslationForm(form: TranslationForm, fields: TranslationField[], invalidJson: (lang: string, field: string) => string): Translations {
  const out: Translations = {};
  for (const lang of LANGS) {
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = (form[lang][f.key] ?? "").trim();
      if (!raw) continue;
      if (f.json) {
        try { values[f.key] = JSON.parse(raw); } catch { throw new Error(invalidJson(lang, f.label)); }
      } else values[f.key] = raw;
    }
    if (Object.keys(values).length) out[lang] = values;
  }
  return out;
}

export function TranslationFields({ fields, value, onChange }: { fields: TranslationField[]; value: TranslationForm; onChange: (v: TranslationForm) => void }) {
  const { t } = useTranslation("adminContent");
  const filled = LANGS.reduce((n, lang) => n + fields.filter((f) => value[lang][f.key]?.trim()).length, 0);
  return (
    <details style={{ border: "1px solid var(--color-neutral-200)", borderRadius: 8, padding: "10px 12px" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>{t("sync.translations.title", { filled, total: fields.length * LANGS.length })}</summary>
      <p className="isk-hint" style={{ margin: "8px 0 12px" }}>{t("sync.translations.hint")}</p>
      {LANGS.map((lang) => (
        <fieldset key={lang} style={{ border: 0, padding: 0, margin: "0 0 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t(`sync.translations.${lang}`)}</legend>
          {fields.map((f) => {
            const label = t("sync.translations.fieldLabel", { field: f.label, lang: lang.toUpperCase() });
            const set = (v: string) => onChange({ ...value, [lang]: { ...value[lang], [f.key]: v } });
            return f.multiline || f.json
              ? <Textarea key={f.key} label={label} hint={f.hint} rows={f.rows ?? (f.json ? 5 : 3)} value={value[lang][f.key] ?? ""} onChange={(e) => set(e.target.value)} />
              : <Input key={f.key} label={label} hint={f.hint} value={value[lang][f.key] ?? ""} onChange={(e) => set(e.target.value)} />;
          })}
        </fieldset>
      ))}
    </details>
  );
}

// --- Save errors and footer ---------------------------------------------------------------------------------------

/** A failed save. A version conflict explains what happened and offers to load the latest version. */
export function SaveError({ error, local, onReload }: { error: unknown; local?: string | null; onReload: () => void }) {
  const { t } = useTranslation("adminContent");
  if (local) return <InlineAlert>{local}</InlineAlert>;
  if (!error) return null;
  if (isVersionConflict(error)) {
    return (
      <InlineAlert tone="warning" title={t("sync.conflict.title")}>
        <p style={{ margin: "2px 0 8px" }}>{t("sync.conflict.text")}</p>
        <Button size="sm" variant="secondary" iconLeft="refresh-cw" onClick={onReload}>{t("sync.conflict.reload")}</Button>
      </InlineAlert>
    );
  }
  return <InlineAlert>{errorMessage(error)}</InlineAlert>;
}

/** Modal footer: unsaved/saving state, Reset (back to the loaded version), Cancel and Save. */
export function EditorFooter({ dirty, saving, onCancel, onReset, onSave, saveLabel }: { dirty: boolean; saving: boolean; onCancel: () => void; onReset?: () => void; onSave: () => void; saveLabel?: string }) {
  const { t } = useTranslation("adminContent");
  return (
    <>
      <span role="status" aria-live="polite" style={{ marginRight: "auto", fontSize: 13, color: "var(--color-neutral-600)" }}>
        {saving ? t("sync.saving") : dirty ? t("sync.unsaved") : ""}
      </span>
      {onReset && <Button variant="ghost" disabled={!dirty || saving} onClick={onReset}>{t("sync.reset")}</Button>}
      <Button variant="secondary" onClick={onCancel}>{t("common:actions.cancel")}</Button>
      <Button loading={saving} disabled={!dirty} onClick={onSave}>{saveLabel ?? t("common:actions.save")}</Button>
    </>
  );
}
