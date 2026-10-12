import { Button, Card, Checkbox, InlineAlert, Input, Radio, Select, Textarea, Wordmark } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useMe } from "../api/auth";
import { errorMessage } from "../api/client";
import { useGoals, useOnboarding } from "../api/profile";
import { educationOptions, experienceOptions, formatOptions, weeklyOptions } from "../features/options";
import { onboardingSchema, type OnboardingValues } from "../features/schemas";
import { useFieldError } from "../i18n/useFieldError";

const STEPS = [
  { id: "about", fields: ["full_name", "education", "background"] },
  { id: "experience", fields: ["entrepreneurial_experience", "business_experience"] },
  { id: "goals", fields: ["goal_codes", "preferred_learning_format", "weekly_learning_minutes"] },
] as const;

export function OnboardingPage() {
  const { t } = useTranslation("account");
  const fe = useFieldError();
  const { data: me } = useMe();
  const goals = useGoals();
  const save = useOnboarding();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { full_name: me?.full_name ?? "", education: "", goal_codes: [], preferred_learning_format: "mixed", weekly_learning_minutes: 60 },
  });
  const { register, handleSubmit, trigger, watch, setValue, formState: { errors } } = form;
  const selectedGoals = watch("goal_codes");
  const stepTitles = [t("onboarding.steps.about"), t("onboarding.steps.experience"), t("onboarding.steps.goals")];

  const next = async () => {
    if (await trigger(STEPS[step].fields as unknown as (keyof OnboardingValues)[])) setStep((s) => s + 1);
  };
  const onSubmit = (v: OnboardingValues) => save.mutate(v, { onSuccess: () => navigate("/assessment", { replace: true }) });
  const toggleGoal = (code: string, on: boolean) =>
    setValue("goal_codes", on ? [...selectedGoals, code] : selectedGoals.filter((g) => g !== code), { shouldValidate: true });

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px 80px" }}>
      <Wordmark size={22} />
      <div style={{ marginTop: 28 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-neutral-500)" }}>{t("onboarding.stepOf", { current: step + 1, total: STEPS.length })}</p>
        <div className="ik-steps" aria-hidden="true" style={{ marginTop: 8 }}>{STEPS.map((s, i) => <span key={s.id} data-on={i <= step} />)}</div>
        <h1 style={{ marginTop: 20, fontSize: "var(--text-2xl)", fontWeight: 600, letterSpacing: "-0.02em" }}>{stepTitles[step]}</h1>
        <p style={{ marginTop: 6, fontSize: 14, color: "var(--color-neutral-500)" }}>
          {step === 0 && t("onboarding.intro.about")}
          {step === 1 && t("onboarding.intro.experience")}
          {step === 2 && t("onboarding.intro.goals")}
        </p>
      </div>
      <Card padding={28} style={{ marginTop: 24 }}>
        <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {save.error && <InlineAlert>{errorMessage(save.error)}</InlineAlert>}
          {step === 0 && (
            <>
              <Input label={t("onboarding.fullName")} autoComplete="name" {...register("full_name")} error={fe(errors.full_name?.message)} />
              <Select label={t("onboarding.education")} placeholder={t("options.placeholder")} options={educationOptions()} {...register("education")} error={fe(errors.education?.message)} />
              <Textarea label={t("onboarding.background")} rows={3} maxLength={1000} value={watch("background") ?? ""} placeholder={t("onboarding.backgroundPlaceholder")} {...register("background")} />
            </>
          )}
          {step === 1 && (
            <>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                <legend className="isk-label" style={{ marginBottom: 12 }}>{t("onboarding.experience")}</legend>
                {experienceOptions().map((o) => <Radio key={o.value} value={o.value} label={o.label} {...register("entrepreneurial_experience")} />)}
                {errors.entrepreneurial_experience && <span className="isk-hint isk-hint--error" role="alert">{fe(errors.entrepreneurial_experience.message)}</span>}
              </fieldset>
              <Textarea label={t("onboarding.businessExperience")} rows={3} maxLength={1000} value={watch("business_experience") ?? ""} placeholder={t("onboarding.businessExperiencePlaceholder")} {...register("business_experience")} />
            </>
          )}
          {step === 2 && (
            <>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                <legend className="isk-label" style={{ marginBottom: 12 }}>{t("onboarding.goals")}</legend>
                {goals.isLoading && <span className="isk-hint">{t("onboarding.loadingGoals")}</span>}
                {goals.error && <InlineAlert>{errorMessage(goals.error)}</InlineAlert>}
                {goals.data?.map((g) => (
                  <Checkbox key={g.code} label={g.title} description={g.description ?? undefined} checked={selectedGoals.includes(g.code)} onChange={(e) => toggleGoal(g.code, e.target.checked)} />
                ))}
                {errors.goal_codes && <span className="isk-hint isk-hint--error" role="alert">{fe(errors.goal_codes.message)}</span>}
              </fieldset>
              <Select label={t("onboarding.format")} options={formatOptions()} {...register("preferred_learning_format")} error={fe(errors.preferred_learning_format?.message)} />
              <Select label={t("onboarding.weekly")} options={weeklyOptions()} {...register("weekly_learning_minutes")} error={fe(errors.weekly_learning_minutes?.message)} />
            </>
          )}
          <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 12 }}>
            <Button variant="secondary" iconLeft="arrow-left" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>{t("common:actions.back")}</Button>
            {step < STEPS.length - 1 ? (
              <Button iconRight="arrow-right" onClick={next}>{t("common:actions.continue")}</Button>
            ) : (
              <Button type="submit" iconRight="arrow-right" loading={save.isPending}>{t("onboarding.submit")}</Button>
            )}
          </div>
        </form>
      </Card>
    </main>
  );
}
