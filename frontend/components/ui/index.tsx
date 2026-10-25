"use client";

import { AlertCircle, CircleCheck, CircleHelp, Info, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { BUCKET_LABEL, VERDICT_LABEL } from "@/lib/format";
import type { Bucket, PayStatus, Verdict } from "@/types/api";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ title, action, children, className }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-lg font-bold text-navy-900">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 border-brand-600",
    secondary: "bg-white text-slate-800 hover:bg-slate-50 border-slate-300",
    ghost: "bg-transparent text-slate-700 hover:bg-slate-100 border-transparent",
    danger: "bg-white text-red-700 hover:bg-red-50 border-red-300",
  };
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
        "disabled:cursor-not-allowed disabled:opacity-60", styles[variant], className)}
    >
      {children}
    </button>
  );
}

type Tone = "green" | "amber" | "red" | "blue" | "slate" | "violet";
const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  red: "bg-red-50 text-red-800 border-red-200",
  blue: "bg-blue-50 text-blue-800 border-blue-200",
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  violet: "bg-violet-50 text-violet-800 border-violet-200",
};
export function Badge({ tone = "slate", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium", TONES[tone])}>
      {icon}
      {children}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return <Badge>Not checked</Badge>;
  const map = {
    eligible: { tone: "green" as Tone, icon: <CircleCheck size={12} aria-hidden /> },
    not_eligible: { tone: "red" as Tone, icon: <XCircle size={12} aria-hidden /> },
    uncertain: { tone: "amber" as Tone, icon: <CircleHelp size={12} aria-hidden /> },
  }[verdict];
  return <Badge tone={map.tone} icon={map.icon}>{VERDICT_LABEL[verdict]}</Badge>;
}

export function BucketBadge({ bucket }: { bucket: Bucket | null }) {
  if (!bucket) return <Badge>No invoices</Badge>;
  const tone: Record<Bucket, Tone> = {
    not_due: "slate", due_soon: "blue", overdue: "amber", overdue_interest_accruing: "red",
  };
  const icon = bucket.startsWith("overdue") ? <TriangleAlert size={12} aria-hidden /> : undefined;
  return <Badge tone={tone[bucket]} icon={icon}>{BUCKET_LABEL[bucket]}</Badge>;
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-slate-600">
      <Loader2 className="animate-spin" size={16} aria-hidden /> {label}…
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <AlertCircle size={16} aria-hidden />
      <span className="flex-1">{message}</span>
      {onRetry && <Button onClick={onRetry} className="py-1">Retry</Button>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Notice({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "amber" | "blue" }) {
  const t = { slate: "bg-slate-50 text-slate-700 border-slate-200", amber: "bg-amber-50 text-amber-900 border-amber-200", blue: "bg-blue-50 text-blue-900 border-blue-200" }[tone];
  return (
    <p className={cx("flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed", t)}>
      <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function Field({ label, htmlFor, hint, error, children }: {
  label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-800">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600 aria-[invalid=true]:border-red-500";

export function EstimateNote() {
  return (
    <Notice>
      Estimates depend on the dates and documents entered. Eligibility under the MSMED Act and the
      legal reading behind these figures should be verified before relying on them. Not legal advice.
    </Notice>
  );
}

const PAY_LABEL: Record<PayStatus, { label: string; tone: Tone }> = {
  paid: { label: "Paid", tone: "green" },
  overdue: { label: "Overdue", tone: "red" },
  due_soon: { label: "Due soon", tone: "amber" },
  not_due: { label: "Not yet due", tone: "blue" },
  disputed: { label: "Disputed", tone: "violet" },
  missing_dates: { label: "Dates missing", tone: "slate" },
};
export function PayStatusBadge({ status, partial }: { status: PayStatus; partial?: boolean }) {
  const s = PAY_LABEL[status];
  return <Badge tone={s.tone}>{s.label}{partial ? " · part paid" : ""}</Badge>;
}

export function KpiCard({ label, value, sub, icon, tone, valueClass }: {
  label: string; value: string; sub?: ReactNode; icon: ReactNode; tone: "blue" | "green" | "amber" | "red" | "violet"; valueClass?: string;
}) {
  const tile = { blue: "bg-blue-50 text-brand-600", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-600", violet: "bg-violet-50 text-violet-700" }[tone];
  return (
    <div className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <span className={cx("rounded-xl p-3", tile)} aria-hidden>{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <p className={cx("mt-1 truncate text-2xl font-bold tabular-nums", valueClass ?? "text-navy-900")}>{value}</p>
        {sub && <div className="mt-0.5 text-sm text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

export function Dialog({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100"><XCircle size={20} /></button>
        </div>
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div role="status" className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-3 text-sm text-white shadow-lg">
      <CircleCheck size={16} aria-hidden /> {message}
    </div>
  );
}
