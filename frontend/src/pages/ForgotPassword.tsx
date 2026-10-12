import { Button, InlineAlert, Input } from "@isker/design-system";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { authApi } from "../api/auth";
import { errorMessage } from "../api/client";
import { AuthFrame } from "../components/AuthFrame";
import { forgotSchema } from "../features/schemas";

export function ForgotPasswordPage() {
  const send = useMutation({ mutationFn: authApi.forgotPassword });
  const { register, handleSubmit, formState: { errors } } = useForm<{ email: string }>({ resolver: zodResolver(forgotSchema) });
  return (
    <AuthFrame title="Reset your password" subtitle="Enter the email you use for Isker." footer={<Link to="/login">Back to sign in</Link>}>
      {send.isSuccess ? (
        // The server's message is shown verbatim: it never reveals whether the account exists and says so honestly
        // when email delivery isn't configured.
        <InlineAlert tone="success" title="Check your inbox">{send.data.message}</InlineAlert>
      ) : (
        <form onSubmit={handleSubmit((v) => send.mutate(v.email))} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {send.error && <InlineAlert>{errorMessage(send.error)}</InlineAlert>}
          <Input label="Email" type="email" autoComplete="email" {...register("email")} error={errors.email?.message} />
          <Button type="submit" size="lg" fullWidth loading={send.isPending}>Send reset link</Button>
        </form>
      )}
    </AuthFrame>
  );
}
