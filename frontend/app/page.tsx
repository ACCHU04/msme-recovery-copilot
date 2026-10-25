"use client";

import { AlarmClock, BellRing, Calculator, ClipboardCheck, FilePlus2, FileSignature, FileText, Gavel, Hourglass, Plus, TriangleAlert, Wallet, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { contractRef } from "@/lib/contracts";
import { InvoicesTable, InvoiceStatusChart } from "@/components/dashboard";
import { Badge, Button, Card, Dialog, ErrorState, EstimateNote, Field, inputClass, KpiCard, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatINR } from "@/lib/format";
import { useViewer } from "@/lib/auth/viewer";
import { useAsync } from "@/lib/useAsync";
import type { CaseSummary, InvoiceRow, NextAction, Totals } from "@/types/api";

async function load() {
  const [invoices, cases] = await Promise.all([api.listInvoices(), api.listCases()]);
  const open = cases.filter((c) => c.totals && Number(c.totals.total) > 0 && c.status !== "settled");
  const evals = await Promise.all(open.slice(0, 6).map(async (c) => {
    if (c.next_action && c.totals) return { c, ev: { totals: c.totals, next_action: c.next_action } };
    try { return { c, ev: await api.evaluate(c.id) }; } catch { return null; }
  }));
  return { invoices, cases, evaluated: evals.filter(Boolean) as { c: CaseSummary; ev: { totals: Totals; next_action: NextAction } }[] };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const sumCents = (rows: InvoiceRow[], k: "amount" | "paid" | "unpaid") => rows.reduce((s, r) => s + Math.round(Number(r[k]) * 100), 0) / 100;

export default function Dashboard() {
  const { data, error, loading, reload } = useAsync(load, []);
  const [period, setPeriod] = useState("all");
  const [pickContract, setPickContract] = useState(false);
  const router = useRouter();
  const openCases = (data?.cases ?? []).filter((c) => c.status !== "archived");
  /** Invoices belong to a contract (purchase order). One contract: go straight there. */
  const addInvoice = () => {
    if (openCases.length === 0) router.push("/cases/new");
    else if (openCases.length === 1) router.push(`/contracts/${openCases[0].id}?add=invoice`);
    else setPickContract(true);
  };
  const first = (useViewer()?.name ?? "").split(" ")[0];

  const years = [...new Set((data?.invoices ?? []).map((r) => r.invoice_date.slice(0, 4)))].sort().reverse();
  const rows = (data?.invoices ?? []).filter((r) => period === "all" || r.invoice_date.startsWith(period));
  const overdue = rows.filter((r) => r.status === "overdue");
  const upcoming = rows.filter((r) => r.status === "due_soon" || r.status === "not_due").sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999));

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{greeting()}{first ? `, ${first}` : ""}</h1>
          <p className="mt-1 text-slate-600">Here&apos;s an overview of your payments and recovery status.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="period" className="sr-only">Period</label>
          <select id="period" value={period} onChange={(e) => setPeriod(e.target.value)} className={`${inputClass} w-36! py-2.5`}>
            <option value="all">All time</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="button" onClick={addInvoice} disabled={!data}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
            <Plus size={18} aria-hidden /> Add invoice
          </button>
        </div>
      </div>

      {loading && <LoadingState label="Loading your invoices" />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total invoiced" value={formatINR(sumCents(rows, "amount"))} sub={`${rows.length} invoice${rows.length === 1 ? "" : "s"}`} icon={<FileText size={22} />} tone="blue" valueClass="text-brand-600" />
            <KpiCard label="Payments received" value={formatINR(sumCents(rows, "paid"))} sub={`${rows.filter((r) => Number(r.paid) > 0).length} invoice(s) with payments`} icon={<Wallet size={22} />} tone="green" valueClass="text-emerald-700" />
            <KpiCard label="Outstanding amount" value={formatINR(sumCents(rows, "unpaid"))} sub={`${rows.filter((r) => Number(r.unpaid) > 0).length} unpaid invoice(s)`} icon={<Hourglass size={22} />} tone="amber" valueClass="text-orange-600" />
            <KpiCard label="Overdue invoices" value={String(overdue.length)} sub={<span className="text-red-600">{formatINR(sumCents(overdue, "unpaid"))} overdue</span>} icon={<TriangleAlert size={22} />} tone="red" valueClass="text-red-600" />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <Card title="Invoice status by month">
              <InvoiceStatusChart rows={rows} />
            </Card>
            <Card title={<span className="flex items-center gap-2"><FileText size={20} className="text-brand-600" aria-hidden /> Recent invoices</span>}
              action={<Link href="/invoices" className="text-sm font-semibold text-brand-600 hover:underline">View all</Link>}>
              <InvoicesTable rows={rows.slice(0, 5)} compact />
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title={<span className="flex items-center gap-2"><Gavel size={20} className="text-brand-600" aria-hidden /> Recovery cases</span>}
              action={<Link href="/cases" className="text-sm font-semibold text-brand-600 hover:underline">View all</Link>}>
              {data.evaluated.length === 0 ? <p className="text-sm text-slate-600">No open cases.</p> : (
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <caption className="sr-only">Open recovery cases and their recommended next step</caption>
                    <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                      <th scope="col" className="py-2.5 pl-3 text-left font-semibold">Buyer</th>
                      <th scope="col" className="py-2.5 text-right font-semibold">Est. total</th>
                      <th scope="col" className="py-2.5 pl-4 text-left font-semibold">Recommended next step</th>
                    </tr></thead>
                    <tbody>{data.evaluated.map(({ c, ev }) => (
                      <tr key={c.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 pl-3 font-medium"><Link href={`/cases/${c.id}`} className="hover:underline">{c.buyer_name}</Link></td>
                        <td className="py-3 text-right tabular-nums">{formatINR(ev.totals.total)}</td>
                        <td className="py-3 pl-4"><span className="inline-block rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-blue-200">{ev.next_action.label}</span></td>
                      </tr>))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title={<span className="flex items-center gap-2"><BellRing size={20} className="text-amber-500" aria-hidden /> Upcoming payment dates</span>}
              action={<Link href="/invoices" className="text-sm font-semibold text-brand-600 hover:underline">View all</Link>}>
              {upcoming.length === 0 ? <p className="text-sm text-slate-600">No invoices are waiting on a future due date.</p> : (
                <ul className="divide-y divide-slate-100">
                  {upcoming.slice(0, 5).map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                      <span><Link href={`/invoices/${r.id}`} className="font-medium text-brand-600 hover:underline">{r.number}</Link> · {r.buyer_name}</span>
                      <span className="flex items-center gap-3"><span className="tabular-nums">{formatINR(r.unpaid)}</span>
                        <Badge tone={(r.days_left ?? 99) <= 3 ? "red" : (r.days_left ?? 99) <= 7 ? "amber" : "blue"} icon={<AlarmClock size={12} aria-hidden />}>
                          {formatDate(r.last_day_to_pay)} · {r.days_left} days</Badge></span>
                    </li>))}
                </ul>
              )}
            </Card>
          </div>

          <section aria-labelledby="qa" className="rounded-xl border border-blue-100 bg-blue-50/60 p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="rounded-full bg-brand-600 p-3 text-white"><Zap size={20} aria-hidden /></span>
              <div><h2 id="qa" className="text-lg font-bold">Quick actions</h2><p className="text-sm text-slate-600">The next step for your receivables.</p></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <button type="button" onClick={addInvoice} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-brand-600">
                <span className="rounded-lg bg-blue-50 p-2.5 text-brand-600"><FilePlus2 size={20} aria-hidden /></span>
                <span className="flex-1"><span className="block font-semibold">Add invoice</span><span className="block text-sm text-slate-600">Record an invoice under one of your contracts.</span></span>
              </button>
              {[
                { href: "/cases/new", icon: FileSignature, title: "Add contract", body: "A new buyer and purchase order." },
                { href: "/legal?tab=calculator", icon: Calculator, title: "Calculate interest", body: "What the buyer owes under s.16." },
                { href: "/reports", icon: ClipboardCheck, title: "Prepare evidence", body: "Checklist and a printable case report." },
              ].map(({ href, icon: Icon, title, body }) => (
                <Link key={href} href={href} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-600">
                  <span className="rounded-lg bg-blue-50 p-2.5 text-brand-600"><Icon size={20} aria-hidden /></span>
                  <span className="flex-1"><span className="block font-semibold">{title}</span><span className="block text-sm text-slate-600">{body}</span></span>
                </Link>
              ))}
            </div>
          </section>
          <EstimateNote />
        </>
      )}
      {pickContract && <PickContract cases={openCases} onClose={() => setPickContract(false)} onPick={(id) => router.push(`/contracts/${id}?add=invoice`)} />}
    </div>
  );
}

function PickContract({ cases, onClose, onPick }: { cases: CaseSummary[]; onClose: () => void; onPick: (id: string) => void }) {
  const [id, setId] = useState(cases[0]?.id ?? "");
  return (
    <Dialog title="Add an invoice" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onPick(id)} disabled={!id}>Continue</Button></>}>
      <Field label="Which contract is it for?" htmlFor="pick-contract">
        <select id="pick-contract" value={id} onChange={(e) => setId(e.target.value)} className={inputClass}>
          {cases.map((c) => <option key={c.id} value={c.id}>{contractRef(c)} · {c.buyer_name}</option>)}
        </select>
      </Field>
      <p className="mt-3 text-sm text-slate-600">New buyer or order? <Link href="/cases/new" className="font-medium text-brand-600 underline">Add a contract</Link> first.</p>
    </Dialog>
  );
}
