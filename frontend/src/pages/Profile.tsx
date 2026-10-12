import { Button, Card, CardHeader, Checkbox, InlineAlert, Input, Radio, Select, Textarea } from "@isker/design-system";
import { PageHeader } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useAssessmentOverview } from "../api/assessments";
import { errorMessage } from "../api/client";
import { useGoals, useProfile, useUpdateProfile } from "../api/profile";
import { useSpaClick } from "../components/RouterLink";
import { ErrorState, PageSkeleton } from "../components/States";
import { useToast } from "../components/Toaster";
import { educationOptions, experienceOptions, formatOptions, weeklyOptions } from "../features/options";
import { onboardingSchema, type OnboardingValues } from "../features/schemas";
import { useFieldError } from "../i18n/useFieldError";
import { formatDate } from "../utils/format";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <Card><CardHeader title={title} description={description} /><div style={{ padding: "0 24px 24px" }}>{children}</div></Card>;
}

export function ProfilePage() {
  const { t } = useTranslation("account");
  const fe = useFieldError();
  const profile = useProfile();
  const goals = useGoals();
  const history = useAssessmentOverview();
  const update = useUpdateProfile();
  const toast = useToast();
  const spa = useSpaClick();
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isDirty } } = useForm<OnboardingValues>({ resolver: zodResolver(onboardingSchema) });

  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    reset({
      full_name: p.full_name, education: p.education ?? "", background: p.background ?? "", entrepreneurial_experience: p.entrepreneurial_experience,
      business_experience: p.business_experience ?? "", goal_codes: p.goals.map((g) => g.code), preferred_learning_format: p.preferred_learning_format,
      weekly_learning_minutes: p.weekly_learning_minutes,
    });
  }, [profile.data, reset]);

  if (profile.isLoading) return <PageSkeleton chart={false} />;
  if (profile.error || !profile.data) return <><PageHeader title={t("profile.title")} /><ErrorState error={profile.error} onRetry={() => profile.refetch()} /></>;
  const sel = watch("goal_codes") ?? [];
  const weekly = weeklyOptions();
  const weeklyOpts = weekly.some((o) => o.value === String(profile.data.weekly_learning_minutes)) ? weekly
    : [...weekly, { value: String(profile.data.weekly_learning_minutes), label: t("common:time.minutes", { count: profile.data.weekly_learning_minutes }) }];
  const onSubmit = (v: OnboardingValues) => update.mutate(v, { onSuccess: () => toast({ title: t("profile.savedTitle"), description: t("profile.savedDescription") }) });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <PageHeader title={t("profile.title")} subtitle={profile.data.email} action={<Button type="submit" loading={update.isPending} disabled={!isDirty}>{t("common:actions.saveChanges")}</Button>} />
      {update.error && <div style={{ marginBottom: 16 }}><InlineAlert>{errorMessage(update.error)}</InlineAlert></div>}
      <div className="ik-grid2" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Section title={t("profile.personal")}>
            <div className="ik-form2">
              <Input label={t("profile.fullName")} autoComplete="name" {...register("full_name")} error={fe(errors.full_name?.message)} />
              <Input label={t("profile.email")} type="email" value={profile.data.email} readOnly disabled hint={t("profile.emailHint")} />
              <Select label={t("profile.education")} placeholder={t("options.placeholder")} options={educationOptions()} {...register("education")} error={fe(errors.education?.message)} />
              <Select label={t("profile.experience")} options={experienceOptions()} {...register("entrepreneurial_experience")} error={fe(errors.entrepreneurial_experience?.message)} />
            </div>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <Textarea label={t("profile.background")} rows={3} maxLength={1000} value={watch("background") ?? ""} {...register("background")} />
              <Textarea label={t("profile.businessExperience")} rows={3} maxLength={1000} value={watch("business_experience") ?? ""} {...register("business_experience")} />
            </div>
          </Section>
          <Section title={t("profile.goals")} description={t("profile.goalsDescription")}>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              <legend className="isk-sr-only">{t("profile.goalsLegend")}</legend>
              {goals.data?.map((g) => (
                <Checkbox key={g.code} label={g.title} checked={sel.includes(g.code)}
                  onChange={(e) => setValue("goal_codes", e.target.checked ? [...sel, g.code] : sel.filter((c) => c !== g.code), { shouldDirty: true, shouldValidate: true })} />
              ))}
              {errors.goal_codes && <span className="isk-hint isk-hint--error" role="alert">{fe(errors.goal_codes.message)}</span>}
            </fieldset>
          </Section>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Section title={t("profile.learning")}>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              <legend className="isk-label" style={{ marginBottom: 12 }}>{t("profile.format")}</legend>
              {formatOptions().map((o) => <Radio key={o.value} value={o.value} label={o.label} {...register("preferred_learning_format")} />)}
            </fieldset>
            <div style={{ marginTop: 16, maxWidth: 260 }}><Select label={t("profile.weekly")} options={weeklyOpts} {...register("weekly_learning_minutes")} /></div>
          </Section>
          <Section title={t("profile.history")}>
            {history.data?.completed.length ? (
              <div className="ik-table-wrap">
                <table className="ik-table">
                  <thead><tr><th>{t("profile.historyAssessment")}</th><th>{t("profile.historyDate")}</th><th className="num">{t("profile.historyScore")}</th></tr></thead>
                  <tbody>{history.data.completed.map((a) => (
                    <tr key={a.id}>
                      <td><a className="ik-link" href={`/results?attempt=${a.id}`} onClick={spa(`/results?attempt=${a.id}`)}>{a.scope === "competency" ? t("profile.reassessmentOf", { name: a.competency?.name ?? "" }) : t("profile.assessmentNumber", { n: a.sequence })}</a></td>
                      <td>{formatDate(a.completed_at)}</td><td className="num" style={{ fontWeight: 600 }}>{a.overall_score}</td>
                    </tr>))}
                  </tbody>
                </table>
              </div>
            ) : <p style={{ fontSize: 14, color: "var(--color-neutral-500)" }}>{t("profile.historyEmpty")}</p>}
          </Section>
        </div>
      </div>
    </form>
  );
}
