"use client";

import { CalendarClock, CircleCheck, Database, Handshake, Info, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, EmptyState, ErrorState, inputClass, KpiCard, LoadingState, PayStatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatINR } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { CaseDetail, Evaluation, InvoiceRow } from "@/types/api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

function settledOn(r: InvoiceRow): string | null {
  if (r.status !== "paid") return null;
  let cum = 0;
  for (const p of [...r.payments].sort((a, b) => a.paid_on.localeCompare(b.paid_on))) {
    cum += Math.round(Number(p.amount) * 100);
    if (cum >= Math.round(Number(r.amount) * 100)) return p.paid_on;
  }
  return null;
}

async function load(buyerId: string | null) {
  const [invoices, cases] = await Promise.all([api.listInvoices(), api.listCases()]);
  const buyers = new Map<string, string>();
  cases.forEach((c) => buyers.set(c.buyer_id, c.buyer_name ?? "—"));
  const id = buyerId && buyers.has(buyerId) ? buyerId : [...buyers.keys()][0] ?? null;
  if (!id) return { buyers, id, rows: [], details: [] as { c: CaseDetail; ev: Evaluation | null }[] };
  const mine = cases.filter((c) => c.buyer_id === id);
  const details = await Promise.all(mine.map(async (s) => {
    const c = await api.getCase(s.id);
    const ev = c.invoices.length ? await api.viewEvaluation(s.id).catch(() => null) : null;
    return { c, ev };
  }));
  return { buyers, id, rows: invoices.filter((r) => r.buyer_id === id), details };
}

