import { z } from "zod";

/** Client-side validation mirroring the API's Pydantic rules (the server re-validates everything). */
export const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export const passwordRule = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters")
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/\d/, "Include at least one number");

export const registerSchema = z
  .object({
    full_name: z.string().trim().min(2, "Enter your name").max(120),
    email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address"),
    password: passwordRule,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export const onboardingSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your name").max(120),
  education: z.string().min(1, "Choose your education"),
  background: z.string().max(1000).optional(),
  entrepreneurial_experience: z.enum(["none", "side_project", "startup_team", "running_business"], {
    errorMap: () => ({ message: "Choose your experience" }),
  }),
  business_experience: z.string().max(1000).optional(),
  goal_codes: z.array(z.string()).min(1, "Choose at least one goal").max(6),
  preferred_learning_format: z.enum(["article", "video", "course", "mixed"], { errorMap: () => ({ message: "Choose a format" }) }),
  weekly_learning_minutes: z.coerce.number().int().min(15, "At least 15 minutes").max(600),
});

export const changePasswordSchema = z
  .object({ current_password: z.string().min(1, "Enter your current password"), new_password: passwordRule, confirm: z.string() })
  .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type OnboardingValues = z.infer<typeof onboardingSchema>;
