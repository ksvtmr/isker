import { Badge, Button, Card, CardHeader, Checkbox, ConfirmActionDialog, InlineAlert, KeyValueList, LanguageSelect, PasswordInput } from "@isker/design-system";
import { PageHeader } from "../components/PageTitle";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  authApi, messageText, useChangePassword, useDeactivateAccount, useGoogleUnlink, useMe, useProviders, useResendVerification,
  useRevokeOtherSessions, useRevokeSession, useSessions, useSetPassword,
} from "../api/auth";
import { downloadExport, featureLabel, useMySubscription } from "../api/billing";
import { errorMessage, isUpgradeRequired } from "../api/client";
import { useProfile, useUpdateProfile } from "../api/profile";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { useToast } from "../components/Toaster";
import { changePasswordSchema, resetSchema } from "../features/schemas";
import type { Language } from "../i18n/config";
import { useFieldError } from "../i18n/useFieldError";
import { useLanguage } from "../i18n/useLanguage";
import { formatDate } from "../utils/format";

type PwValues = { current_password: string; new_password: string; confirm: string };
type SetPwValues = { new_password: string; confirm: string };

export function SettingsPage() {
  const { t } = useTranslation(["auth", "common"]);
  const fe = useFieldError();
  const { data: me } = useMe();
  const profile = useProfile();
  const update = useUpdateProfile();
  const changePw = useChangePassword();
  const setPw = useSetPassword();
  const resend = useResendVerification();
  const sessions = useSessions();
  const revokeOne = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const providers = useProviders();
  const unlink = useGoogleUnlink();
  const sub = useMySubscription();
  const close = useDeactivateAccount();
  const lang = useLanguage();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [closing, setClosing] = useState(false);
  const [closePw, setClosePw] = useState("");
  const [linking, setLinking] = useState<{ busy: boolean; error: unknown }>({ busy: false, error: null });
  const [exportState, setExportState] = useState<{ busy: boolean; error: unknown }>({ busy: false, error: null });
  const pw = useForm<PwValues>({ resolver: zodResolver(changePasswordSchema) });
  const spw = useForm<SetPwValues>({ resolver: zodResolver(resetSchema) });
  const oauthError = params.get("oauth_error");

  // Back from Google's consent screen (?google=linked): confirm once, then clean the URL.
  useEffect(() => {
    if (params.get("google") === "linked") {
      toast({ title: t("settings.google.linkedToast") });
      const nextParams = new URLSearchParams(params);
      nextParams.delete("google");
      setParams(nextParams, { replace: true });
    }
  }, [params, setParams, t, toast]);

  if (profile.isLoading) return <PageSkeleton cards={0} chart={false} />;
  if (profile.error || !profile.data) return <><PageHeader title={t("settings.title")} /><ErrorState error={profile.error} onRetry={() => profile.refetch()} /></>;
  const p = profile.data;
  const pwLabels = { showLabel: t("password.show"), hideLabel: t("password.hide") };
  const save = (body: Parameters<typeof update.mutate>[0], msg: string) => update.mutate(body, { onSuccess: () => toast({ title: msg }) });
  const doExport = async () => {
    setExportState({ busy: true, error: null });
    try {
      await downloadExport();
      setExportState({ busy: false, error: null });
    } catch (e) {
      setExportState({ busy: false, error: e });
    }
  };
  const linkGoogle = async () => {
    setLinking({ busy: true, error: null });
    try {
      const { url } = await authApi.googleLink();
      window.location.assign(url);
    } catch (e) {
      setLinking({ busy: false, error: e });
    }
  };
  const deviceName = (ua: string | null): string => {
    if (!ua) return t("settings.sessions.unknownDevice");
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : t("settings.sessions.browser");
    const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    return os ? t("settings.sessions.deviceOn", { browser, os }) : browser;
  };
  const hasPassword = me?.has_password !== false;

  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 760 }}>
        {update.error && <InlineAlert>{errorMessage(update.error)}</InlineAlert>}

        <Card>
          <CardHeader title={t("settings.account.title")} />
          <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
            <KeyValueList items={[
              { label: t("fields.email"), value: <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{me?.email}{me?.email_verified ? <Badge tone="success" icon="check">{t("settings.account.confirmed")}</Badge> : <Badge tone="warning">{t("settings.account.notConfirmed")}</Badge>}</span> },
              { label: t("settings.account.memberSince"), value: formatDate(me?.created_at) },
            ]} />
            {me && !me.email_verified && (
              <div>
                {resend.isSuccess && <InlineAlert tone="info">{messageText(resend.data)}</InlineAlert>}
                {resend.error && <InlineAlert>{errorMessage(resend.error)}</InlineAlert>}
                {!resend.isSuccess && <Button size="sm" variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>{t("settings.account.resend")}</Button>}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("settings.plan.title")} description={sub.data ? t("settings.plan.current", { plan: sub.data.plan.name }) : undefined}
            action={<LinkButton to="/plans" size="sm" variant="secondary">{t("settings.plan.compare")}</LinkButton>} />
          <div style={{ padding: "0 24px 24px" }}>
            {sub.isLoading ? <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{t("common:state.loading")}</p> : sub.error || !sub.data ? <InlineAlert>{errorMessage(sub.error)}</InlineAlert> : (
              <KeyValueList items={[
                ...(sub.data.subscription ? [
                  { label: t("settings.plan.status"), value: t(`common:subscriptionStatus.${sub.data.subscription.status}`) },
                  { label: t("settings.plan.validUntil"), value: sub.data.subscription.expires_at ? formatDate(sub.data.subscription.expires_at) : t("settings.plan.noEnd") },
                ] : []),
                ...sub.data.entitlements.filter((e) => e.kind === "limit" && e.enabled).map((e) => ({
                  label: featureLabel(e.key),
                  value: e.limit === null ? t("settings.plan.unlimited") : t("settings.plan.used", { used: e.used ?? 0, limit: e.limit, days: e.window_days }),
                })),
                ...sub.data.entitlements.filter((e) => e.kind === "flag" && !e.enabled).map((e) => ({ label: featureLabel(e.key), value: t("settings.plan.notIncluded") })),
              ]} />
            )}
          </div>
        </Card>

        {hasPassword ? (
          <Card>
            <CardHeader title={t("settings.password.title")} description={t("settings.password.description")} />
            <form noValidate style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 400 }}
              onSubmit={pw.handleSubmit(({ current_password, new_password }) => changePw.mutate({ current_password, new_password }, { onSuccess: (r) => { pw.reset(); toast({ title: t("settings.password.updated"), description: messageText(r) }); sessions.refetch(); } }))}>
              {changePw.error && <InlineAlert>{errorMessage(changePw.error)}</InlineAlert>}
              <PasswordInput label={t("fields.currentPassword")} autoComplete="current-password" {...pwLabels} {...pw.register("current_password")} error={fe(pw.formState.errors.current_password?.message)} />
              <PasswordInput label={t("fields.newPassword")} autoComplete="new-password" hint={t("password.hint")} {...pwLabels} {...pw.register("new_password")} error={fe(pw.formState.errors.new_password?.message)} />
              <PasswordInput label={t("fields.confirmNewPassword")} autoComplete="new-password" {...pwLabels} {...pw.register("confirm")} error={fe(pw.formState.errors.confirm?.message)} />
              <div><Button type="submit" variant="secondary" loading={changePw.isPending}>{t("settings.password.submit")}</Button></div>
            </form>
          </Card>
        ) : (
          <Card>
            <CardHeader title={t("settings.password.setTitle")} description={t("settings.password.setDescription")} />
            <form noValidate style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 400 }}
              onSubmit={spw.handleSubmit(({ new_password }) => setPw.mutate(new_password, { onSuccess: (r) => { spw.reset(); toast({ title: messageText(r) }); } }))}>
              {setPw.error && <InlineAlert>{errorMessage(setPw.error)}</InlineAlert>}
              <PasswordInput label={t("fields.newPassword")} autoComplete="new-password" hint={t("password.hint")} {...pwLabels} {...spw.register("new_password")} error={fe(spw.formState.errors.new_password?.message)} />
              <PasswordInput label={t("fields.confirmNewPassword")} autoComplete="new-password" {...pwLabels} {...spw.register("confirm")} error={fe(spw.formState.errors.confirm?.message)} />
              <div><Button type="submit" variant="secondary" loading={setPw.isPending}>{t("settings.password.setSubmit")}</Button></div>
            </form>
          </Card>
        )}

        <Card>
          <CardHeader title={t("settings.google.title")} description={t("settings.google.description")}
            action={me?.google_linked
              ? <Button size="sm" variant="ghost" disabled={!hasPassword} loading={unlink.isPending}
                  aria-describedby={!hasPassword ? "google-unlink-hint" : undefined}
                  onClick={() => unlink.mutate(undefined, { onSuccess: () => toast({ title: t("settings.google.unlinkedToast") }) })}>{t("settings.google.unlink")}</Button>
              : providers.data?.google
                ? <Button size="sm" variant="secondary" loading={linking.busy} onClick={linkGoogle}>{t("settings.google.link")}</Button>
                : undefined} />
          <div style={{ padding: "0 24px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div>{me?.google_linked ? <Badge tone="success" icon="check">{t("settings.google.linked")}</Badge> : <Badge>{t("settings.google.notLinked")}</Badge>}</div>
            {oauthError && <InlineAlert>{t(`errors:${oauthError}`, { defaultValue: t("errors:OAUTH_FAILED") })}</InlineAlert>}
            {(linking.error || unlink.error) && <InlineAlert>{errorMessage(linking.error ?? unlink.error)}</InlineAlert>}
            {me?.google_linked && !hasPassword && <p id="google-unlink-hint" className="isk-hint">{t("settings.google.unlinkNeedsPassword")}</p>}
            {!me?.google_linked && providers.isSuccess && !providers.data.google && <p className="isk-hint">{t("settings.google.unavailable")}</p>}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("settings.sessions.title")} description={t("settings.sessions.description")}
            action={sessions.data && sessions.data.length > 1 ? <Button size="sm" variant="secondary" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate(undefined, { onSuccess: (r) => toast({ title: messageText(r) }) })}>{t("settings.sessions.signOutOthers")}</Button> : undefined} />
          <div style={{ padding: "0 24px 16px" }}>
            {(revokeOne.error || revokeOthers.error) && <InlineAlert>{errorMessage(revokeOne.error ?? revokeOthers.error)}</InlineAlert>}
            {sessions.isLoading ? <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{t("common:state.loading")}</p> : sessions.error ? <InlineAlert>{errorMessage(sessions.error)}</InlineAlert> : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {sessions.data?.map((s) => (
                  <li key={s.id} className="ik-list-row">
                    <span>
                      <b style={{ fontWeight: 500 }}>{deviceName(s.user_agent)}</b>{" "}
                      {s.current && <Badge tone="brand">{t("settings.sessions.thisDevice")}</Badge>}{" "}
                      {s.remember && <Badge>{t("settings.sessions.remembered")}</Badge>}{" "}
                      {s.auth_method === "google" && <Badge>{t("settings.sessions.viaGoogle")}</Badge>}
                      <span style={{ display: "block", fontSize: 13, color: "var(--color-neutral-500)" }}>
                        {t("settings.sessions.meta", { created: formatDate(s.created_at), seen: formatDate(s.last_seen_at ?? s.created_at) })}
                      </span>
                    </span>
                    {!s.current && (
                      <Button size="sm" variant="ghost" aria-label={t("settings.sessions.signOutAria", { device: deviceName(s.user_agent), date: formatDate(s.created_at) })}
                        loading={revokeOne.isPending && revokeOne.variables === s.id}
                        onClick={() => revokeOne.mutate(s.id, { onSuccess: () => toast({ title: t("settings.sessions.signedOut") }) })}>{t("settings.sessions.signOut")}</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("settings.notifications.title")} description={t("settings.notifications.description")} />
          <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
            <Checkbox label={t("settings.notifications.reassessment")} checked={p.notify_reassessment} onChange={(e) => save({ notify_reassessment: e.target.checked }, t("settings.notifications.saved"))} />
            <Checkbox label={t("settings.notifications.weekly")} description={t("settings.notifications.weeklyHint")} checked={p.notify_weekly_summary} onChange={(e) => save({ notify_weekly_summary: e.target.checked }, t("settings.notifications.saved"))} />
          </div>
        </Card>

        <Card>
          <CardHeader title={t("settings.language.title")} description={t("settings.language.hint")} />
          <div style={{ padding: "0 24px 24px", maxWidth: 280 }}>
            <LanguageSelect id="settings-language" label={t("common:language.choose")} value={lang.language} options={lang.options} onChange={(v) => lang.setLanguage(v as Language)} />
            {lang.saveError ? <div style={{ marginTop: 10 }}><InlineAlert>{t("common:language.saveFailed")}</InlineAlert></div> : null}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("settings.data.title")} description={t("settings.data.description")} action={<Button size="sm" variant="secondary" iconLeft="download" loading={exportState.busy} onClick={doExport}>{t("settings.data.download")}</Button>} />
          {exportState.error ? (
            <div style={{ padding: "0 24px 20px" }}>
              <InlineAlert>{errorMessage(exportState.error)} {isUpgradeRequired(exportState.error) && <LinkButton to="/plans" size="sm" variant="secondary">{t("settings.data.seePlans")}</LinkButton>}</InlineAlert>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title={t("settings.close.title")} description={t("settings.close.description")}
            action={<Button variant="danger" size="sm" onClick={() => { setClosePw(""); setClosing(true); }}>{t("settings.close.button")}</Button>} />
        </Card>
      </div>
      <ConfirmActionDialog open={closing} title={t("settings.close.dialogTitle")} confirmLabel={t("settings.close.button")} busy={close.isPending} confirmDisabled={hasPassword && !closePw}
        description={hasPassword ? t("settings.close.dialogDescription") : t("settings.close.dialogDescriptionNoPassword")}
        error={close.error ? errorMessage(close.error) : undefined}
        onCancel={() => setClosing(false)}
        onConfirm={() => close.mutate(closePw, { onSuccess: () => navigate("/", { replace: true }) })}>
        {hasPassword && <PasswordInput label={t("fields.password")} autoComplete="current-password" {...pwLabels} value={closePw} onChange={(e) => setClosePw(e.target.value)} />}
      </ConfirmActionDialog>
    </>
  );
}
