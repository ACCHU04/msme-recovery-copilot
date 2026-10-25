"use client";

import { useActionState } from "react";
import { updatePasswordAction, type FormState } from "@/app/auth/actions";
import { AuthLayout, FormAlert, PasswordField, SubmitButton } from "@/components/auth";

export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePasswordAction, {});
  return (
    <AuthLayout title="Choose a new password" subtitle="You'll stay signed in here; other devices will be signed out">
      <form action={action} className="space-y-4" noValidate>
        {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
        <PasswordField id="password" label="New password" autoComplete="new-password" error={state.fieldErrors?.password}
          hint="At least 8 characters, with a letter and a number." />
        <PasswordField id="confirmPassword" label="Confirm new password" autoComplete="new-password" error={state.fieldErrors?.confirmPassword} />
        <SubmitButton pending={pending} pendingLabel="Saving…">Save new password</SubmitButton>
      </form>
    </AuthLayout>
  );
}
