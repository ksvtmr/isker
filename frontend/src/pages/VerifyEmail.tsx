import { InlineAlert, SkeletonCard } from "@isker/design-system";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { authApi, useMe } from "../api/auth";
import { errorMessage } from "../api/client";
import { keys } from "../api/keys";
import { AuthFrame } from "../components/AuthFrame";
import { LinkButton } from "../components/RouterLink";

export function VerifyEmailPage() {
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

  const next = me ? <LinkButton to="/dashboard">Go to your dashboard</LinkButton> : <LinkButton to="/login">Sign in</LinkButton>;
  return (
    <AuthFrame title="Confirm your email">
      {!token ? (
        <InlineAlert>This page needs the link from your confirmation email.</InlineAlert>
      ) : verify.isPending || verify.isIdle ? (
        <div aria-busy="true"><span className="isk-sr-only">Confirming…</span><SkeletonCard lines={2} /></div>
      ) : verify.isSuccess ? (
        <InlineAlert tone="success" title="Email confirmed">{verify.data.message}</InlineAlert>
      ) : (
        <InlineAlert title="We couldn't confirm your email">
          {errorMessage(verify.error)} {me ? "You can request a new link from your settings." : "Sign in to request a new link."}
        </InlineAlert>
      )}
      {(verify.isSuccess || verify.isError || !token) && <div style={{ marginTop: 16 }}>{next}</div>}
    </AuthFrame>
  );
}
