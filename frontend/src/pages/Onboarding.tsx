import { Button, Card, Checkbox, InlineAlert, Input, Radio, Select, Textarea, Wordmark } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useMe } from "../api/auth";
import { errorMessage } from "../api/client";
import { useGoals, useOnboarding } from "../api/profile";
import { EDUCATION_OPTIONS, EXPERIENCE_OPTIONS, FORMAT_OPTIONS, WEEKLY_OPTIONS } from "../features/options";
import { onboardingSchema, type OnboardingValues } from "../features/schemas";

const STEPS = [
  { title: "About you", fields: ["full_name", "education", "background"] },
  { title: "Your experience", fields: ["entrepreneurial_experience", "business_experience"] },
  { title: "Goals and learning", fields: ["goal_codes", "preferred_learning_format", "weekly_learning_minutes"] },
] as const;

export function OnboardingPage() {
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
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-neutral-500)" }}>Step {step + 1} of {STEPS.length}</p>
        <div className="ik-steps" aria-hidden="true" style={{ marginTop: 8 }}>{STEPS.map((s, i) => <span key={s.title} data-on={i <= step} />)}</div>
        <h1 style={{ marginTop: 20, fontSize: "var(--text-2xl)", fontWeight: 600, letterSpacing: "-0.02em" }}>{STEPS[step].title}</h1>
        <p style={{ marginTop: 6, fontSize: 14, color: "var(--color-neutral-500)" }}>
          {step === 0 && "This helps us tailor examples and learning resources to you."}
          {step === 1 && "There are no wrong answers — this sets your starting point."}
          {step === 2 && "Your goals change which competencies are prioritised in your plan."}
        </p>
      </div>
      <Card padding={28} style={{ marginTop: 24 }}>
        <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {save.error && <InlineAlert>{errorMessage(save.error)}</InlineAlert>}
          {step === 0 && (
            <>
              <Input label="Full name" autoComplete="name" {...register("full_name")} error={errors.full_name?.message} />
              <Select label="Education" placeholder="Choose…" options={EDUCATION_OPTIONS} {...register("education")} error={errors.education?.message} />
              <Textarea label="Background (optional)" rows={3} maxLength={1000} value={watch("background") ?? ""} placeholder="For example: information systems student, interested in edtech." {...register("background")} />
            </>
          )}
          {step === 1 && (
            <>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                <legend className="isk-label" style={{ marginBottom: 12 }}>Entrepreneurial experience</legend>
                {EXPERIENCE_OPTIONS.map((o) => <Radio key={o.value} value={o.value} label={o.label} {...register("entrepreneurial_experience")} />)}
                {errors.entrepreneurial_experience && <span className="isk-hint isk-hint--error" role="alert">{errors.entrepreneurial_experience.message}</span>}
              </fieldset>
              <Textarea label="Business or startup experience (optional)" rows={3} maxLength={1000} value={watch("business_experience") ?? ""} placeholder="Projects, sales, competitions, internships…" {...register("business_experience")} />
            </>
          )}
          {step === 2 && (
            <>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                <legend className="isk-label" style={{ marginBottom: 12 }}>Current goals</legend>
                {goals.isLoading && <span className="isk-hint">Loading goals…</span>}
                {goals.error && <InlineAlert>{errorMessage(goals.error)}</InlineAlert>}
                {goals.data?.map((g) => (
                  <Checkbox key={g.code} label={g.title} description={g.description ?? undefined} checked={selectedGoals.includes(g.code)} onChange={(e) => toggleGoal(g.code, e.target.checked)} />
                ))}
                {errors.goal_codes && <span className="isk-hint isk-hint--error" role="alert">{errors.goal_codes.message}</span>}
              </fieldset>
              <Select label="Preferred learning format" options={FORMAT_OPTIONS} {...register("preferred_learning_format")} error={errors.preferred_learning_format?.message} />
              <Select label="Weekly time for learning" options={WEEKLY_OPTIONS} {...register("weekly_learning_minutes")} error={errors.weekly_learning_minutes?.message} />
            </>
          )}
          <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 12 }}>
            <Button variant="secondary" iconLeft="arrow-left" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
            {step < STEPS.length - 1 ? (
              <Button iconRight="arrow-right" onClick={next}>Continue</Button>
            ) : (
              <Button type="submit" iconRight="arrow-right" loading={save.isPending}>Continue to assessment</Button>
            )}
          </div>
        </form>
      </Card>
    </main>
  );
}
