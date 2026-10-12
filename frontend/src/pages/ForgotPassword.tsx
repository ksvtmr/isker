import { Button, InlineAlert, Input } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { authApi, messageText } from "../api/auth";
import { errorMessage } from "../api/client";
import { AuthFrame } from "../components/AuthFrame";
import { forgotSchema } from "../features/schemas";
import { useFieldError } from "../i18n/useFieldError";

export function ForgotPasswordPage() {
  const { t } = useTranslation("auth");
  const fe = useFieldError();
  const send = useMutation({ mutationFn: authApi.forgotPassword });
  const { register, handleSubmit, formState: { errors } } = useForm<{ email: string }>({ resolver: zodResolver(forgotSchema) });
  return (
    <AuthFrame title={t("forgot.title")} subtitle={t("forgot.subtitle")} footer={<Link to="/login">{t("forgot.back")}</Link>}>
      {send.isSuccess ? (
        // The response never reveals whether the account exists, and says so honestly when email isn't configured.
        <InlineAlert tone="success" title={t("forgot.sent")}>{messageText(send.data)}</InlineAlert>
      ) : (
        <form onSubmit={handleSubmit((v) => send.mutate(v.email))} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {send.error && <InlineAlert>{errorMessage(send.error)}</InlineAlert>}
          <Input label={t("fields.email")} type="email" autoComplete="email" inputMode="email" {...register("email")} error={fe(errors.email?.message)} />
          <Button type="submit" size="lg" fullWidth loading={send.isPending}>{t("forgot.submit")}</Button>
        </form>
      )}
    </AuthFrame>
  );
}
