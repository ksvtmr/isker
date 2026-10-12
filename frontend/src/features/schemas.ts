import { z } from "zod";

/**
 * Client-side validation mirroring the API's Pydantic rules (the server re-validates everything).
 * Messages are translation keys; render them with useFieldError().
 */
export const loginSchema = z.object({
  email: z.string().trim().min(1, "common:validation.emailRequired").email("common:validation.emailInvalid"),
  password: z.string().min(1, "common:validation.passwordRequired"),
  remember_me: z.boolean(),
});

export const passwordRule = z
  .string()
  .min(8, "common:validation.passwordMin")
  .max(128, "common:validation.passwordMax")
  .regex(/[A-Za-z]/, "common:validation.passwordLetter")
  .regex(/\d/, "common:validation.passwordNumber");

export const registerSchema = z
  .object({
    full_name: z.string().trim().min(2, "common:validation.nameRequired").max(120, "common:validation.nameMax"),
    email: z.string().trim().min(1, "common:validation.emailRequired").email("common:validation.emailInvalid"),
    password: passwordRule,
    confirm: z.string(),
    accept_terms: z.boolean().refine((v) => v, "common:validation.termsRequired"),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "common:validation.passwordsMismatch" });

export const forgotSchema = z.object({ email: z.string().trim().min(1, "common:validation.emailRequired").email("common:validation.emailInvalid") });

export const resetSchema = z
  .object({ new_password: passwordRule, confirm: z.string() })
  .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "common:validation.passwordsMismatch" });

export const onboardingSchema = z.object({
  full_name: z.string().trim().min(2, "common:validation.nameRequired").max(120, "common:validation.nameMax"),
  education: z.string().min(1, "common:validation.chooseEducation"),
  background: z.string().max(1000).optional(),
  entrepreneurial_experience: z.enum(["none", "side_project", "startup_team", "running_business"], {
    errorMap: () => ({ message: "common:validation.chooseExperience" }),
  }),
  business_experience: z.string().max(1000).optional(),
  goal_codes: z.array(z.string()).min(1, "common:validation.chooseGoal").max(6),
  preferred_learning_format: z.enum(["article", "video", "course", "mixed"], { errorMap: () => ({ message: "common:validation.chooseFormat" }) }),
  weekly_learning_minutes: z.coerce.number().int().min(15, "common:validation.minMinutes").max(600),
});

export const changePasswordSchema = z
  .object({ current_password: z.string().min(1, "common:validation.currentPasswordRequired"), new_password: passwordRule, confirm: z.string() })
  .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "common:validation.passwordsMismatch" });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type OnboardingValues = z.infer<typeof onboardingSchema>;
