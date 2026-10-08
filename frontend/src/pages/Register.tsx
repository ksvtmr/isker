import { Button, Card, InlineAlert, Input, Wordmark } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { useRegister } from "../api/auth";
import { ApiError, errorMessage } from "../api/client";
import { registerSchema, type RegisterValues } from "../features/schemas";

export function RegisterPage() {
  const reg = useRegister();
  const navigate = useNavigate();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = ({ confirm: _confirm, ...v }: RegisterValues) =>
    reg.mutate(v, {
      onSuccess: () => navigate("/onboarding", { replace: true }),
      onError: (e) => {
        if (e instanceof ApiError) {
          if (e.code === "EMAIL_TAKEN") setError("email", { message: e.message });
          for (const [field, msg] of Object.entries(e.fieldErrors())) setError(field as keyof RegisterValues, { message: msg });
        }
      },
    });

  const showBanner = reg.error instanceof ApiError ? reg.error.code !== "EMAIL_TAKEN" && reg.error.code !== "VALIDATION_ERROR" : !!reg.error;
  return (
    <div className="ik-auth">
      <main className="ik-auth__box">
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Link to="/" aria-label="Isker home" style={{ textDecoration: "none" }}><Wordmark size={26} /></Link>
        </div>
        <Card padding={28}>
          <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 600 }}>Create your account</h1>
          <p style={{ marginTop: 4, fontSize: 14, color: "var(--color-neutral-500)" }}>It takes a minute. Your answers stay private.</p>
          <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            {showBanner && <InlineAlert>{errorMessage(reg.error)}</InlineAlert>}
            <Input label="Full name" autoComplete="name" {...register("full_name")} error={errors.full_name?.message} />
            <Input label="Email" type="email" autoComplete="email" {...register("email")} error={errors.email?.message} />
            <Input label="Password" type="password" autoComplete="new-password" hint="At least 8 characters, with a letter and a number." {...register("password")} error={errors.password?.message} />
            <Input label="Confirm password" type="password" autoComplete="new-password" {...register("confirm")} error={errors.confirm?.message} />
            <Button type="submit" size="lg" fullWidth loading={reg.isPending}>Create account</Button>
          </form>
        </Card>
        <p style={{ marginTop: 16, textAlign: "center", fontSize: 14, color: "var(--color-neutral-600)" }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </main>
    </div>
  );
}
