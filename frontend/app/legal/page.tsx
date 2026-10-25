"use client";

import {
  BookOpen, Calculator, ChevronRight, ClipboardCheck,
  ExternalLink, ListChecks, Scale, UserRound
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Chat } from "@/components/assistant/Chat";
import {
  Badge, Button, Card, cx, ErrorState, Field, inputClass, LoadingState, Notice, VerdictBadge
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { EVIDENCE_LABEL, EVIDENCE_WHY, formatDate, formatINR, todayISO } from "@/lib/format";
import { PROVISIONS, SOURCES } from "@/lib/legal";
import { useAsync } from "@/lib/useAsync";
import type { CalcResult, CaseDetail, Evaluation, InvoiceDetail, RateRow } from "@/types/api";

const TABS = [
  { id: "guidance", label: "Legal guidance & Q&A", icon: BookOpen, desc: "Ask questions and review statutory provisions" },
  { id: "calculator", label: "Interest calculator", icon: Calculator, desc: "Calculate Section 16 compound interest" },
  { id: "evidence", label: "Evidence checklist", icon: ClipboardCheck, desc: "Document readiness for dispute filing" },
  { id: "next", label: "Next steps", icon: ListChecks, desc: "Statutory recovery ladder & actions" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function Guidance({ ev }: { ev: Evaluation | null }) {
  return (
    <div className="space-y-4">
      {ev && (
        <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
          <h3 className="flex items-center gap-2 font-bold text-slate-900">
            <UserRound size={18} className="text-brand-600" aria-hidden />
            <span>Case Eligibility: </span>
            <VerdictBadge verdict={ev.eligibility.verdict} />
          </h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-700 space-y-1">
            {ev.eligibility.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </section>
      )}

      {PROVISIONS.map((p) => (
        <section key={p.section} className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold text-slate-900 text-base">MSMED Act, 2006 · {p.section}</h3>
            <span className="text-xs font-semibold text-brand-700 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-100">{p.title}</span>
          </div>
          <p className="mt-3 rounded-lg border-l-4 border-brand-600 bg-slate-50 p-3.5 text-sm font-serif italic text-slate-800 leading-relaxed">
            {p.text}
          </p>
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Plain language explanation</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {p.plain.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
        </section>
      ))}

      <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm shadow-xs">
        <p className="font-semibold text-slate-900 mb-2">Official statutory sources</p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.values(SOURCES).map((s) => (
            <li key={s.url} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-brand-600 font-medium hover:underline text-xs">
                <span>{s.label}</span>
                <ExternalLink size={12} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CalculatorTab({ inv }: { inv: InvoiceDetail | null }) {
  const [f, setF] = useState({
    amount: "",
    delivery_date: "",
    agreed_due_date: "",
    objection_date: "",
    objection_removed_date: "",
    as_of: todayISO(),
    allocation: "interest_first",
  });
  const [pays, setPays] = useState<{ paid_on: string; amount: string }[]>([]);
  const [res, setRes] = useState<CalcResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rates = useAsync<RateRow[]>(() => api.rates(), []);

  useEffect(() => {
    if (!inv) return;
    setF({
      amount: inv.amount,
      delivery_date: inv.delivery_date ?? "",
      agreed_due_date: inv.agreed_due_date ?? "",
      objection_date: inv.objection_date ?? "",
      objection_removed_date: inv.objection_removed_date ?? "",
      as_of: todayISO(),
      allocation: "interest_first",
    });
    setPays(inv.payments.map((p) => ({ paid_on: p.paid_on, amount: p.amount })));
    setRes(null);
  }, [inv]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!(Number(f.amount) > 0)) return setError("Enter the invoice amount.");
    if (!f.delivery_date) return setError("Enter the delivery date.");
    const body: Record<string, unknown> = {
      amount: f.amount,
      delivery_date: f.delivery_date,
      as_of: f.as_of,
      allocation: f.allocation,
      payments: pays.filter((p) => p.paid_on && Number(p.amount) > 0),
    };
    (["agreed_due_date", "objection_date", "objection_removed_date"] as const).forEach((k) => {
      if (f[k]) body[k] = f[k];
    });
    try {
      setRes(await api.calculate(body));
    } catch (x) {
      setError(x instanceof ApiError ? `${x.message}${x.field ? ` (${x.field})` : ""}` : "Something went wrong.");
    }
  };

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
      {/* Left Column: Form & Detailed Results */}
      <div className="space-y-6">
        <Card title={
          <div className="flex items-center gap-2">
            <Calculator size={20} className="text-brand-600" aria-hidden />
            <span>Section 16 Interest Calculator</span>
          </div>
        }>
          <form onSubmit={run} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Invoice amount (₹)" htmlFor="c-amt">
                <input
                  id="c-amt"
                  inputMode="decimal"
                  placeholder="e.g. 150000"
                  value={f.amount}
                  onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="Delivered on" htmlFor="c-del">
                <input
                  id="c-del"
                  type="date"
                  value={f.delivery_date}
                  onChange={set("delivery_date")}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="Agreed due date (optional, max 45 days)" htmlFor="c-agr">
                <input
                  id="c-agr"
                  type="date"
                  value={f.agreed_due_date}
                  onChange={set("agreed_due_date")}
                  className={inputClass}
                />
              </Field>
              <Field label="Calculate value as of" htmlFor="c-asof">
                <input
                  id="c-asof"
                  type="date"
                  value={f.as_of}
                  onChange={set("as_of")}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="Buyer objected on (optional)" htmlFor="c-obj">
                <input
                  id="c-obj"
                  type="date"
                  value={f.objection_date}
                  onChange={set("objection_date")}
                  className={inputClass}
                />
              </Field>
              <Field label="Objection resolved on" htmlFor="c-objr">
                <input
                  id="c-objr"
                  type="date"
                  value={f.objection_removed_date}
                  onChange={set("objection_removed_date")}
                  className={inputClass}
                />
              </Field>
            </div>

            {/* Payments received log */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Payments received against this invoice</p>
                <Button type="button" variant="ghost" className="text-xs" onClick={() => setPays([...pays, { paid_on: "", amount: "" }])}>
                  + Add payment
                </Button>
              </div>
              {pays.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">No partial payments logged. The full principal is calculated as outstanding.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {pays.map((p, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <div className="w-44">
                        <input
                          id={`cp${i}`}
                          type="date"
                          value={p.paid_on}
                          onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, paid_on: e.target.value } : x)))}
                          className={inputClass}
                        />
                      </div>
                      <div className="w-40">
                        <input
                          id={`ca${i}`}
                          inputMode="decimal"
                          placeholder="Amount (₹)"
                          value={p.amount}
                          onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                          className={inputClass}
                        />
                      </div>
                      <Button type="button" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setPays(pays.filter((_, j) => j !== i))}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
              <div className="w-60">
                <Field label="Apply payments to" htmlFor="c-alloc" hint="MSMED Act allows interest-first compounding">
                  <select id="c-alloc" value={f.allocation} onChange={set("allocation")} className={inputClass}>
                    <option value="interest_first">Interest first (recommended)</option>
                    <option value="principal_first">Principal first</option>
                  </select>
                </Field>
              </div>
              <Button type="submit" variant="primary" className="px-6 py-2.5">
                <Calculator size={18} aria-hidden /> Calculate interest
              </Button>
            </div>
          </form>

          {error && <div className="mt-4"><ErrorState message={error} /></div>}
        </Card>

        {/* Calculation Result */}
        {res && (
          <Card title="Calculation Result" className="border-blue-200">
            <div className="space-y-4" aria-live="polite">
              <div className="rounded-lg bg-blue-50/70 p-3.5 text-sm text-blue-900 border border-blue-100">
                <p className="font-semibold">{res.due.basis}</p>
                {res.due.warnings.map((w) => <p key={w} className="mt-1 text-xs text-amber-800">{w}</p>)}
              </div>

              {res.status !== "computed" ? (
                <Notice tone="amber">{res.message}</Notice>
              ) : res.interest && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold text-slate-500 uppercase">Principal</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{formatINR(res.interest.principal_outstanding)}</p>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                      <p className="text-xs font-semibold text-amber-700 uppercase">Statutory interest (s.16)</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-amber-900">{formatINR(res.interest.interest_outstanding)}</p>
                    </div>
                    <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                      <p className="text-xs font-semibold text-brand-700 uppercase">Total claim</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-brand-700">{formatINR(res.interest.total_outstanding)}</p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600">
                    Last day to pay: <strong>{formatDate(res.due.last_day_to_pay)}</strong> · Interest accrues from: <strong>{formatDate(res.due.interest_start)}</strong>
                  </p>

                  {/* Month by month compounding schedule */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 mb-2">Month-by-month compounding schedule</h4>
                    <div className="relative overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                          <tr>
                            <th scope="col" className="py-2.5 px-3 text-left">Month from</th>
                            <th scope="col" className="py-2.5 px-3">Opening balance</th>
                            <th scope="col" className="py-2.5 px-3">Monthly interest</th>
                            <th scope="col" className="py-2.5 px-3">Payments</th>
                            <th scope="col" className="py-2.5 px-3">Applicable rate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {res.interest.schedule.map((r) => (
                            <tr key={r.period_start} className="tabular-nums hover:bg-slate-50/50">
                              <td className="py-2 px-3 text-left font-medium text-slate-900">{formatDate(r.period_start)}</td>
                              <td className="py-2 px-3">{formatINR(r.opening_balance)}</td>
                              <td className="py-2 px-3 text-amber-700 font-semibold">{formatINR(r.interest)}</td>
                              <td className="py-2 px-3 text-emerald-700">{Number(r.payments) ? formatINR(r.payments) : "—"}</td>
                              <td className="py-2 px-3 text-slate-600">{r.rates_pct.join(", ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {res.interest.assumptions.length > 0 && (
                    <details className="text-xs text-slate-600 rounded-lg bg-slate-50 p-3 border border-slate-200">
                      <summary className="cursor-pointer font-semibold text-slate-700">Calculation assumptions & rules applied</summary>
                      <ul className="mt-2 list-disc pl-5 space-y-1">
                        {res.interest.assumptions.map((a) => <li key={a}>{a}</li>)}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Right Column: Verified RBI Rates & Law Reference */}
      <div className="space-y-6">
        <Card title="RBI Bank Rate Reference">
          <p className="text-xs text-slate-600 leading-relaxed">
            Under Section 16 of the MSMED Act, interest is mandated at <strong>three times the Bank Rate</strong> notified by the Reserve Bank of India, compounded with monthly rests.
          </p>
          {rates.data && (
            <div className="mt-4 relative overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th scope="col" className="py-2 px-2.5">Effective from</th>
                    <th scope="col" className="py-2 px-2.5">Bank Rate</th>
                    <th scope="col" className="py-2 px-2.5">Statutory (3×)</th>
                    <th scope="col" className="py-2 px-2.5">Notice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rates.data.map((r) => (
                    <tr key={r.effective_from} className="tabular-nums">
                      <td className="py-2 px-2.5 font-medium">{formatDate(r.effective_from)}</td>
                      <td className="py-2 px-2.5">{r.bank_rate_pct}%</td>
                      <td className="py-2 px-2.5 font-semibold text-amber-700">{r.statutory_rate_pct}%</td>
                      <td className="py-2 px-2.5">
                        <a href={r.source} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-0.5">
                          RBI <ExternalLink size={10} aria-hidden />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Rates are strictly loaded from verified RBI gazette notifications and cannot be manually modified, preventing calculation errors.
          </p>
        </Card>

        <Card title="Section 43B(h) Tax Protection">
          <p className="text-xs text-slate-600 leading-relaxed">
            Section 43B(h) of the Income-tax Act, 1961 disallows deductions for any payments due to micro and small enterprises that remain unpaid beyond the MSMED Act statutory limit.
          </p>
          <div className="mt-3 rounded-lg bg-emerald-50 p-3 border border-emerald-100 text-xs text-emerald-900">
            <strong>Key advantage:</strong> Reminding corporate buyers of Section 43B(h) provides strong legal leverage to expedite clearance before fiscal year-end.
          </div>
        </Card>
      </div>
    </div>
  );
}

function EvidenceTab({ c }: { c: CaseDetail | null }) {
  if (!c) {
    return (
      <Card title="Evidence & Dispute Readiness">
        <div className="py-8 text-center text-sm text-slate-600">
          <ClipboardCheck size={32} className="mx-auto text-slate-400 mb-2" aria-hidden />
          <p>Choose an invoice above to view and audit its case evidence checklist.</p>
        </div>
      </Card>
    );
  }

  const have = c.evidence.filter((e) => e.status === "have").length;
  const pct = Math.round((have / (c.evidence.length || 1)) * 100);

  return (
    <div className="space-y-6">
      <Card title="Case Evidence Checklist">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div>
            <h4 className="font-semibold text-slate-900">Evidence status for {c.buyer.name}</h4>
            <p className="text-sm text-slate-600 mt-0.5">
              {have} of {c.evidence.length} standard proof documents marked on file ({pct}% complete).
            </p>
          </div>
          <Link
            href={`/cases/${c.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Manage case documents <ChevronRight size={16} aria-hidden />
          </Link>
        </div>

        <ul className="divide-y divide-slate-100">
          {c.evidence.map((e) => (
            <li key={e.kind} className="flex flex-wrap items-start justify-between gap-4 py-4">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900">{EVIDENCE_LABEL[e.kind]}</p>
                </div>
                <p className="mt-1 text-sm text-slate-600 leading-relaxed">{EVIDENCE_WHY[e.kind]}</p>
              </div>
              <Badge tone={e.status === "have" ? "green" : e.status === "missing" ? "red" : "slate"}>
                {e.status === "have" ? "On file" : e.status === "missing" ? "Missing" : "Not confirmed"}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Why evidence matters for the MSME ODR Portal">
        <p className="text-sm text-slate-600 leading-relaxed">
          When informal recovery reminders do not succeed, filing a dispute with the Micro & Small Enterprise Facilitation Council (MSEFC) through the MSME Samadhaan / ODR portal requires proof of:
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <strong className="block text-slate-900 mb-1">1. Supplier Eligibility</strong>
            Valid Udyam Registration Certificate active before or on the invoice date.
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <strong className="block text-slate-900 mb-1">2. Delivery Proof</strong>
            Signed delivery challan, consignment note, or email confirmation of receipt.
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <strong className="block text-slate-900 mb-1">3. Invoices & Ledger</strong>
            GST e-invoices quoting buyer GSTIN and an up-to-date running account ledger.
          </div>
        </div>
      </Card>
    </div>
  );
}

function NextTab({ ev, caseId }: { ev: Evaluation | null; caseId?: string }) {
  if (!ev) {
    return (
      <Card title="Statutory Recovery Ladder">
        <div className="py-8 text-center text-sm text-slate-600">
          <ListChecks size={32} className="mx-auto text-slate-400 mb-2" aria-hidden />
          <p>Choose an invoice above to see the recommended next step and recovery ladder.</p>
        </div>
      </Card>
    );
  }

  const steps = [
    { title: "Invoice delivered & accepted", desc: "15-day objection period under Section 2(b) begins upon receipt." },
    { title: "Friendly reminder (Nudge)", desc: "Gentle informal reminder quoting invoice numbers and due dates." },
    { title: "Firm reminder quoting Section 16 & 43B(h)", desc: "Statutory notice warning of accruing interest and tax disallowance." },
    { title: "Formal Demand Letter", desc: "Formal legal demand under Sections 15 and 16 with compounding schedule." },
    { title: "Settlement or payment agreement", desc: "Negotiate a binding written repayment agreement or installment plan." },
    { title: "Filing on MSME Samadhaan (MSEFC / ODR)", desc: "Official statutory conciliation and arbitration application." },
  ];

  return (
    <div className="space-y-6">
      {/* Recommended Now Card */}
      <div className="rounded-xl border-2 border-blue-200 bg-blue-50/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-brand-600">Current Recommended Action</p>
            <h3 className="mt-1 text-xl font-bold text-slate-900">{ev.next_action.label}</h3>
          </div>
          {caseId && (
            <Link
              href={`/cases/${caseId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Take action in case <ChevronRight size={16} aria-hidden />
            </Link>
          )}
        </div>
        <ul className="mt-3 list-disc pl-5 text-sm text-slate-800 space-y-1">
          {ev.next_action.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>

      {/* Ladder Steps */}
      <Card title="The 6-Step Payment Recovery Framework">
        <ol className="divide-y divide-slate-100">
          {steps.map((s, i) => (
            <li key={s.title} className="flex items-start gap-4 py-3.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 font-bold text-sm text-brand-600 border border-blue-200">
                {i + 1}
              </span>
              <div>
                <p className="font-semibold text-slate-900 text-sm">{s.title}</p>
                <p className="text-xs text-slate-600 mt-0.5">{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
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
    const [ev, c] = await Promise.all([api.evaluate(inv.case.id), api.getCase(inv.case.id)]);
    return { inv, ev, c };
  }, [selectedId]);

  const selectTab = (id: Tab) => {
    setTab(id);
    router.replace(`/legal?tab=${id}${selectedId ? `&invoice=${selectedId}` : ""}`);
  };

  const handleInvoiceChange = (invId: string) => {
    router.replace(`/legal?tab=${tab}&invoice=${invId}`);
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-slate-900">
            <Scale size={30} className="text-brand-600" aria-hidden /> Legal Assistant
          </h1>
          <p className="mt-1 text-slate-600">
            Statutory rights under the MSMED Act, 2006, Section 16 interest calculation, and evidence tracking.
          </p>
        </div>

        {(tab === "calculator" || tab === "evidence" || tab === "next") && (
          <div className="flex flex-col gap-1">
            <label htmlFor="sel-inv" className="text-xs font-semibold text-slate-600">Selected invoice</label>
            <select
              id="sel-inv"
              value={selectedId ?? ""}
              onChange={(e) => handleInvoiceChange(e.target.value)}
              className={`${inputClass} w-72!`}
            >
              {(invoices.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} · {r.buyer_name} ({formatINR(r.amount)})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Prominent Full-Width Tab Navigation */}
      <div className="rounded-xl border border-slate-200 bg-white p-1.5 shadow-xs">
        <nav role="tablist" aria-label="Legal assistant tools" className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {TABS.map(({ id, label, icon: Icon, desc }) => {
            const isCur = tab === id;
            return (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={isCur}
                aria-controls={`panel-${id}`}
                id={`tab-${id}`}
                onClick={() => selectTab(id)}
                className={cx(
                  "flex flex-col items-start rounded-lg px-4 py-3 text-left transition-all cursor-pointer",
                  isCur
                    ? "bg-brand-600 text-white shadow-xs"
                    : "text-slate-700 hover:bg-slate-100/80"
                )}
              >
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Icon size={18} className={isCur ? "text-white" : "text-brand-600"} aria-hidden />
                  <span>{label}</span>
                </div>
                <span className={cx("mt-0.5 text-xs line-clamp-1", isCur ? "text-blue-100" : "text-slate-500")}>
                  {desc}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Panels */}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0">
        {ctx.loading && tab !== "guidance" && <LoadingState label="Loading invoice and statutory data..." />}
        {ctx.error && <ErrorState message={ctx.error} onRetry={ctx.reload} />}

        {/* Tab 1: Legal guidance & Q&A Chat */}
        {tab === "guidance" && (
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <Chat />
            <Guidance ev={ctx.data?.ev ?? null} />
          </div>
        )}

        {/* Tab 2: Interest Calculator (Full-Width, Uncramped) */}
        {tab === "calculator" && (
          <CalculatorTab inv={ctx.data?.inv ?? null} />
        )}

        {/* Tab 3: Evidence Checklist (Full-Width, Uncramped) */}
        {tab === "evidence" && (
          <EvidenceTab c={ctx.data?.c ?? null} />
        )}

        {/* Tab 4: Next Steps (Full-Width, Uncramped) */}
        {tab === "next" && (
          <NextTab ev={ctx.data?.ev ?? null} caseId={ctx.data?.c.id} />
        )}
      </div>
    </div>
  );
}

export default function LegalPage() {
  return <Suspense fallback={<LoadingState label="Loading legal tools..." />}><Legal /></Suspense>;
}
