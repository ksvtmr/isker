import { Button, InlineAlert } from "@isker/design-system";
import { useState } from "react";
import { useResendVerification } from "../api/auth";
import { errorMessage } from "../api/client";
import type { User, VerificationState } from "../types/api";

const DISMISS_KEY = "isker.verify-banner-dismissed";

/** Honest description of what happened with the confirmation email right after registration. */
export function VerificationResult({ state, email }: { state: VerificationState | string | null; email?: string }) {
  if (state === "sent") return <InlineAlert tone="info" title="Confirm your email">We've sent a confirmation link to {email ?? "your email address"}.</InlineAlert>;
  if (state === "logged") {
    return (
      <InlineAlert tone="warning" title="Email is in development mode">
        No email server is configured, so the confirmation link was written to the server log instead of being emailed.
      </InlineAlert>
    );
  }
  if (state === "unavailable") return <InlineAlert tone="info">Email confirmation isn't available on this server yet. You can use Isker normally.</InlineAlert>;
  return null;
}

/** Banner for signed-in users whose email isn't confirmed yet. The result message always comes from the server. */
export function EmailVerificationBanner({ user }: { user: User }) {
  const resend = useResendVerification();
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  if (user.email_verified || hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* storage unavailable */ }
  };
  return (
    <div style={{ marginBottom: 20 }}>
      <InlineAlert tone={resend.error ? "error" : "info"} title="Please confirm your email address">
        {resend.isSuccess ? resend.data.message : resend.error ? errorMessage(resend.error) : `Confirming ${user.email} lets you recover your account if you forget your password.`}
        <span style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {!resend.isSuccess && <Button size="sm" variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>Resend confirmation email</Button>}
          <Button size="sm" variant="ghost" onClick={dismiss}>Hide for now</Button>
        </span>
      </InlineAlert>
    </div>
  );
}
