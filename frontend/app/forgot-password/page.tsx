"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { forgotPasswordAction, type FormState } from "@/app/auth/actions";
import { AuthLayout, DemoModeNote, FormAlert, SubmitButton, TextField } from "@/components/auth";
import { authEnabled } from "@/lib/auth/config";

function Body() {
  const expired = useSearchParams().get("expired");
  const [state, action, pending] = useActionState<FormState, FormData>(forgotPasswordAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {expired && !state.message && <FormAlert tone="error">That reset link has expired or was already used. Ask for a new one.</FormAlert>}
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
      {state.message && <FormAlert tone="success">{state.message}</FormAlert>}
      <TextField id="email" label="Email address" icon={Mail} type="email" autoComplete="email"
        defaultValue={state.values?.email ?? ""} error={state.fieldErrors?.email} />
      <SubmitButton pending={pending} pendingLabel="Sending…" disabled={!authEnabled}>Send reset link</SubmitButton>
      {!authEnabled && <DemoModeNote />}
      <p className="text-center text-sm"><Link href="/login" className="font-medium text-brand-600 hover:underline">Back to sign in</Link></p>
    </form>
  );
}

export default function ForgotPasswordPage() {
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one">
      <Suspense><Body /></Suspense>
    </AuthLayout>
  );
}
