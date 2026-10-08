import { Button, Card, CardHeader, Checkbox, InlineAlert, Input, Modal, PageHeader, Select } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useChangePassword } from "../api/auth";
import { errorMessage } from "../api/client";
import { useDeleteAccount, useProfile, useUpdateProfile } from "../api/profile";
import { ErrorState, PageSkeleton } from "../components/States";
import { useToast } from "../components/Toaster";
import { changePasswordSchema } from "../features/schemas";

type PwValues = { current_password: string; new_password: string; confirm: string };

export function SettingsPage() {
  const profile = useProfile();
  const update = useUpdateProfile();
  const changePw = useChangePassword();
  const del = useDeleteAccount();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pw = useForm<PwValues>({ resolver: zodResolver(changePasswordSchema) });

  if (profile.isLoading) return <PageSkeleton cards={0} chart={false} />;
  if (profile.error || !profile.data) return <><PageHeader title="Settings" /><ErrorState error={profile.error} onRetry={() => profile.refetch()} /></>;
  const p = profile.data;
  const save = (body: Parameters<typeof update.mutate>[0], msg: string) => update.mutate(body, { onSuccess: () => toast({ title: msg }) });

  return (
    <>
      <PageHeader title="Settings" />
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 720 }}>
        {update.error && <InlineAlert>{errorMessage(update.error)}</InlineAlert>}
        <Card>
          <CardHeader title="Notifications" description="In-app notifications about your development." />
          <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
            <Checkbox label="Remind me when a reassessment is available" checked={p.notify_reassessment} onChange={(e) => save({ notify_reassessment: e.target.checked }, "Notification settings saved")} />
            <Checkbox label="Weekly progress summary" description="Sent on Mondays" checked={p.notify_weekly_summary} onChange={(e) => save({ notify_weekly_summary: e.target.checked }, "Notification settings saved")} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Language" />
          <div style={{ padding: "0 24px 24px", maxWidth: 280 }}>
            <Select aria-label="Language" value={p.language} onChange={(e) => save({ language: e.target.value }, "Language saved")}
              options={[{ value: "en", label: "English" }, { value: "ru", label: "Русский" }, { value: "kk", label: "Қазақша" }]} hint="The interface is in English; Russian and Kazakh are in preparation." />
          </div>
        </Card>
        <Card>
          <CardHeader title="Password" />
          <form noValidate style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 400 }}
            onSubmit={pw.handleSubmit(({ current_password, new_password }) => changePw.mutate({ current_password, new_password }, { onSuccess: () => { pw.reset(); toast({ title: "Password updated" }); } }))}>
            {changePw.error && <InlineAlert>{errorMessage(changePw.error)}</InlineAlert>}
            <Input label="Current password" type="password" autoComplete="current-password" {...pw.register("current_password")} error={pw.formState.errors.current_password?.message} />
            <Input label="New password" type="password" autoComplete="new-password" {...pw.register("new_password")} error={pw.formState.errors.new_password?.message} />
            <Input label="Confirm new password" type="password" autoComplete="new-password" {...pw.register("confirm")} error={pw.formState.errors.confirm?.message} />
            <div><Button type="submit" variant="secondary" loading={changePw.isPending}>Update password</Button></div>
          </form>
        </Card>
        <Card>
          <CardHeader title="Delete account" description="Permanently removes your answers, profile, plan and progress. This can't be undone."
            action={<Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete account</Button>} />
        </Card>
      </div>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete your account?" description="Your assessments, profile, plan and reflections will be deleted permanently."
        footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" loading={del.isPending} onClick={() => del.mutate(undefined, { onSuccess: () => navigate("/", { replace: true }) })}>Delete permanently</Button></>}>
        {del.error && <InlineAlert>{errorMessage(del.error)}</InlineAlert>}
      </Modal>
    </>
  );
}
