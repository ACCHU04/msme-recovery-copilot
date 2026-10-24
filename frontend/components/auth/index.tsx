"use client";

import { AlertCircle, CheckCircle2, Eye, EyeOff, FileText, HandCoins, Loader2, Lock, Scale, type LucideIcon } from "lucide-react";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Logo } from "@/components/layout/AppShell";
import { cx, inputClass } from "@/components/ui";

const FEATURES = [
  { icon: FileText, title: "Track invoices", body: "Every unpaid invoice, its due date and what is owed" },
  { icon: Scale, title: "Know your legal rights", body: "MSMED Act deadlines and interest, explained" },
  { icon: HandCoins, title: "Recover payments", body: "The right next step, without losing the customer" },
];

/** Split screen used by every sign-in and account-status page. */
export function AuthLayout({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1fr] xl:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-navy-800 p-12 text-white lg:flex lg:flex-col lg:justify-center">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_#2f6fe4_0%,_transparent_55%),radial-gradient(ellipse_at_bottom_left,_#0e3b8c_0%,_transparent_60%)]" aria-hidden />
        <svg className="absolute bottom-0 left-0 w-full opacity-15" viewBox="0 0 800 220" aria-hidden>
          <path fill="currentColor" d="M0 220V150h40v-40h30v40h40V90h60v60h30V60h50v90h40v-50h30v50h60V40h20V20h20v20h20v110h40v-70h50v70h30V100h60v50h40V70h50v80h40v70z" />
        </svg>
        <div className="relative max-w-lg">
          <Logo />
          <p className="mt-10 text-4xl font-extrabold leading-tight">Paid on time,<br />by law.</p>
          <p className="mt-4 text-lg text-white/85">Helping micro and small businesses understand what they are owed under the MSMED Act and recover it, while keeping their customers.</p>
          <ul className="mt-10 space-y-5">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="rounded-xl bg-white/12 p-3 ring-1 ring-white/20"><Icon size={22} aria-hidden /></span>
                <span><span className="block font-semibold">{title}</span><span className="block text-sm text-white/80">{body}</span></span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="flex items-start justify-center bg-canvas px-4 py-8 sm:items-center sm:p-6">
        <div className={cx("w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8", wide ? "max-w-2xl" : "max-w-md")}>
          <div className="mb-6 text-brand-600 lg:hidden"><Logo small /></div>
          <h1 className="text-center text-2xl font-bold sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-center text-slate-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </section>
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string; label: string; icon?: LucideIcon; error?: string; hint?: ReactNode; optional?: boolean;
};

export function TextField({ id, label, icon: Icon, error, hint, optional, className, ...rest }: FieldProps) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium">
        {label} {optional && <span className="font-normal text-slate-500">(optional)</span>}
      </label>
      <div className="relative mt-1">
        {Icon && <Icon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />}
        <input id={id} name={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy}
          className={cx(inputClass, "py-2.5", Icon && "pl-10", error && "border-red-400 focus-visible:outline-red-600")} {...rest} />
      </div>
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 flex items-start gap-1 text-sm text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />{error}</p>}
    </div>
  );
}

export function PasswordField({ id, label = "Password", error, hint, autoComplete = "current-password", className, ...rest }:
  Omit<FieldProps, "type" | "icon" | "label"> & { label?: string }) {
  const [show, setShow] = useState(false);
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="relative mt-1">
        <Lock size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
        <input id={id} name={id} type={show ? "text" : "password"} autoComplete={autoComplete}
          aria-invalid={error ? true : undefined} aria-describedby={describedBy}
          className={cx(inputClass, "py-2.5 pl-10 pr-11", error && "border-red-400")} {...rest} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600">
          {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
        </button>
      </div>
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 flex items-start gap-1 text-sm text-red-700"><AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />{error}</p>}
    </div>
  );
}

export function SubmitButton({ pending, children, pendingLabel, disabled }: { pending: boolean; children: ReactNode; pendingLabel: string; disabled?: boolean }) {
  return (
    <button type="submit" disabled={pending || disabled} aria-busy={pending}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-3 font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60">
      {pending ? <><Loader2 size={18} className="animate-spin" aria-hidden /> {pendingLabel}</> : children}
    </button>
  );
}

export function FormAlert({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-green-200 bg-green-50 text-green-800",
    info: "border-blue-200 bg-blue-50 text-blue-900",
  }[tone];
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("flex items-start gap-2 rounded-lg border p-3 text-sm", styles)}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden /><div>{children}</div>
    </div>
  );
}

export function DemoModeNote() {
  return (
    <p className="mt-6 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
      <strong>Demo mode.</strong> Supabase is not configured, so no real accounts exist and passwords are not checked.
      Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to turn on real sign-in.
    </p>
  );
}
