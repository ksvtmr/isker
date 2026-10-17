import { Button, Checkbox, Divider, InlineAlert, Input, PasswordInput } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Trans, useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useRegister } from "../api/auth";
import { ApiError, errorMessage } from "../api/client";
import { NewTabRouteLink } from "../components/ExternalLink";
import { AuthFrame } from "../components/AuthFrame";
import { GoogleButton } from "../components/GoogleButton";
import { registerSchema, type RegisterValues } from "../features/schemas";
import { currentLanguage } from "../i18n";
import { useFieldError } from "../i18n/useFieldError";

export function RegisterPage() {
  const { t } = useTranslation("auth");
  const fe = useFieldError();
  const reg = useRegister();
  const navigate = useNavigate();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { accept_terms: false },
  });

  const onSubmit = ({ confirm: _confirm, ...v }: RegisterValues) =>
    reg.mutate({ ...v, language: currentLanguage() }, {
      onSuccess: (data) => navigate(`/onboarding?verification=${data.email_verification}`, { replace: true }),
      onError: (e) => {
        if (e instanceof ApiError) {
          if (e.code === "EMAIL_TAKEN") setError("email", { message: errorMessage(e) });
          for (const [field, msg] of Object.entries(e.fieldErrors())) setError(field as keyof RegisterValues, { message: msg });
        }
      },
    });

  const showBanner = reg.error instanceof ApiError ? reg.error.code !== "EMAIL_TAKEN" && reg.error.code !== "VALIDATION_ERROR" : !!reg.error;
  const pw = { showLabel: t("password.show"), hideLabel: t("password.hide") };
  return (
    <AuthFrame title={t("register.title")} subtitle={t("register.subtitle")}
      footer={<>{t("register.haveAccount")} <Link to="/login">{t("register.signIn")}</Link></>}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {showBanner && <InlineAlert>{errorMessage(reg.error)}</InlineAlert>}
        <Input label={t("fields.fullName")} autoComplete="name" {...register("full_name")} error={fe(errors.full_name?.message)} />
        <Input label={t("fields.email")} type="email" autoComplete="email" inputMode="email" {...register("email")} error={fe(errors.email?.message)} />
        <PasswordInput label={t("fields.password")} autoComplete="new-password" hint={t("password.hint")} {...pw} {...register("password")} error={fe(errors.password?.message)} />
        <PasswordInput label={t("fields.confirmPassword")} autoComplete="new-password" {...pw} {...register("confirm")} error={fe(errors.confirm?.message)} />
        <div>
          <Checkbox
            {...register("accept_terms")}
            aria-invalid={errors.accept_terms ? true : undefined}
            aria-describedby={errors.accept_terms ? "terms-error" : undefined}
            label={<Trans t={t} i18nKey="register.terms" components={{
              terms: <NewTabRouteLink to="/terms" />,
              privacy: <NewTabRouteLink to="/privacy" />,
            }} />}
          />
          {errors.accept_terms && <p id="terms-error" className="isk-hint isk-hint--error" style={{ marginTop: 6 }}>{fe(errors.accept_terms.message)}</p>}
        </div>
        <Button type="submit" size="lg" fullWidth loading={reg.isPending}>{t("register.submit")}</Button>
      </form>
      <div style={{ margin: "20px 0 16px" }}><Divider label={t("register.or")} /></div>
      <GoogleButton next={null} remember={false} />
    </AuthFrame>
  );
}
