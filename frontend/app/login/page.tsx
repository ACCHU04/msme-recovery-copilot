"use client";

import { ArrowRight, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useActionState, useEffect, useState, type FormEvent } from "react";
import { signInAction, type FormState } from "@/app/auth/actions";
import { AuthLayout, DemoModeNote, FormAlert, PasswordField, SubmitButton, TextField } from "@/components/auth";
import { authEnabled } from "@/lib/auth/config";
import { validateSignIn, type FieldErrors } from "@/lib/auth/validation";
import { getSession, signIn } from "@/lib/session";

const NOTICES: Record<string, { tone: "info" | "success" | "error"; text: string }> = {
  expired: { tone: "info", text: "Your session expired. Sign in again to continue." },
  signed_out: { tone: "success", text: "You've signed out." },
  "link:expired": { tone: "error", text: "That link is invalid or has expired. Sign in, or request a new verification email." },
  "link:other-browser": { tone: "info", text: "Your email is probably verified, but the link was opened in a different browser. Sign in here to continue." },
};

function notice(q: URLSearchParams) {
  if (q.get("expired")) return NOTICES.expired;
  if (q.get("signed_out")) return NOTICES.signed_out;
  const link = q.get("link");
  if (link) return NOTICES[`link:${link}`] ?? NOTICES["link:expired"];
  return null;
}

function RealSignIn() {
  const q = useSearchParams();
  const [state, action, pending] = useActionState<FormState, FormData>(signInAction, {});
  const [local, setLocal] = useState<FieldErrors>({});
  const [emailVal, setEmailVal] = useState(state.values?.email ?? "");
  const [passVal, setPassVal] = useState("");
  const errors = { ...state.fieldErrors, ...local };
  const shown = state.error || state.fieldErrors ? null : notice(q);

  function check(e: FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const found = validateSignIn(String(fd.get("email") ?? ""), String(fd.get("password") ?? ""));
    setLocal(found);
    if (Object.keys(found).length) e.preventDefault();
  }

  function fillAccount(email: string) {
    setEmailVal(email);
    setPassVal("Password123!");
    setLocal({});
  }

  return (
    <form action={action} onSubmit={check} className="space-y-4" noValidate>
      {shown && <FormAlert tone={shown.tone}>{shown.text}</FormAlert>}
      {state.error && <FormAlert tone="error">{state.error}</FormAlert>}
      <input type="hidden" name="next" value={q.get("next") ?? ""} />

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
        <p className="font-semibold text-slate-700">Quick sign-in for demo roles:</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => fillAccount("supplier@msme-demo.com")}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:border-brand-600 hover:text-brand-600">
            Supplier (Sri Lakshmi)
          </button>
          <button type="button" onClick={() => fillAccount("buyer@msme-demo.com")}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:border-brand-600 hover:text-brand-600">
            Buyer (Kaveri Foods)
          </button>
          <button type="button" onClick={() => fillAccount("adviser@msme-demo.com")}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:border-brand-600 hover:text-brand-600">
            Adviser (CA Meera)
          </button>
        </div>
      </div>

      <TextField id="email" label="Email address" icon={Mail} type="email" autoComplete="email" inputMode="email"
        value={emailVal} onChange={(e) => setEmailVal(e.target.value)} placeholder="you@company.com" error={errors.email} required />
      <PasswordField id="password" value={passVal} onChange={(e) => setPassVal(e.target.value)} error={errors.password} required />
      <div className="flex items-center justify-between gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="remember" className="h-4 w-4 accent-brand-600" /> Keep me signed in for 30 days
        </label>
        <Link href="/forgot-password" className="shrink-0 font-medium text-brand-600 hover:underline">Forgot password?</Link>
      </div>
      <SubmitButton pending={pending} pendingLabel="Signing in…">Sign in <ArrowRight size={18} aria-hidden /></SubmitButton>
      <p className="text-center text-xs text-slate-500">On a shared computer, leave “Keep me signed in” off. You&apos;ll be signed out when the browser closes.</p>
    </form>
  );
}

/** Local demo only (no Supabase configured): no password check, clearly labelled. */
function DemoSignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (getSession()) router.replace("/"); }, [router]);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email address.");
    const display = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    signIn({ name: display, email }, false);
    router.replace("/");
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <TextField id="email" label="Email address" icon={Mail} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com" error={error ?? undefined} />
      <SubmitButton pending={false} pendingLabel="">Enter the demo <ArrowRight size={18} aria-hidden /></SubmitButton>
      <DemoModeNote />
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue">
      <Suspense>{authEnabled ? <RealSignIn /> : <DemoSignIn />}</Suspense>
      <div className="my-5 flex items-center gap-3 text-sm text-slate-500"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
      <p className="text-center text-sm">
        Don&apos;t have an account? <Link href="/register" className="font-semibold text-brand-600 hover:underline">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
