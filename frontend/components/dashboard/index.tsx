"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BucketBadge, EmptyState, PayStatusBadge, VerdictBadge } from "@/components/ui";
import { formatDate, formatINR, shortId } from "@/lib/format";
import type { CaseSummary, InvoiceRow } from "@/types/api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lakh = (n: number) => (n >= 100000 ? `${(n / 100000).toFixed(n >= 1000000 ? 0 : 1)}L` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Invoice value by invoice month, split into paid / overdue unpaid / other unpaid. From real rows. */
export function InvoiceStatusChart({ rows }: { rows: InvoiceRow[] }) {
  const byMonth = new Map<string, { month: string; Paid: number; Overdue: number; "Not yet due": number }>();
  rows.forEach((r) => {
    const key = r.invoice_date.slice(0, 7);
    const m = byMonth.get(key) ?? { month: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`, Paid: 0, Overdue: 0, "Not yet due": 0 };
    m.Paid += Number(r.paid);
    if (r.status === "overdue" || r.status === "disputed") m.Overdue += Number(r.unpaid);
    else m["Not yet due"] += Number(r.unpaid);
    byMonth.set(key, m);
  });
  const data = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v).slice(-12);
  if (data.length === 0) return <p className="py-10 text-center text-sm text-slate-600">No invoices yet.</p>;
  const summary = data.map((d) => `${d.month}: paid ${formatINR(d.Paid)}, overdue ${formatINR(d.Overdue)}, not yet due ${formatINR(d["Not yet due"])}`).join("; ");
  return (
    <figure>
      <div className="h-64" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={4}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickFormatter={lakh} tickLine={false} axisLine={false} fontSize={12} />
            <Tooltip formatter={(v: number) => formatINR(v)} cursor={{ fill: "#f1f5f9" }} />
            <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Paid" fill="#16a34a" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            <Bar dataKey="Overdue" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            <Bar dataKey="Not yet due" fill="#60a5fa" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">Invoice value by month. {summary}</figcaption>
    </figure>
  );
}

const th = "py-2.5 pr-3 text-left text-xs font-semibold text-slate-600";
const td = "py-3 pr-3";

export function InvoicesTable({ rows, compact }: { rows: InvoiceRow[]; compact?: boolean }) {
  if (rows.length === 0) return <EmptyState title="No invoices yet" body="Add a case with its invoices to start tracking." action={<Link href="/cases/new" className="font-medium text-brand-600 underline">Add case</Link>} />;
  return (
    <div className="relative overflow-x-auto">
      <table className={`w-full text-sm ${compact ? "min-w-[560px]" : "min-w-[880px]"}`}>
        <caption className="sr-only">Invoices</caption>
        <thead className="bg-slate-50"><tr>
          <th scope="col" className={`${th} pl-3`}>Invoice</th>
          <th scope="col" className={th}>Buyer</th>
          <th scope="col" className={`${th} text-right`}>Amount</th>
          {!compact && <th scope="col" className={`${th} text-right`}>Paid</th>}
          {!compact && <th scope="col" className={`${th} text-right`}>Unpaid</th>}
          <th scope="col" className={th}>Due by</th>
          {!compact && <th scope="col" className={`${th} text-right`}>Days overdue</th>}
          <th scope="col" className={th}>Status</th>
          <th scope="col" className={th}><span className="sr-only">Action</span></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 last:border-0">
              <td className={`${td} whitespace-nowrap pl-3 font-medium`}><Link href={`/invoices/${r.id}`} className="text-brand-600 hover:underline">{r.number}</Link></td>
              <td className={td}>{r.buyer_name}</td>
              <td className={`${td} text-right tabular-nums`}>{formatINR(r.amount)}</td>
              {!compact && <td className={`${td} text-right tabular-nums`}>{formatINR(r.paid)}</td>}
              {!compact && <td className={`${td} text-right font-medium tabular-nums`}>{formatINR(r.unpaid)}</td>}
              <td className={`${td} whitespace-nowrap`}>{formatDate(r.last_day_to_pay)}</td>
              {!compact && <td className={`${td} text-right tabular-nums ${r.days_overdue ? "font-medium text-red-600" : "text-slate-500"}`}>{r.days_overdue || "—"}</td>}
              <td className={td}><PayStatusBadge status={r.status} partial={r.partially_paid} /></td>
              <td className={td}><Link href={`/invoices/${r.id}`} className="inline-flex items-center gap-0.5 font-medium text-brand-600 hover:underline">View <ChevronRight size={14} aria-hidden /></Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecentCasesTable({ cases }: { cases: CaseSummary[] }) {
  if (cases.length === 0) {
    return <EmptyState title="Start your first case" body="Add an unpaid invoice to see what is owed and what to do next."
      action={<Link href="/cases/new" className="font-medium text-brand-600 underline">Add case</Link>} />;
  }
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <caption className="sr-only">Recovery cases with estimated amounts</caption>
        <thead className="bg-slate-50"><tr>
          <th scope="col" className={`${th} pl-3`}>Case</th>
          <th scope="col" className={th}>Buyer</th>
          <th scope="col" className={th}>PO date</th>
          <th scope="col" className={`${th} text-right`}>Principal</th>
          <th scope="col" className={`${th} text-right`}>Est. interest</th>
          <th scope="col" className={`${th} text-right`}>Est. total</th>
          <th scope="col" className={th}>Status</th>
          <th scope="col" className={th}>Eligibility</th>
          <th scope="col" className={th}><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id} className="border-b border-slate-100 last:border-0">
              <td className={`${td} pl-3 font-mono text-xs text-slate-600`} title={c.id}>{shortId(c.id)}</td>
              <td className={`${td} font-medium`}>{c.buyer_name ?? "—"}</td>
              <td className={td}>{formatDate(c.contract_date)}</td>
              <td className={`${td} text-right tabular-nums`}>{formatINR(c.totals?.principal)}</td>
              <td className={`${td} text-right tabular-nums text-amber-700`}>{formatINR(c.totals?.interest)}</td>
              <td className={`${td} text-right font-semibold tabular-nums`}>{formatINR(c.totals?.total)}</td>
              <td className={td}><BucketBadge bucket={c.bucket} /></td>
              <td className={td}><VerdictBadge verdict={c.eligibility} /></td>
              <td className={td}><Link href={`/cases/${c.id}`} className="font-medium text-brand-600 hover:underline">Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
