import { Badge, Button, Card, CardHeader, Checkbox, ConfirmActionDialog, InlineAlert, Input, KeyValueList, PageHeader, Select } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useChangePassword, useDeactivateAccount, useMe, useResendVerification, useRevokeOtherSessions, useRevokeSession, useSessions } from "../api/auth";
import { downloadExport, useMySubscription } from "../api/billing";
import { errorMessage, isUpgradeRequired } from "../api/client";
import { useProfile, useUpdateProfile } from "../api/profile";
import { LinkButton } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { useToast } from "../components/Toaster";
import { changePasswordSchema } from "../features/schemas";
import { formatDate } from "../utils/format";

type PwValues = { current_password: string; new_password: string; confirm: string };

function deviceName(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function SettingsPage() {
  const { data: me } = useMe();
  const profile = useProfile();
  const update = useUpdateProfile();
  const changePw = useChangePassword();
  const resend = useResendVerification();
  const sessions = useSessions();
  const revokeOne = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const sub = useMySubscription();
  const close = useDeactivateAccount();
  const toast = useToast();
  const navigate = useNavigate();
  const [closing, setClosing] = useState(false);
  const [closePw, setClosePw] = useState("");
  const [exportState, setExportState] = useState<{ busy: boolean; error: unknown }>({ busy: false, error: null });
  const pw = useForm<PwValues>({ resolver: zodResolver(changePasswordSchema) });

  if (profile.isLoading) return <PageSkeleton cards={0} chart={false} />;
  if (profile.error || !profile.data) return <><PageHeader title="Settings" /><ErrorState error={profile.error} onRetry={() => profile.refetch()} /></>;
  const p = profile.data;
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

  return (
    <>
      <PageHeader title="Settings" subtitle="Your account, plan, security and data." />
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 760 }}>
        {update.error && <InlineAlert>{errorMessage(update.error)}</InlineAlert>}

        <Card>
          <CardHeader title="Account" />
          <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
            <KeyValueList items={[
              { label: "Email", value: <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{me?.email}{me?.email_verified ? <Badge tone="success" icon="check">Confirmed</Badge> : <Badge tone="warning">Not confirmed</Badge>}</span> },
              { label: "Member since", value: formatDate(me?.created_at) },
            ]} />
            {me && !me.email_verified && (
              <div>
                {resend.isSuccess && <InlineAlert tone="info">{resend.data.message}</InlineAlert>}
                {resend.error && <InlineAlert>{errorMessage(resend.error)}</InlineAlert>}
                {!resend.isSuccess && <Button size="sm" variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>Resend confirmation email</Button>}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Plan and usage" description={sub.data ? `You're on the ${sub.data.plan.name} plan.` : undefined} action={<LinkButton to="/plans" size="sm" variant="secondary">Compare plans</LinkButton>} />
          <div style={{ padding: "0 24px 24px" }}>
            {sub.isLoading ? <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>Loading…</p> : sub.error || !sub.data ? <InlineAlert>{errorMessage(sub.error)}</InlineAlert> : (
              <KeyValueList items={[
                ...(sub.data.subscription ? [{ label: "Status", value: sub.data.subscription.status.replace("_", " ") }, { label: "Valid until", value: sub.data.subscription.expires_at ? formatDate(sub.data.subscription.expires_at) : "No end date" }] : []),
                ...sub.data.entitlements.filter((e) => e.kind === "limit" && e.enabled).map((e) => ({ label: e.label, value: e.limit === null ? "Unlimited" : `${e.used ?? 0} of ${e.limit} used (last ${e.window_days} days)` })),
                ...sub.data.entitlements.filter((e) => e.kind === "flag" && !e.enabled).map((e) => ({ label: e.label, value: "Not included" })),
              ]} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Password" description="Changing your password signs you out on your other devices." />
          <form noValidate style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 400 }}
            onSubmit={pw.handleSubmit(({ current_password, new_password }) => changePw.mutate({ current_password, new_password }, { onSuccess: (r) => { pw.reset(); toast({ title: "Password updated", description: r.message }); sessions.refetch(); } }))}>
            {changePw.error && <InlineAlert>{errorMessage(changePw.error)}</InlineAlert>}
            <Input label="Current password" type="password" autoComplete="current-password" {...pw.register("current_password")} error={pw.formState.errors.current_password?.message} />
            <Input label="New password" type="password" autoComplete="new-password" {...pw.register("new_password")} error={pw.formState.errors.new_password?.message} />
            <Input label="Confirm new password" type="password" autoComplete="new-password" {...pw.register("confirm")} error={pw.formState.errors.confirm?.message} />
            <div><Button type="submit" variant="secondary" loading={changePw.isPending}>Update password</Button></div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Signed-in devices" description="Sign out of devices you don't recognise."
            action={sessions.data && sessions.data.length > 1 ? <Button size="sm" variant="secondary" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate(undefined, { onSuccess: (r) => toast({ title: r.message }) })}>Sign out other devices</Button> : undefined} />
          <div style={{ padding: "0 24px 16px" }}>
            {(revokeOne.error || revokeOthers.error) && <InlineAlert>{errorMessage(revokeOne.error ?? revokeOthers.error)}</InlineAlert>}
            {sessions.isLoading ? <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>Loading…</p> : sessions.error ? <InlineAlert>{errorMessage(sessions.error)}</InlineAlert> : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {sessions.data?.map((s) => (
                  <li key={s.id} className="ik-list-row">
                    <span>
                      <b style={{ fontWeight: 500 }}>{deviceName(s.user_agent)}</b> {s.current && <Badge tone="brand">This device</Badge>}
                      <span style={{ display: "block", fontSize: 13, color: "var(--color-neutral-500)" }}>Signed in {formatDate(s.created_at)} · last active {formatDate(s.last_seen_at ?? s.created_at)}</span>
                    </span>
                    {!s.current && <Button size="sm" variant="ghost" aria-label={`Sign out ${deviceName(s.user_agent)} (signed in ${formatDate(s.created_at)})`} loading={revokeOne.isPending && revokeOne.variables === s.id} onClick={() => revokeOne.mutate(s.id, { onSuccess: () => toast({ title: "Device signed out" }) })}>Sign out</Button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Notifications" description="In-app notifications about your development." />
          <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
            <Checkbox label="Remind me when a reassessment is available" checked={p.notify_reassessment} onChange={(e) => save({ notify_reassessment: e.target.checked }, "Notification settings saved")} />
            <Checkbox label="Weekly progress summary" description="Shown in your notifications on Mondays" checked={p.notify_weekly_summary} onChange={(e) => save({ notify_weekly_summary: e.target.checked }, "Notification settings saved")} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Language" />
          <div style={{ padding: "0 24px 24px", maxWidth: 280 }}>
            <Select label="Interface language" value={p.language} onChange={(e) => save({ language: e.target.value }, "Language saved")}
              options={[{ value: "en", label: "English" }, { value: "ru", label: "Русский" }, { value: "kk", label: "Қазақша" }]} hint="The interface is in English; Russian and Kazakh are in preparation." />
          </div>
        </Card>

        <Card>
          <CardHeader title="Your data" description="Download everything Isker stores about you as a JSON file." action={<Button size="sm" variant="secondary" iconLeft="download" loading={exportState.busy} onClick={doExport}>Download my data</Button>} />
          {exportState.error ? (
            <div style={{ padding: "0 24px 20px" }}>
              <InlineAlert>{errorMessage(exportState.error)} {isUpgradeRequired(exportState.error) && <LinkButton to="/plans" size="sm" variant="secondary">See plans</LinkButton>}</InlineAlert>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Close account" description="You'll be signed out everywhere and won't be able to sign in. Your data is kept so support can restore the account; ask support if you want it permanently deleted."
            action={<Button variant="danger" size="sm" onClick={() => { setClosePw(""); setClosing(true); }}>Close account</Button>} />
        </Card>
      </div>
      <ConfirmActionDialog open={closing} title="Close your account?" confirmLabel="Close account" busy={close.isPending} confirmDisabled={!closePw}
        description="Enter your password to confirm. You'll be signed out on all devices."
        error={close.error ? errorMessage(close.error) : undefined}
        onCancel={() => setClosing(false)}
        onConfirm={() => close.mutate(closePw, { onSuccess: () => navigate("/", { replace: true }) })}>
        <Input label="Password" type="password" autoComplete="current-password" value={closePw} onChange={(e) => setClosePw(e.target.value)} />
      </ConfirmActionDialog>
    </>
  );
}