function Insights() {
  const params = useSearchParams();
  const router = useRouter();
  const buyerParam = params.get("buyer");
  const { data, error, loading, reload } = useAsync(() => load(buyerParam), [buyerParam]);

  if (loading && !data) return <LoadingState label="Loading buyer records" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || !data.id) return <EmptyState title="No buyers yet" body="Buyers appear here once you add a case." action={<Link href="/cases/new" className="font-medium text-brand-600 underline">Add case</Link>} />;

  const { rows, details } = data;
  const buyer = details[0]?.c.buyer;
  const paid = rows.filter((r) => r.status === "paid");
  const delays = paid.map((r) => ({ r, d: r.last_day_to_pay ? days(settledOn(r) ?? r.last_day_to_pay, r.last_day_to_pay) : 0 }));
  const onTime = delays.filter((x) => x.d <= 0).length;
  const avgDelay = delays.length ? Math.round(delays.reduce((s, x) => s + x.d, 0) / delays.length) : null;
  const unpaid = rows.reduce((s, r) => s + Math.round(Number(r.unpaid) * 100), 0) / 100;
  const overdue = rows.filter((r) => r.status === "overdue");
  const promises = details.flatMap((d) => d.ev?.promises ?? []);
  const kept = promises.filter((p) => p.status === "kept" || p.status === "kept_late").length;
  const broken = promises.filter((p) => p.status === "broken" || p.status === "part_kept").length;
  const followups = details.flatMap((d) => d.ev?.followups ?? []);
  const disputes = details.filter((d) => d.c.dispute_reason !== "none").length + rows.filter((r) => r.status === "disputed").length;

  const byMonth = new Map<string, { month: string; Invoiced: number; Paid: number }>();
  rows.forEach((r) => {
    const k = r.invoice_date.slice(0, 7);
    const m = byMonth.get(k) ?? { month: `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`, Invoiced: 0, Paid: 0 };
    m.Invoiced += Number(r.amount); m.Paid += Number(r.paid); byMonth.set(k, m);
  });
  const chart = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold"><Users size={28} className="text-brand-600" aria-hidden /> Buyer profile and payment performance</h1>
          <p className="mt-1 text-slate-600">How each buyer has paid you, from your own records.</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="buyer-pick" className="text-xs font-medium text-slate-600">Buyer</label>
          <select id="buyer-pick" value={data.id} onChange={(e) => router.replace(`/buyers?buyer=${e.target.value}`)} className={`${inputClass} w-72!`}>
            {[...data.buyers.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <section className="flex flex-wrap items-center gap-5 rounded-xl border border-slate-200 bg-white p-5">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-navy-800 text-xl font-bold text-white" aria-hidden>
              {(buyer?.name ?? "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-bold">{buyer?.name}</h2>
              <p className="text-sm text-slate-600">GSTIN {buyer?.gstin ?? "not given"}{buyer?.gstin ? " (format checked, not looked up)" : ""} · importance to you: <span className="capitalize">{buyer?.relationship_importance ?? "not set"}</span></p>
            </div>
            <Badge tone="slate" icon={<Database size={12} aria-hidden />}>Your records only</Badge>
          </section>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <KpiCard label="Paid on time" value={paid.length ? `${Math.round((onTime / paid.length) * 100)}%` : "—"} sub={paid.length ? `${onTime} of ${paid.length} fully paid invoices` : "No invoice paid in full yet"} icon={<CircleCheck size={22} />} tone="green" />
            <KpiCard label="Average delay" value={avgDelay === null ? "—" : `${avgDelay} days`} sub={avgDelay === null ? "Needs a fully paid invoice" : "After the legal due date"} icon={<CalendarClock size={22} />} tone="blue" />
            <KpiCard label="Unpaid now" value={formatINR(unpaid)} sub={`${rows.filter((r) => Number(r.unpaid) > 0).length} open invoice(s)`} icon={<TriangleAlert size={22} />} tone="red" valueClass="text-red-600" />
            <KpiCard label="Promises" value={`${kept} kept · ${broken} broken`} sub={`${followups.length} follow-up(s) sent, ${followups.filter((f) => f.reply_received).length} replied`} icon={<Handshake size={22} />} tone="amber" />
          </div>

          <Card title="Invoiced and paid by month">
            {chart.length === 0 ? <p className="text-sm text-slate-600">No invoices with this buyer.</p> : (
              <figure>
                <div className="h-60" aria-hidden>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickFormatter={(v: number) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${Math.round(v / 1000)}k`)} tickLine={false} axisLine={false} fontSize={12} />
                      <Tooltip formatter={(v: number) => formatINR(v)} cursor={{ fill: "#f1f5f9" }} />
                      <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Invoiced" fill="#1a56db" radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                      <Bar dataKey="Paid" fill="#16a34a" radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <figcaption className="sr-only">{chart.map((c) => `${c.month}: invoiced ${formatINR(c.Invoiced)}, paid ${formatINR(c.Paid)}`).join("; ")}</figcaption>
              </figure>
            )}
          </Card>

        </div>

        <div className="space-y-6">
          <Card title={<span className="flex items-center gap-2"><Database size={18} className="text-brand-600" aria-hidden /> Data source and reliability</span>}>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span>Invoices recorded</span><span className="font-semibold">{rows.length}</span></li>
              <li className="flex justify-between"><span>Paid in full</span><span className="font-semibold">{paid.length}</span></li>
              <li className="flex justify-between"><span>Overdue now</span><span className="font-semibold">{overdue.length}</span></li>
              <li className="flex justify-between"><span>Disputes or objections</span><span className="font-semibold">{disputes}</span></li>
            </ul>
            <p className="mt-3 flex gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><Info size={14} className="mt-0.5 shrink-0" aria-hidden />
              Based only on invoices and payments you entered. It is not a credit rating and is not shared with anyone. {rows.length < 5 && "With fewer than 5 invoices, these figures say little."}</p>
            <p className="mt-3 text-sm text-slate-700">Something wrong? These figures come from your entries, so correct the invoice or payment itself:
              {rows[0] && <> <Link href={`/invoices/${rows[0].id}`} className="font-medium text-brand-600 underline">correct a record</Link>.</>}</p>
          </Card>
          <Card title="Open cases with this buyer">
            <ul className="space-y-3">{details.map(({ c, ev }) => (
              <li key={c.id} className="text-sm">
                <Link href={`/cases/${c.id}`} className="font-semibold text-brand-600 hover:underline">Case · PO {formatDate(c.contract_date)}</Link>
                {ev ? <p className="text-slate-600">{formatINR(ev.totals.total)} est. · next: {ev.next_action.label}</p> : <p className="text-slate-600">No invoices yet</p>}
              </li>))}
            </ul>
          </Card>
          <Card title="What this suggests">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {broken > 0 && <li>{broken} payment promise(s) broken. Ask for a specific date and amount next time and record it.</li>}
              {overdue.length > 0 && <li>{overdue.length} invoice(s) overdue. Check the recommended next step on each case.</li>}
              {avgDelay !== null && avgDelay > 0 && <li>Pays {avgDelay} days late on average. Consider agreeing a written credit period (up to 45 days).</li>}
              {broken === 0 && overdue.length === 0 && <li>No warning signs in your records.</li>}
            </ul>
          </Card>
        </div>
      </div>
      <Card title="Invoices with this buyer">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Invoice history with {buyer?.name}</caption>
            <thead className="bg-slate-50 text-xs text-slate-600"><tr>
              <th scope="col" className="py-2.5 pl-3 text-left font-semibold">Invoice</th>
              <th scope="col" className="py-2.5 text-left font-semibold">Invoice date</th>
              <th scope="col" className="py-2.5 text-left font-semibold">Due by</th>
              <th scope="col" className="py-2.5 text-right font-semibold">Amount</th>
              <th scope="col" className="py-2.5 pl-4 text-left font-semibold">Paid in full on</th>
              <th scope="col" className="py-2.5 text-right font-semibold">Delay (days)</th>
              <th scope="col" className="py-2.5 pl-4 text-left font-semibold">Status</th>
            </tr></thead>
            <tbody>{rows.map((r) => {
              const s = settledOn(r);
              const delay = s && r.last_day_to_pay ? days(s, r.last_day_to_pay) : r.days_overdue || null;
              return (
                <tr key={r.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 pl-3"><Link href={`/invoices/${r.id}`} className="font-medium text-brand-600 hover:underline">{r.number}</Link></td>
                  <td className="py-3">{formatDate(r.invoice_date)}</td>
                  <td className="py-3">{formatDate(r.last_day_to_pay)}</td>
                  <td className="py-3 text-right tabular-nums">{formatINR(r.amount)}</td>
                  <td className="py-3 pl-4">{s ? formatDate(s) : "—"}</td>
                  <td className={`py-3 text-right tabular-nums ${delay && delay > 0 ? "font-medium text-red-600" : ""}`}>{delay === null ? "—" : delay}{!s && delay ? " so far" : ""}</td>
                  <td className="py-3 pl-4"><PayStatusBadge status={r.status} partial={r.partially_paid} /></td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function BuyersPage() {
  return <Suspense fallback={<LoadingState />}><Insights /></Suspense>;
}
