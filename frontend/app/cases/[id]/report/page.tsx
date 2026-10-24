"use client";

import { Printer } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button, ErrorState, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import { describeSource, EVIDENCE_LABEL, formatDate, formatINR, todayISO, VERDICT_LABEL } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

function Report() {
  const { id } = useParams<{ id: string }>();
  const asOf = useSearchParams().get("asOf") ?? undefined;
  const { data, error, loading, reload } = useAsync(async () => {
    const [c, ev, biz] = await Promise.all([api.getCase(id), api.evaluate(id, asOf), api.getBusiness().catch(() => null)]);
    return { c, ev, biz };
  }, [id, asOf]);

  if (loading) return <LoadingState label="Preparing report" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const { c, ev, biz } = data;

  return (
    <article className="mx-auto max-w-3xl space-y-6 bg-white p-6 text-sm text-slate-900 print:p-0">
      <div className="no-print flex justify-between">
        <Link href={`/cases/${id}`} className="text-brand-600 hover:underline">Back to case</Link>
        <Button variant="primary" onClick={() => window.print()}><Printer size={16} aria-hidden /> Print or save as PDF</Button>
      </div>

      <header className="border-b border-slate-300 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-semibold">Delayed payment case report</h1><span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Draft for review</span></div>
        <p>{biz?.name ?? "Supplier"} vs {c.buyer.name}</p>
        <p className="text-xs text-slate-600">Case {c.id} · valued as of {formatDate(ev.as_of)} · generated {formatDate(todayISO())} · engine {ev.engine_version}</p>
      </header>

      <section>
        <h2 className="font-semibold">Summary</h2>
        <table className="mt-2 w-full"><tbody>
          <tr><td className="py-0.5 text-slate-600">Principal outstanding</td><td className="text-right tabular-nums">{formatINR(ev.totals.principal)}</td></tr>
          <tr><td className="py-0.5 text-slate-600">Estimated interest (s.16)</td><td className="text-right tabular-nums">{formatINR(ev.totals.interest)}</td></tr>
          <tr className="font-semibold"><td className="py-0.5">Estimated total</td><td className="text-right tabular-nums">{formatINR(ev.totals.total)}</td></tr>
          <tr><td className="py-0.5 text-slate-600">Eligibility (as assessed)</td><td className="text-right">{VERDICT_LABEL[ev.eligibility.verdict]}</td></tr>
          <tr><td className="py-0.5 text-slate-600">Recommended next step</td><td className="text-right">{ev.next_action.label}</td></tr>
        </tbody></table>
        <p className="mt-1 text-xs text-slate-600">{ev.eligibility.reasons.join(" ")}</p>
      </section>

      <section>
        <h2 className="font-semibold">Invoices</h2>
        <table className="mt-2 w-full text-xs">
          <thead><tr className="border-b border-slate-300 text-left">
            <th scope="col" className="py-1">Invoice</th><th scope="col">Amount</th><th scope="col">Accepted</th>
            <th scope="col">Last day to pay</th><th scope="col">Interest from</th><th scope="col" className="text-right">Outstanding</th>
          </tr></thead>
          <tbody>{ev.invoices.map((i) => (
            <tr key={i.invoice_id} className="border-b border-slate-100">
              <td className="py-1">{i.number}</td><td>{formatINR(i.amount)}</td>
              <td>{i.due ? `${formatDate(i.due.acceptance_date)} (${i.due.acceptance_status})` : "—"}</td>
              <td>{formatDate(i.due?.last_day_to_pay)}</td><td>{formatDate(i.due?.interest_start)}</td>
              <td className="text-right tabular-nums">{formatINR(i.interest?.total_outstanding ?? i.principal_outstanding)}</td>
            </tr>))}
          </tbody>
        </table>
      </section>

      {ev.invoices.filter((i) => i.interest).map((i) => (
        <section key={i.invoice_id} className="break-inside-avoid">
          <h2 className="font-semibold">Interest schedule: {i.number}</h2>
          <table className="mt-2 w-full text-xs">
            <thead><tr className="border-b border-slate-300 text-right">
              <th scope="col" className="py-1 text-left">Month from</th><th scope="col">Opening</th><th scope="col">Interest</th><th scope="col">Paid</th><th scope="col">Rate</th>
            </tr></thead>
            <tbody>{i.interest!.schedule.map((r) => (
              <tr key={r.period_start} className="border-b border-slate-100 text-right tabular-nums">
                <td className="py-0.5 text-left">{formatDate(r.period_start)}</td><td>{formatINR(r.opening_balance)}</td>
                <td>{formatINR(r.interest)}</td><td>{Number(r.payments) ? formatINR(r.payments) : "—"}</td><td>{r.rates_pct.join(", ")}</td>
              </tr>))}
            </tbody>
          </table>
        </section>
      ))}

      <section>
        <h2 className="font-semibold">Evidence</h2>
        <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">
          {c.evidence.map((e) => <li key={e.kind}>{EVIDENCE_LABEL[e.kind]}: <strong>{e.status === "have" ? "on file" : e.status === "missing" ? "missing" : "not confirmed"}</strong></li>)}
        </ul>
        <p className="mt-1 text-xs">{ev.readiness.score}.</p>
      </section>

      {ev.findings.length > 0 && (
        <section>
          <h2 className="font-semibold">Points to check</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {ev.findings.map((f) => <li key={f.id}>{f.message} <span className="text-slate-600">Source: {f.sources.map(describeSource).join(", ")}.</span></li>)}
          </ul>
        </section>
      )}

      {ev.promises.length > 0 && (
        <section>
          <h2 className="font-semibold">Payment promises</h2>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {ev.promises.map((p) => <li key={p.promise_id}>{formatINR(p.amount)} promised on {formatDate(p.made_on)} for {formatDate(p.due_date)}: {p.status.replace("_", " ")} (received {formatINR(p.received)})</li>)}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-semibold">Assumptions</h2>
        <ul className="mt-2 list-disc pl-5 text-xs">
          {(ev.invoices.find((i) => i.interest)?.interest?.assumptions ?? []).map((a) => <li key={a}>{a}</li>)}
          <li>Interest at three times the RBI Bank Rate, compounded monthly (MSMED Act s.16), from the day after the payment deadline (s.15, s.2(b)).</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold">If informal follow-up fails</h2>
        <p className="mt-1 text-xs">Eligible micro and small enterprises file new delayed-payment references on the MSME ODR portal (odr.msme.gov.in), using their Udyam number, buyer details, invoice-wise claims and supporting documents.</p>
      </section>

      <footer className="border-t border-slate-300 pt-3 text-xs text-slate-600">
        Estimate for information only, based on the facts entered. Not legal advice. Verify eligibility and figures with a professional before sending a formal demand or filing.
      </footer>
    </article>
  );
}

export default function ReportPage() {
  return <Suspense fallback={<LoadingState />}><Report /></Suspense>;
}
