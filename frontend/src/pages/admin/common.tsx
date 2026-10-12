import { Badge, Breadcrumbs, ConfirmActionDialog, PageHeader, type Crumb } from "@isker/design-system";
import { useState, type ReactNode } from "react";
import { errorMessage } from "../../api/client";
import { useToast } from "../../components/Toaster";
import { useNavigate } from "react-router-dom";
import { ROLE_LABELS, STATUS_TONE, humanize } from "../../api/adminManage";

/** Page header for admin pages: breadcrumbs + title. Crumb hrefs navigate client-side. */
export function AdminPageHeader({ crumbs, title, subtitle, action }: { crumbs?: { label: string; to?: string }[]; title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  const navigate = useNavigate();
  const items: Crumb[] = [{ label: "Admin", href: "/admin", onClick: () => navigate("/admin") }, ...(crumbs ?? []).map((c) => ({ label: c.label, href: c.to, onClick: c.to ? () => navigate(c.to!) : undefined }))];
  return (
    <>
      {crumbs && crumbs.length > 0 && <Breadcrumbs items={items} />}
      <PageHeader title={title} subtitle={subtitle} action={action} />
    </>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{humanize(status)}</Badge>;
}

export function RoleBadges({ roles }: { roles: string[] }) {
  const staff = roles.filter((r) => r !== "user");
  if (!staff.length) return <span style={{ color: "var(--color-neutral-600)", fontSize: 13 }}>Learner</span>;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {staff.map((r) => <Badge key={r} tone={r === "super_admin" || r === "admin" ? "brand" : "info"}>{ROLE_LABELS[r] ?? humanize(r)}</Badge>)}
    </span>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{children}</span>;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface PendingAction { title: string; description?: string; confirmLabel: string; success: string; run: () => Promise<unknown> }

/** Confirmation for content actions (unpublish, deactivate). Success is announced only after the API confirms. */
export function useConfirmAction() {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const close = () => { setPending(null); setError(null); };
  const dialog = (
    <ConfirmActionDialog open={!!pending} title={pending?.title ?? ""} description={pending?.description} confirmLabel={pending?.confirmLabel ?? "Confirm"}
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
