import { Button, Card, InlineAlert, Input, Wordmark } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLogin } from "../api/auth";
import { errorMessage } from "../api/client";
import { loginSchema, type LoginValues } from "../features/schemas";

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const { register, handleSubmit, formState: { errors } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = (v: LoginValues) =>
    login.mutate(v, {
      onSuccess: ({ user }) => {
        const next = new URLSearchParams(location.search).get("next");
        const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
        navigate(safe ?? (user.role === "admin" ? "/admin" : user.onboarding_completed ? "/dashboard" : "/onboarding"), { replace: true });
      },
    });

  return (
    <div className="ik-auth">
      <main className="ik-auth__box">
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Link to="/" aria-label="Isker home" style={{ textDecoration: "none" }}><Wordmark size={26} /></Link>
        </div>
        <Card padding={28}>
          <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 600 }}>Sign in</h1>
          <p style={{ marginTop: 4, fontSize: 14, color: "var(--color-neutral-500)" }}>Continue developing your entrepreneurial competencies.</p>
          <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            {login.error && <InlineAlert>{errorMessage(login.error)}</InlineAlert>}
            <Input label="Email" type="email" autoComplete="email" {...register("email")} error={errors.email?.message} />
            <Input label="Password" type="password" autoComplete="current-password" {...register("password")} error={errors.password?.message} />
            <Button type="submit" size="lg" fullWidth loading={login.isPending}>Sign in</Button>
          </form>
        </Card>
        <p style={{ marginTop: 16, textAlign: "center", fontSize: 14, color: "var(--color-neutral-600)" }}>
          New to Isker? <Link to="/register">Create an account</Link>
        </p>
      </main>
    </div>
  );
}
