import { Button, InlineAlert, PasswordInput } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { authApi, messageText } from "../api/auth";
import { errorMessage } from "../api/client";
import { AuthFrame } from "../components/AuthFrame";
import { LinkButton } from "../components/RouterLink";
import { resetSchema } from "../features/schemas";
import { useFieldError } from "../i18n/useFieldError";

export function ResetPasswordPage() {
  const { t } = useTranslation("auth");
  const fe = useFieldError();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const reset = useMutation({ mutationFn: authApi.resetPassword });
  const { register, handleSubmit, formState: { errors } } = useForm<{ new_password: string; confirm: string }>({ resolver: zodResolver(resetSchema) });
  const back = <Link to="/login">{t("forgot.back")}</Link>;
  const pw = { showLabel: t("password.show"), hideLabel: t("password.hide") };

  if (!token) {
    return (
      <AuthFrame title={t("reset.incompleteTitle")} footer={back}>
        <InlineAlert>{t("reset.incompleteBody")}</InlineAlert>
        <div style={{ marginTop: 16 }}><LinkButton to="/forgot-password" variant="secondary">{t("reset.requestNew")}</LinkButton></div>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title={t("reset.title")} subtitle={t("reset.subtitle")} footer={back}>
      {reset.isSuccess ? (
        <>
          <InlineAlert tone="success" title={t("reset.done")}>{messageText(reset.data)}</InlineAlert>
          <div style={{ marginTop: 16 }}><LinkButton to="/login" fullWidth size="lg">{t("login.submit")}</LinkButton></div>
        </>
      ) : (
        <form onSubmit={handleSubmit((v) => reset.mutate({ token, new_password: v.new_password }))} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {reset.error && (
            <InlineAlert>
              {errorMessage(reset.error)} <Link to="/forgot-password">{t("reset.requestNew")}</Link>
            </InlineAlert>
          )}
          <PasswordInput label={t("fields.newPassword")} autoComplete="new-password" hint={t("password.hint")} {...pw} {...register("new_password")} error={fe(errors.new_password?.message)} />
          <PasswordInput label={t("fields.confirmNewPassword")} autoComplete="new-password" {...pw} {...register("confirm")} error={fe(errors.confirm?.message)} />
          <Button type="submit" size="lg" fullWidth loading={reset.isPending}>{t("reset.submit")}</Button>
        </form>
      )}
    </AuthFrame>
  );
}
