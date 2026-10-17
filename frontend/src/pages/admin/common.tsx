import { Badge, Breadcrumbs, ConfirmActionDialog, type Crumb } from "@isker/design-system";
import { PageHeader } from "../../components/PageTitle";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ACCOUNT_STATUSES, OUTCOMES, STATUS_TONE, SUBSCRIPTION_STATUSES, humanize } from "../../api/adminManage";
import { errorMessage } from "../../api/client";
import { useToast } from "../../components/Toaster";
import i18n from "../../i18n";
import { formatDateTime as formatDateTimeIntl } from "../../utils/format";

/** Locale-aware date and time; "—" when there is no date. */
export function formatDateTime(iso: string | null | undefined): string {
  return formatDateTimeIntl(iso) || i18n.t("common:state.none");
}

/** Page header for admin pages: breadcrumbs + title. Crumb hrefs navigate client-side. */
export function AdminPageHeader({ crumbs, title, subtitle, action, docTitle }: { crumbs?: { label: string; to?: string }[]; title: ReactNode; subtitle?: ReactNode; action?: ReactNode; docTitle?: string }) {
  const { t } = useTranslation("admin");
  const navigate = useNavigate();
  const items: Crumb[] = [{ label: t("crumbs.admin"), href: "/admin", onClick: () => navigate("/admin") }, ...(crumbs ?? []).map((c) => ({ label: c.label, href: c.to, onClick: c.to ? () => navigate(c.to!) : undefined }))];
  return (
    <>
      {crumbs && crumbs.length > 0 && <Breadcrumbs items={items} />}
      <PageHeader title={title} subtitle={subtitle} action={action} docTitle={docTitle} />
    </>
  );
}

export type StatusKind = "account" | "subscription" | "outcome" | "attempt";
const KIND_NS: Record<StatusKind, string> = { account: "accountStatus", subscription: "subscriptionStatus", outcome: "outcome", attempt: "attemptStatus" };

function guessKind(status: string): StatusKind {
  if ((OUTCOMES as readonly string[]).includes(status)) return "outcome";
  if ((ACCOUNT_STATUSES as readonly string[]).includes(status)) return "account";
  if ((SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) return "subscription";
  return "attempt";
}

/** Translated label for an API status value (account status, subscription status, outcome or attempt status). */
export function useStatusLabel() {
  const { t } = useTranslation("admin");
  return (status: string, kind?: StatusKind) => t(`common:${KIND_NS[kind ?? guessKind(status)]}.${status}`, { defaultValue: humanize(status) });
}

function lookup(key: string): string | null {
  if (!i18n.exists(key)) return null;
  const v = i18n.t(key, { returnObjects: true }) as unknown;
  return typeof v === "string" && v ? v : null; // a group of labels (an object) is not a label
}

/**
 * Translated label of an audit action or subscription event type ("admin.question_published"). Codes without a
 * translation (added to the backend later) get a translated generic label that includes the raw code — never an
 * English "humanized" guess.
 */
export function auditActionLabel(action: string): string {
  return lookup(`admin:audit.actions.${action}`) ?? i18n.t("admin:audit.unknownAction", { code: action });
}

/** Translated label of an audit target type ("learning_resource"), with the same generic fallback. */
export function auditTargetLabel(type: string): string {
  return lookup(`admin:audit.targets.${type}`) ?? i18n.t("admin:audit.unknownTarget", { code: type });
}

/** Translated labels for audit actions / subscription event types and audit target types. */
export function useAuditLabels() {
  useTranslation("admin"); // re-render on language change
  return {
    action: auditActionLabel,
    target: auditTargetLabel,
    /** "Question №12" / "Question" when there is no id. */
    targetWithId: (type: string, id: number | null) => (id !== null ? i18n.t("admin:audit.target", { type: auditTargetLabel(type), id }) : auditTargetLabel(type)),
  };
}

export function StatusPill({ status, kind }: { status: string; kind?: StatusKind }) {
  const label = useStatusLabel();
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label(status, kind)}</Badge>;
}

export function RoleBadges({ roles }: { roles: string[] }) {
  const { t } = useTranslation("admin");
  const staff = roles.filter((r) => r !== "user");
  if (!staff.length) return <span style={{ color: "var(--color-neutral-600)", fontSize: 13 }}>{t("common:roles.user")}</span>;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {staff.map((r) => <Badge key={r} tone={r === "super_admin" || r === "admin" ? "brand" : "info"}>{t(`common:roles.${r}`, { defaultValue: humanize(r) })}</Badge>)}
    </span>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{children}</span>;
}

interface PendingAction { title: string; description?: string; confirmLabel: string; success: string; run: () => Promise<unknown> }

/** Confirmation for content actions (unpublish, deactivate). Success is announced only after the API confirms. */
export function useConfirmAction() {
  const { t } = useTranslation("admin");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const close = () => { setPending(null); setError(null); };
  const dialog = (
    <ConfirmActionDialog open={!!pending} title={pending?.title ?? ""} description={pending?.description} confirmLabel={pending?.confirmLabel ?? t("common:actions.confirm")}
      busy={busy} error={error ? errorMessage(error) : undefined} onCancel={close}
      onConfirm={async () => {
        if (!pending) return;
        setBusy(true);
        setError(null);
        try {
          await pending.run();
          toast({ title: pending.success });
          close();
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }} />
  );
  return { dialog, ask: (a: PendingAction) => { setError(null); setPending(a); } };
}
