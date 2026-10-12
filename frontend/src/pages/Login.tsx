import { Button, Checkbox, Divider, InlineAlert, Input, PasswordInput } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLogin } from "../api/auth";
import { errorMessage } from "../api/client";
import { AuthFrame } from "../components/AuthFrame";
import { GoogleButton } from "../components/GoogleButton";
import { loginSchema, type LoginValues } from "../features/schemas";
import { useFieldError } from "../i18n/useFieldError";
import { homeFor } from "../layouts/guards";

/** Days a remembered session lasts (backend REMEMBER_ME_DAYS default); used only in the checkbox hint. */
const REMEMBER_DAYS = 30;

function safeNext(raw: string | null): string | null {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : null;
}

export function LoginPage() {
  const { t } = useTranslation("auth");
  const fe = useFieldError();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get("next"));
  const oauthError = params.get("oauth_error");
  const { register, handleSubmit, watch, formState: { errors } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { remember_me: false },
  });
  const remember = watch("remember_me");

  const onSubmit = (v: LoginValues) =>
    login.mutate(v, {
      onSuccess: ({ user }) => navigate(next ?? homeFor(user), { replace: true }),
    });

  return (
    <AuthFrame
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      footer={<>{t("login.noAccount")} <Link to="/register">{t("login.register")}</Link></>}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {login.error ? <InlineAlert>{errorMessage(login.error)}</InlineAlert>
          : oauthError ? <InlineAlert>{t(`errors:${oauthError}`, { defaultValue: t("errors:OAUTH_FAILED") })}</InlineAlert> : null}
        <Input label={t("fields.email")} type="email" autoComplete="email" inputMode="email" {...register("email")} error={fe(errors.email?.message)} />
        <PasswordInput label={t("fields.password")} autoComplete="current-password" showLabel={t("password.show")} hideLabel={t("password.hide")}
          {...register("password")} error={fe(errors.password?.message)} />
        <div className="ik-auth__row">
          <Checkbox label={t("login.remember")} description={t("login.rememberHint", { days: REMEMBER_DAYS })} {...register("remember_me")} />
          <Link to="/forgot-password">{t("login.forgot")}</Link>
        </div>
        <Button type="submit" size="lg" fullWidth loading={login.isPending}>{t("login.submit")}</Button>
      </form>
      <div style={{ margin: "20px 0 16px" }}><Divider label={t("login.or")} /></div>
      <GoogleButton next={next} remember={!!remember} />
    </AuthFrame>
  );
}
