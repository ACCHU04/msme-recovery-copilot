// Public page a buyer opens from the supplier's link: confirm receipt, or raise a problem.
// No account needed. Shows only this invoice's basic details.
import { CheckCircle2, PackageCheck, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { answerConfirmation } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm delivery · Settle45", robots: { index: false, follow: false } };

const BACKEND = (process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

type Info = {
  supplier_name: string | null; buyer_name: string | null; invoice_number: string; invoice_date: string;
  amount: string; delivery_date: string | null; expired: boolean; answered: boolean; response: string | null;
};

const inr = (v: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(v));
const day = (d: string | null) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

async function load(token: string): Promise<Info | null> {
  try {
    const r = await fetch(`${BACKEND}/api/public/confirm/${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    return r.ok ? (await r.json()) as Info : null;
  } catch { return null; }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-lg space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
}

export default async function ConfirmPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { token } = await params;
  const q = await searchParams;
  const info = await load(token);

  if (!info) {
    return <Shell><h1 className="text-xl font-bold">This link is not valid</h1>
      <p className="text-slate-600">Please check the link, or ask the supplier to send a new one.</p></Shell>;
  }
  const done = q.done ?? (info.answered ? info.response ?? "received_ok" : null);
  return (
    <Shell>
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-blue-50 p-3 text-brand-600"><PackageCheck size={26} aria-hidden /></span>
        <div><h1 className="text-xl font-bold">Confirm delivery</h1>
          <p className="text-sm text-slate-600">Requested by {info.supplier_name ?? "your supplier"}</p></div>
      </div>
      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
        <div><dt className="text-slate-500">Invoice</dt><dd className="font-semibold">{info.invoice_number}</dd></div>
        <div><dt className="text-slate-500">Amount</dt><dd className="font-semibold">{inr(info.amount)}</dd></div>
        <div><dt className="text-slate-500">Invoice date</dt><dd>{day(info.invoice_date)}</dd></div>
        <div><dt className="text-slate-500">Delivered</dt><dd>{day(info.delivery_date)}</dd></div>
        {info.buyer_name && <div className="col-span-2"><dt className="text-slate-500">Billed to</dt><dd>{info.buyer_name}</dd></div>}
      </dl>

      {done ? (
        <p role="status" className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0" aria-hidden />
          {done === "issue" ? "Thank you. Your note has been sent to the supplier." : "Thank you. The supplier has been told you received this delivery in good order."}
        </p>
      ) : info.expired ? (
        <p className="text-slate-700">This link has expired. Please ask the supplier for a new one.</p>
      ) : (
        <form action={answerConfirmation.bind(null, token)} className="space-y-4">
          {q.error && <p role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden />{q.error}</p>}
          <label className="block text-sm font-medium">Your name and team
            <input name="name" required minLength={2} maxLength={100} placeholder="e.g. Anand, Stores" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">Was the delivery received in good order?</legend>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3"><input type="radio" name="response" value="received_ok" defaultChecked /> Yes, received in good order</label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3"><input type="radio" name="response" value="issue" /> No, there is a problem</label>
          </fieldset>
          <label className="block text-sm font-medium">Details (needed if there is a problem)
            <textarea name="note" maxLength={1000} rows={3} placeholder="e.g. 12 cartons damaged" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <button type="submit" className="w-full rounded-lg bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700">Send answer</button>
          <p className="text-xs text-slate-500">Your answer and name go only to {info.supplier_name ?? "the supplier"}, through Settle45. The link works once.</p>
        </form>
      )}
    </Shell>
  );
}
