import { Button, InlineAlert } from "@isker/design-system";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { messageText, useResendVerification } from "../api/auth";
import { errorMessage } from "../api/client";
import type { User, VerificationState } from "../types/api";

const DISMISS_KEY = "isker.verify-banner-dismissed";

/** Honest description of what happened with the confirmation email right after registration. */
export function VerificationResult({ state, email }: { state: VerificationState | string | null; email?: string }) {
  const { t } = useTranslation("public");
  if (state === "sent") {
    return <InlineAlert tone="info" title={t("notices.sentTitle")}>{email ? t("notices.sentTo", { email }) : t("notices.sentNoEmail")}</InlineAlert>;
  }
  if (state === "logged") {
    return <InlineAlert tone="warning" title={t("notices.devTitle")}>{t("notices.devText")}</InlineAlert>;
  }
  if (state === "unavailable") return <InlineAlert tone="info">{t("notices.unavailable")}</InlineAlert>;
  return null;
}

/** Banner for signed-in users whose email isn't confirmed yet. The result message always comes from the server. */
export function EmailVerificationBanner({ user }: { user: User }) {
  const { t } = useTranslation("public");
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
      <InlineAlert tone={resend.error ? "error" : "info"} title={t("notices.bannerTitle")}>
        {resend.isSuccess ? messageText(resend.data) : resend.error ? errorMessage(resend.error) : t("notices.bannerText", { email: user.email })}
        <span style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {!resend.isSuccess && <Button size="sm" variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>{t("notices.resend")}</Button>}
          <Button size="sm" variant="ghost" onClick={dismiss}>{t("notices.hide")}</Button>
        </span>
      </InlineAlert>
    </div>
  );
}
