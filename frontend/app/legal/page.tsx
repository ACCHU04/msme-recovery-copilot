"use client";

import { BookOpen, Calculator, ClipboardCheck, ExternalLink, Gavel, ListChecks, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Chat } from "@/components/assistant/Chat";
import { Badge, Button, Card, cx, ErrorState, Field, inputClass, LoadingState, Notice, VerdictBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { EVIDENCE_LABEL, EVIDENCE_WHY, formatDate, formatINR, todayISO } from "@/lib/format";
import { PROVISIONS, SOURCES } from "@/lib/legal";
import { useAsync } from "@/lib/useAsync";
import type { CalcResult, CaseDetail, Evaluation, InvoiceDetail, RateRow } from "@/types/api";

const TABS = [
  { id: "guidance", label: "Legal guidance", icon: BookOpen },
  { id: "calculator", label: "Interest calculator", icon: Calculator },
  { id: "evidence", label: "Evidence checklist", icon: ClipboardCheck },
  { id: "next", label: "Next steps", icon: ListChecks },
] as const;
type Tab = (typeof TABS)[number]["id"];


/** Pick the speaking voice from the answer's script, so Kannada or Hindi answers are read in that language. */
function Guidance({ ev }: { ev: Evaluation | null }) {
  return (
    <div className="space-y-4">
      {PROVISIONS.map((p) => (
        <section key={p.section} className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">MSMED Act, 2006 · {p.section}</h3>
            <span className="text-sm text-slate-600">{p.title}</span>
          </div>
          <p className="mt-2 rounded-lg border-l-4 border-brand-600 bg-blue-50/60 p-3 text-sm">{p.text}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-slate-700">{p.plain.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
      ))}
      {ev && (
        <section className="rounded-xl border border-slate-200 p-4">
          <h3 className="flex items-center gap-2 font-bold"><UserRound size={18} aria-hidden /> For your business on this case <VerdictBadge verdict={ev.eligibility.verdict} /></h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">{ev.eligibility.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </section>
      )}
      <section className="rounded-xl bg-slate-50 p-4 text-sm">
        <p className="font-semibold">Official sources</p>
        <ul className="mt-2 space-y-1">{Object.values(SOURCES).map((s) => (
          <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 underline">{s.label} <ExternalLink size={12} aria-hidden /></a></li>
        ))}</ul>
      </section>
    </div>
  );
}

function CalculatorTab({ inv }: { inv: InvoiceDetail | null }) {
  const [f, setF] = useState({ amount: "", delivery_date: "", agreed_due_date: "", objection_date: "", objection_removed_date: "", as_of: todayISO(), allocation: "interest_first" });
  const [pays, setPays] = useState<{ paid_on: string; amount: string }[]>([]);
  const [res, setRes] = useState<CalcResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rates = useAsync<RateRow[]>(() => api.rates(), []);
  useEffect(() => {
    if (!inv) return;
    setF((x) => ({ ...x, amount: inv.amount, delivery_date: inv.delivery_date ?? "", agreed_due_date: inv.agreed_due_date ?? "",
      objection_date: inv.objection_date ?? "", objection_removed_date: inv.objection_removed_date ?? "" }));
    setPays(inv.payments.map((p) => ({ paid_on: p.paid_on, amount: p.amount })));
    setRes(null);
  }, [inv]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const run = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (!(Number(f.amount) > 0)) return setError("Enter the invoice amount.");
    if (!f.delivery_date) return setError("Enter the delivery date.");
    const body: Record<string, unknown> = { amount: f.amount, delivery_date: f.delivery_date, as_of: f.as_of, allocation: f.allocation, payments: pays.filter((p) => p.paid_on && Number(p.amount) > 0) };
    (["agreed_due_date", "objection_date", "objection_removed_date"] as const).forEach((k) => { if (f[k]) body[k] = f[k]; });
    try { setRes(await api.calculate(body)); } catch (x) { setError(x instanceof ApiError ? `${x.message}${x.field ? ` (${x.field})` : ""}` : "Something went wrong."); }
  };
  return (
    <div className="space-y-4">
      <form onSubmit={run} className="grid gap-3 sm:grid-cols-3">
        <Field label="Invoice amount (₹)" htmlFor="c-amt"><input id="c-amt" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} className={inputClass} /></Field>
        <Field label="Delivered on" htmlFor="c-del"><input id="c-del" type="date" value={f.delivery_date} onChange={set("delivery_date")} className={inputClass} /></Field>
        <Field label="Agreed to pay by (optional)" htmlFor="c-agr"><input id="c-agr" type="date" value={f.agreed_due_date} onChange={set("agreed_due_date")} className={inputClass} /></Field>
        <Field label="Buyer objected on (optional)" htmlFor="c-obj"><input id="c-obj" type="date" value={f.objection_date} onChange={set("objection_date")} className={inputClass} /></Field>
        <Field label="Objection resolved on" htmlFor="c-objr"><input id="c-objr" type="date" value={f.objection_removed_date} onChange={set("objection_removed_date")} className={inputClass} /></Field>
        <Field label="Value as of" htmlFor="c-asof"><input id="c-asof" type="date" value={f.as_of} onChange={set("as_of")} className={inputClass} /></Field>
        <div className="sm:col-span-3">
          <p className="text-sm font-medium">Payments received</p>
          {pays.map((p, i) => (
            <div key={i} className="mt-2 flex flex-wrap gap-2">
              <label className="sr-only" htmlFor={`cp${i}`}>Payment {i + 1} date</label>
              <input id={`cp${i}`} type="date" value={p.paid_on} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, paid_on: e.target.value } : x)))} className={`${inputClass} w-44!`} />
              <label className="sr-only" htmlFor={`ca${i}`}>Payment {i + 1} amount</label>
              <input id={`ca${i}`} inputMode="decimal" placeholder="Amount" value={p.amount} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d.]/g, "") } : x)))} className={`${inputClass} w-40!`} />
              <Button type="button" variant="ghost" onClick={() => setPays(pays.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button type="button" className="mt-2" onClick={() => setPays([...pays, { paid_on: "", amount: "" }])}>+ Add payment</Button>
        </div>
        <div className="flex flex-wrap items-end gap-3 sm:col-span-3">
          <div className="w-52"><Field label="Apply payments to" htmlFor="c-alloc"><select id="c-alloc" value={f.allocation} onChange={set("allocation")} className={inputClass}><option value="interest_first">Interest first</option><option value="principal_first">Principal first</option></select></Field></div>
          <Button type="submit" variant="primary"><Calculator size={16} aria-hidden /> Calculate</Button>
        </div>
      </form>
      {error && <ErrorState message={error} />}
      {res && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4" aria-live="polite">
          <p className="text-sm">{res.due.basis}</p>
          {res.due.warnings.map((w) => <p key={w} className="text-sm text-amber-800">{w}</p>)}
          {res.status !== "computed" ? <Notice tone="amber">{res.message}</Notice> : res.interest && (
            <>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg bg-slate-50 p-3"><p className="text-slate-600">Principal</p><p className="text-lg font-bold tabular-nums">{formatINR(res.interest.principal_outstanding)}</p></div>
                <div className="rounded-lg bg-amber-50 p-3"><p className="text-slate-600">Interest (est.)</p><p className="text-lg font-bold tabular-nums text-amber-800">{formatINR(res.interest.interest_outstanding)}</p></div>
                <div className="rounded-lg bg-blue-50 p-3"><p className="text-slate-600">Total (est.)</p><p className="text-lg font-bold tabular-nums text-brand-600">{formatINR(res.interest.total_outstanding)}</p></div>
              </div>
              <p className="text-sm text-slate-600">Last day to pay {formatDate(res.due.last_day_to_pay)} · interest from {formatDate(res.due.interest_start)}</p>
              <div className="relative overflow-x-auto"><table className="w-full min-w-[520px] text-right text-xs">
                <caption className="sr-only">Month-by-month interest</caption>
                <thead className="text-slate-500"><tr><th scope="col" className="py-1 text-left font-medium">Month from</th><th scope="col" className="font-medium">Opening</th><th scope="col" className="font-medium">Interest</th><th scope="col" className="font-medium">Paid</th><th scope="col" className="font-medium">Rate</th></tr></thead>
                <tbody>{res.interest.schedule.map((r) => (
                  <tr key={r.period_start} className="border-t border-slate-100 tabular-nums"><td className="py-1 text-left">{formatDate(r.period_start)}</td><td>{formatINR(r.opening_balance)}</td><td>{formatINR(r.interest)}</td><td>{Number(r.payments) ? formatINR(r.payments) : "—"}</td><td>{r.rates_pct.join(", ")}</td></tr>))}
                </tbody></table></div>
              <details className="text-xs text-slate-600"><summary className="cursor-pointer">Assumptions</summary><ul className="mt-1 list-disc pl-5">{res.interest.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></details>
            </>
          )}
          <p className="text-xs text-slate-500">Uses the same engine as your cases. This calculator does not check whether your business is eligible; the case page does.</p>
        </div>
      )}
      <section className="rounded-xl bg-slate-50 p-4 text-sm">
        <p className="font-semibold">RBI Bank Rate used (rate is not typed in, so it can&apos;t be mistyped)</p>
        {rates.data && (
          <table className="mt-2 w-full text-left text-xs">
            <caption className="sr-only">Bank Rate history</caption>
            <thead className="text-slate-500"><tr><th scope="col" className="py-1 font-medium">From</th><th scope="col" className="font-medium">Bank Rate</th><th scope="col" className="font-medium">Interest rate (3×)</th><th scope="col" className="font-medium">Source</th></tr></thead>
            <tbody>{rates.data.map((r) => (
              <tr key={r.effective_from} className="border-t border-slate-200"><td className="py-1">{formatDate(r.effective_from)}</td><td>{r.bank_rate_pct}%</td><td>{r.statutory_rate_pct}%</td><td><a href={r.source} target="_blank" rel="noreferrer" className="text-brand-600 underline">Link</a></td></tr>))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-slate-500">Earlier dates are refused rather than guessed until verified rows are added.</p>
      </section>
    </div>
  );
}

function EvidenceTab({ c }: { c: CaseDetail | null }) {
  if (!c) return <p className="text-sm text-slate-600">Choose an invoice to see its case documents.</p>;
  const have = c.evidence.filter((e) => e.status === "have").length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{have} of {c.evidence.length} documents marked as on file for this case.</p>
      <ul className="divide-y divide-slate-100">{c.evidence.map((e) => (
        <li key={e.kind} className="flex items-start justify-between gap-3 py-2.5">
          <div><p className="font-medium">{EVIDENCE_LABEL[e.kind]}</p><p className="text-sm text-slate-600">{EVIDENCE_WHY[e.kind]}</p></div>
          <Badge tone={e.status === "have" ? "green" : e.status === "missing" ? "red" : "slate"}>{e.status === "have" ? "On file" : e.status === "missing" ? "Missing" : "Not sure"}</Badge>
        </li>))}
      </ul>
      <Link href={`/cases/${c.id}`} className="text-sm font-semibold text-brand-600 hover:underline">Update documents on the case</Link>
    </div>
  );
}

function NextTab({ ev, caseId }: { ev: Evaluation | null; caseId?: string }) {
  if (!ev) return <p className="text-sm text-slate-600">Choose an invoice to see the recommended next step.</p>;
  const steps = ["Check the facts and documents for the case", "Follow up with the buyer, gently first", "Record any payment promise and whether it is kept", "Consider a settlement offer if it helps", "Send a formal demand under ss.15–16 if still unpaid", "File on the MSME ODR portal if needed"];
  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4">
        <p className="text-xs font-semibold uppercase text-brand-600">Recommended now</p>
        <p className="mt-1 text-lg font-bold">{ev.next_action.label}</p>
        <ul className="mt-2 list-disc pl-5 text-sm">{ev.next_action.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        {caseId && <Link href={`/assistant?case=${caseId}`} className="mt-3 inline-block text-sm font-semibold text-brand-600 hover:underline">Draft the message</Link>}
      </div>
      <ol className="space-y-2">{steps.map((s, i) => (
        <li key={s} className="flex items-center gap-3 text-sm"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 font-semibold text-brand-600">{i + 1}</span>{s}</li>))}
      </ol>
    </div>
  );
}

function Legal() {
  const params = useSearchParams();
  const router = useRouter();
  const asked = TABS.find((t) => t.id === params.get("tab"))?.id;
  const [tab, setTab] = useState<Tab>(asked ?? (params.get("invoice") ? "calculator" : "guidance"));
  const invoices = useAsync(() => api.listInvoices(), []);
  const selectedId = params.get("invoice") ?? invoices.data?.[0]?.id ?? null;
  const ctx = useAsync(async () => {
    if (!selectedId) return null;
    const inv = await api.getInvoice(selectedId);
    const [ev, c] = await Promise.all([api.viewEvaluation(inv.case.id), api.getCase(inv.case.id)]);
    return { inv, ev, c };
  }, [selectedId]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold"><Gavel size={28} className="text-brand-600" aria-hidden /> Legal assistant</h1>
          <p className="mt-1 text-slate-600">Your rights on delayed payments under the MSMED Act, applied to your invoices.</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sel-inv" className="text-xs font-medium text-slate-600">Selected invoice</label>
          <select id="sel-inv" value={selectedId ?? ""} onChange={(e) => router.replace(`/legal?invoice=${e.target.value}`)} className={`${inputClass} w-72!`}>
            {(invoices.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.number} · {r.buyer_name} · {formatINR(r.amount)}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Chat />
        <Card>
          <div role="tablist" aria-label="Legal assistant sections" className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} role="tab" type="button" aria-selected={tab === id} aria-controls={`panel-${id}`} id={`tab-${id}`} onClick={() => setTab(id)}
                className={cx("-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium", tab === id ? "border-brand-600 text-brand-600" : "border-transparent text-slate-600 hover:text-navy-900")}>
                <Icon size={16} aria-hidden /> {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {ctx.loading && tab !== "guidance" && <LoadingState />}
            {ctx.error && <ErrorState message={ctx.error} onRetry={ctx.reload} />}
            {tab === "guidance" && <Guidance ev={ctx.data?.ev ?? null} />}
            {tab === "calculator" && <CalculatorTab inv={ctx.data?.inv ?? null} />}
            {tab === "evidence" && <EvidenceTab c={ctx.data?.c ?? null} />}
            {tab === "next" && <NextTab ev={ctx.data?.ev ?? null} caseId={ctx.data?.c.id} />}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function LegalPage() {
  return <Suspense fallback={<LoadingState />}><Legal /></Suspense>;
}
