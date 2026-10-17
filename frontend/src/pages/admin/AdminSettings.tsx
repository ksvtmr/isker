import { Badge, Card, CardHeader, InlineAlert, KeyValueList } from "@isker/design-system";
import { useTranslation } from "react-i18next";
import { useSettingsStatus } from "../../api/adminManage";
import { ErrorState, PageSkeleton } from "../../components/States";
import { formatNumber } from "../../utils/format";
import { AdminPageHeader } from "./common";

const on = (v: boolean, yes: string, no: string) => <Badge tone={v ? "success" : "warning"}>{v ? yes : no}</Badge>;

/** Read-only: configuration comes from environment variables (see .env.example). Secrets are never returned by the API. */
export function AdminSettings() {
  const { t } = useTranslation("adminContent");
  const { data: s, isLoading, error, refetch } = useSettingsStatus();
  const onOff = (v: boolean) => on(v, t("settings.on"), t("settings.off"));
  const header = <AdminPageHeader crumbs={[{ label: t("settings.crumb") }]} title={t("settings.title")} subtitle={t("settings.subtitle")} />;
  if (isLoading) return <>{header}<PageSkeleton cards={0} chart={false} /></>;
  if (error || !s) return <>{header}<ErrorState error={error} onRetry={() => refetch()} /></>;
  return (
    <>
      {header}
      {s.environment !== "production" && <div style={{ marginBottom: 16 }}><InlineAlert tone="warning" title={t("settings.environment", { env: s.environment })}>{t("settings.notProduction")}</InlineAlert></div>}
      <div className="ik-grid2" style={{ alignItems: "start" }}>
        <Card><CardHeader title={t("settings.security.title")} /><div style={{ padding: "0 24px 24px" }}>
          <KeyValueList items={[
            { label: t("settings.security.secureCookies"), value: onOff(s.security.secure_cookies) },
            { label: t("settings.security.csrf"), value: onOff(s.security.csrf_protection) },
            { label: t("settings.security.rateLimiting"), value: onOff(s.security.rate_limiting) },
            { label: t("settings.security.sessionLifetime"), value: t("settings.security.hours", { count: s.security.session_hours, n: formatNumber(s.security.session_hours) }) },
            { label: t("settings.security.maxRequestSize"), value: t("settings.security.kb", { n: formatNumber(Math.round(s.security.max_request_bytes / 1000)) }) },
            { label: t("settings.security.cors"), value: s.cors_origins.join(", ") || t("settings.security.sameOrigin") },
          ]} />
        </div></Card>
        <Card><CardHeader title={t("settings.email.title")} /><div style={{ padding: "0 24px 24px" }}>
          <KeyValueList items={[
            { label: t("settings.email.delivery"), value: s.email.backend === "smtp" ? <Badge tone="success">SMTP</Badge> : s.email.backend === "console" ? <Badge tone="warning">{t("settings.email.console")}</Badge> : <Badge tone="neutral">{t("settings.email.disabled")}</Badge> },
            { label: t("settings.email.verificationRequired"), value: s.email.verification_required ? t("common:state.yes") : t("common:state.no") },
            { label: t("settings.email.appUrl"), value: s.app_base_url },
          ]} />
          {!s.email.delivers_email && <div style={{ marginTop: 12 }}><InlineAlert tone="info">{t("settings.email.notDelivered")}</InlineAlert></div>}
        </div></Card>
        <Card><CardHeader title={t("settings.ai.title")} /><div style={{ padding: "0 24px 24px" }}>
          <KeyValueList items={[
            { label: t("settings.ai.provider"), value: s.ai.configured ? s.ai.provider : <Badge tone="warning">{t("settings.ai.builtIn")}</Badge> },
            { label: t("settings.ai.model"), value: s.ai.model ?? t("common:state.none") },
          ]} />
        </div></Card>
        <Card><CardHeader title={t("settings.payments.title")} /><div style={{ padding: "0 24px 24px" }}>
          <KeyValueList items={[
            { label: t("settings.payments.provider"), value: s.payments.provider ?? t("settings.payments.none") },
            { label: t("settings.payments.webhooks"), value: on(s.payments.configured, t("common:state.yes"), t("common:state.no")) },
            { label: t("settings.payments.checkout"), value: on(s.payments.checkout_available, t("settings.payments.available"), t("settings.payments.notAvailable")) },
            { label: t("settings.payments.termsVersion"), value: s.terms_version },
          ]} />
          <p style={{ marginTop: 12, fontSize: 13, color: "var(--color-neutral-600)" }}>
            {/* The API's note is English; the status it describes is shown from the structured flags instead. */}
            {s.payments.checkout_available ? t("settings.payments.noteCheckout") : s.payments.configured ? t("settings.payments.noteConfigured") : t("settings.payments.noteNotConfigured")}
          </p>
        </div></Card>
      </div>
    </>
  );
}
