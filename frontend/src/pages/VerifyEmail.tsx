import { InlineAlert, SkeletonCard } from "@isker/design-system";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { authApi, messageText, useMe } from "../api/auth";
import { errorMessage } from "../api/client";
import { keys } from "../api/keys";
import { AuthFrame } from "../components/AuthFrame";
import { LinkButton } from "../components/RouterLink";

export function VerifyEmailPage() {
  const { t } = useTranslation("auth");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const qc = useQueryClient();
  const { data: me } = useMe();
  const verify = useMutation({ mutationFn: authApi.verifyEmail, onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }) });
  const started = useRef(false);
  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  const next = me ? <LinkButton to="/dashboard">{t("verify.toDashboard")}</LinkButton> : <LinkButton to="/login">{t("login.submit")}</LinkButton>;
  return (
    <AuthFrame title={t("verify.title")}>
      {!token ? (
        <InlineAlert>{t("verify.missing")}</InlineAlert>
      ) : verify.isPending || verify.isIdle ? (
        <div aria-busy="true"><span className="isk-sr-only">{t("verify.confirming")}</span><SkeletonCard lines={2} /></div>
      ) : verify.isSuccess ? (
        <InlineAlert tone="success" title={t("verify.done")}>{messageText(verify.data)}</InlineAlert>
      ) : (
        <InlineAlert title={t("verify.failed")}>
          {errorMessage(verify.error)} {me ? t("verify.fromSettings") : t("verify.signInToRequest")}
        </InlineAlert>
      )}
      {(verify.isSuccess || verify.isError || !token) && <div style={{ marginTop: 16 }}>{next}</div>}
    </AuthFrame>
  );
}
