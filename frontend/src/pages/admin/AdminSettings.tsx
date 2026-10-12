import { Badge, Card, CardHeader, InlineAlert, KeyValueList } from "@isker/design-system";
import { useSettingsStatus } from "../../api/adminManage";
import { ErrorState, PageSkeleton } from "../../components/States";
import { AdminPageHeader } from "./common";

const on = (v: boolean, yes = "On", no = "Off") => <Badge tone={v ? "success" : "warning"}>{v ? yes : no}</Badge>;

/** Read-only: configuration comes from environment variables (see .env.example). Secrets are never returned by the API. */
export function AdminSettings() {
  const { data: s, isLoading, error, refetch } = useSettingsStatus();
  const header = <AdminPageHeader crumbs={[{ label: "Settings" }]} title="Platform settings" subtitle="Read-only status. Settings are changed through environment variables and a restart; secrets are never shown." />;
  if (isLoading) return <>{header}<PageSkeleton cards={0} chart={false} /></>;
  if (error || !s) return <>{header}<ErrorState error={error} onRetry={() => refetch()} /></>;
  return (
    <>
      {header}
      {s.environment !== "production" && <div style={{ marginBottom: 16 }}><InlineAlert tone="warning" title={`Environment: ${s.environment}`}>This instance is not running in production mode.</InlineAlert></div>}
      <div className="ik-grid2" style={{ alignItems: "start" }}>
        <Card><CardHeader title="Security" /><div style={{ padding: "0 24px 24px" }}>
          <KeyValueList items={[
            { label: "Secure cookies (HTTPS only)", value: on(s.security.secure_cookies) },
            { label: "CSRF protection", value: on(s.security.csrf_protection) },
            { label: "Rate limiting", value: on(s.security.rate_limiting) },
            { label: "Session lifetime", value: `${s.security.session_hours} hours` },
            { label: "Max request size", value: `${Math.round(s.security.max_request_bytes / 1000)} KB` },
            { label: "Allowed origins (CORS)", value: s.cors_origins.join(", ") || "Same origin only" },
          ]} />
        </div></Card>
        <Card><CardHeader title="Email" /><div style={{ padding: "0 24px 24px" }}>
          <KeyValueList items={[
            { label: "Delivery", value: s.email.backend === "smtp" ? <Badge tone="success">SMTP</Badge> : s.email.backend === "console" ? <Badge tone="warning">Development log (not delivered)</Badge> : <Badge tone="neutral">Disabled</Badge> },
            { label: "Verification required to sign in", value: s.email.verification_required ? "Yes" : "No" },
            { label: "Public app URL (used in links)", value: s.app_base_url },
          ]} />
          {!s.email.delivers_email && <div style={{ marginTop: 12 }}><InlineAlert tone="info">Password reset and confirmation emails are not delivered. Configure SMTP_* variables and EMAIL_BACKEND=smtp.</InlineAlert></div>}
        </div></Card>
        <Card><CardHeader title="AI" /><div style={{ padding: "0 24px 24px" }}>
          <KeyValueList items={[
            { label: "Provider", value: s.ai.configured ? s.ai.provider : <Badge tone="warning">Built-in rule-based evaluator</Badge> },
            { label: "Model", value: s.ai.model ?? "—" },
          ]} />
        </div></Card>
        <Card><CardHeader title="Payments" /><div style={{ padding: "0 24px 24px" }}>
          <KeyValueList items={[
            { label: "Provider", value: s.payments.provider ?? "None" },
            { label: "Webhooks configured", value: on(s.payments.configured, "Yes", "No") },
            { label: "Online checkout", value: on(s.payments.checkout_available, "Available", "Not available") },
            { label: "Terms version", value: s.terms_version },
          ]} />
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--color-neutral-600)" }}>{s.payments.note}</p>
        </div></Card>
      </div>
    </>
  );
}
