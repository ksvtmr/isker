import { Button, InlineAlert, Input } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router-dom";
import { authApi } from "../api/auth";
import { errorMessage } from "../api/client";
import { LinkButton } from "../components/RouterLink";
import { AuthFrame } from "../components/AuthFrame";
import { resetSchema } from "../features/schemas";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const reset = useMutation({ mutationFn: authApi.resetPassword });
  const { register, handleSubmit, formState: { errors } } = useForm<{ new_password: string; confirm: string }>({ resolver: zodResolver(resetSchema) });

  if (!token) {
    return (
      <AuthFrame title="Reset link is incomplete" footer={<Link to="/login">Back to sign in</Link>}>
        <InlineAlert>This page needs the link from your reset email. Request a new link if you can't find it.</InlineAlert>
        <div style={{ marginTop: 16 }}><LinkButton to="/forgot-password" variant="secondary">Request a new link</LinkButton></div>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Choose a new password" subtitle="You'll be signed out on all devices." footer={<Link to="/login">Back to sign in</Link>}>
      {reset.isSuccess ? (
        <>
          <InlineAlert tone="success" title="Password changed">{reset.data.message}</InlineAlert>
          <div style={{ marginTop: 16 }}><LinkButton to="/login" fullWidth size="lg">Sign in</LinkButton></div>
        </>
      ) : (
        <form onSubmit={handleSubmit((v) => reset.mutate({ token, new_password: v.new_password }))} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {reset.error && (
            <InlineAlert>
              {errorMessage(reset.error)} <Link to="/forgot-password">Request a new link</Link>
            </InlineAlert>
          )}
          <Input label="New password" type="password" autoComplete="new-password" hint="At least 8 characters, with a letter and a number." {...register("new_password")} error={errors.new_password?.message} />
          <Input label="Confirm new password" type="password" autoComplete="new-password" {...register("confirm")} error={errors.confirm?.message} />
          <Button type="submit" size="lg" fullWidth loading={reset.isPending}>Set new password</Button>
        </form>
      )}
    </AuthFrame>
  );
}
