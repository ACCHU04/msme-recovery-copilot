"use client";

import { Mail, MailWarning } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { resendVerificationAction, signOutAction, type FormState } from "@/app/auth/actions";
import { AuthLayout, FormAlert, SubmitButton, TextField } from "@/components/auth";
import { useViewer } from "@/lib/auth/viewer";

function Body() {
  const viewer = useViewer();
  const unverified = useSearchParams().get("reason") === "unverified" || (viewer && !viewer.emailVerified);
  const [state, action, pending] = useActionState<FormState, FormData>(resendVerificationAction, {});
  return (
    <div className="space-y-5">
      <div className="flex justify-center"><span className="rounded-full bg-amber-50 p-4 text-amber-700"><MailWarning size={36} aria-hidden /></span></div>
      {unverified && <FormAlert tone="info">You need to verify your email address before you can use your account.</FormAlert>}
      <p className="text-sm text-slate-700">
        We sent a verification link when you registered. Open it to confirm your address. If you can&apos;t find it, check spam,
        or ask for a new link below.
      </p>
      <form action={action} className="space-y-3" noValidate>
        {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
        {state.message && <FormAlert tone="success">{state.message}</FormAlert>}
        <TextField id="email" label="Email address" icon={Mail} type="email" autoComplete="email"
          defaultValue={state.values?.email ?? viewer?.email ?? ""} error={state.fieldErrors?.email} />
        <SubmitButton pending={pending} pendingLabel="Sending…">Send a new link</SubmitButton>
      </form>
      <div className="flex items-center justify-between text-sm">
        <Link href="/login" className="font-medium text-brand-600 hover:underline">Back to sign in</Link>
        {viewer && <form action={signOutAction}><button type="submit" className="font-medium text-slate-600 hover:underline">Sign out</button></form>}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return <AuthLayout title="Verify your email"><Suspense><Body /></Suspense></AuthLayout>;
}
