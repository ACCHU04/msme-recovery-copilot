"use client";

// Cash flow: what is owed now, what falls due or is promised in the next 8 weeks, and which
// cases to chase first. Built from legal due dates and the buyer's own promises, not a forecast.
import { CalendarClock, Handshake, Hourglass, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, EmptyState, ErrorState, KpiCard, LoadingState, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatINR } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

const lakh = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L` : v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`);

export default function CashFlowPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const { data, error, loading, reload } = useAsync(() => api.cashFlow(), []);
  const weeks = (data?.weeks ?? []).map((w) => ({
    week: formatDate(w.week_start).replace(/ \d{4}$/, ""), "Falling due": Number(w.due), Promised: Number(w.promised),
  }));
  const maxAge = Math.max(1, ...(data?.overdue_by_age ?? []).map((a) => Number(a.amount)));
  const summary = weeks.map((w) => `${w.week}: due ${formatINR(w["Falling due"])}, promised ${formatINR(w.Promised)}`).join("; ");

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><TrendingUp size={28} className="text-brand-600" aria-hidden /> Cash flow</h1>
        <p className="mt-1 text-slate-600">What you are owed now, what falls due or is promised soon, and where to start.</p>
      </div>
      {loading && <LoadingState label="Working out your cash flow" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <KpiCard label="Owed to you now" value={formatINR(data.totals.owed_now)} sub={`${data.totals.overdue_invoices} overdue invoice(s), with interest where eligible`} icon={<Wallet size={22} />} tone="red" valueClass="text-red-600" />
            <KpiCard label="Interest so far" value={formatINR(data.totals.interest_so_far)} sub="Section 16, on overdue invoices" icon={<Hourglass size={22} />} tone="amber" />
            <KpiCard label="Falling due in 30 days" value={formatINR(data.totals.due_next_30_days)} sub="By the legal due date" icon={<CalendarClock size={22} />} tone="blue" />
            <KpiCard label="Promised in 30 days" value={formatINR(data.totals.promised_next_30_days)} sub="Buyers' own promises, still in time" icon={<Handshake size={22} />} tone="green" />
          </div>

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card title="Chase first">
              {data.chase_first.length === 0 ? <EmptyState title="Nothing to chase right now" body="No case needs action today." /> : (
                <ol className="space-y-3">
                  {data.chase_first.map((c, i) => (
                    <li key={c.case_id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <Link href={`/cases/${c.case_id}`} className="font-semibold text-brand-600 hover:underline">{c.buyer_name || `Case #${c.case_id.slice(0, 8)}`}</Link>
                          <span className="font-bold tabular-nums">{formatINR(c.amount)}</span>
                        </div>
                        {c.reasons.length > 0 && <p className="text-sm text-slate-600">{c.reasons.join(" · ")}</p>}
                        {c.next_action && <p className="mt-1"><Badge tone="blue">Next: {c.next_action}</Badge></p>}
                      </div>
                    </li>))}
                </ol>
              )}
            </Card>
            <Card title="Overdue by age">
              <ul className="space-y-3">
                {data.overdue_by_age.map((a) => (
                  <li key={a.label}>
                    <div className="flex justify-between text-sm"><span>{a.label} <span className="text-slate-500">({a.count})</span></span><span className="font-medium tabular-nums">{formatINR(a.amount)}</span></div>
                    <div className="mt-1 h-2 rounded bg-slate-100" aria-hidden><div className="h-2 rounded bg-red-400" style={{ width: `${(Number(a.amount) / maxAge) * 100}%` }} /></div>
                  </li>))}
              </ul>
              <p className="mt-3 text-xs text-slate-500">Older debts are harder to recover: act on them first.</p>
            </Card>
          </div>

          <Card title="Next 8 weeks">
            <figure>
              <div className="h-64" aria-hidden>
                {mounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeks} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={4}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickFormatter={lakh} tickLine={false} axisLine={false} fontSize={12} />
                    <Tooltip formatter={(v: number) => formatINR(v)} cursor={{ fill: "#f1f5f9" }} />
                    <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Falling due" fill="#60a5fa" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                    <Bar dataKey="Promised" fill="#16a34a" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                  </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full w-full rounded bg-slate-50 animate-pulse" />
                )}
              </div>
              <figcaption className="sr-only">{summary}</figcaption>
            </figure>
            <p className="mt-2 text-xs text-slate-500">Weeks start on Monday. A promise and a due date can refer to the same money, so the bars are not added together.</p>
          </Card>
          <Notice>{data.note}</Notice>
        </>
      )}
    </div>
  );
}
