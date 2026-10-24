"use client";

import { ChevronRight, FileSignature, Hourglass, Plus, Search, TriangleAlert, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, EmptyState, ErrorState, inputClass, KpiCard, LoadingState, Notice } from "@/components/ui";
import { contractStatus, loadContracts } from "@/lib/contracts";
import { formatDate, formatINR } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

export default function ContractsPage() {
  const { data, error, loading, reload } = useAsync(loadContracts, []);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const rows = useMemo(() => (data ?? []).filter((r) => {
    const s = q.trim().toLowerCase();
    const matches = !s || r.ref.toLowerCase().includes(s) || (r.c.buyer_name ?? "").toLowerCase().includes(s);
    return matches && (status === "all" || contractStatus(r).label === status);
  }), [data, q, status]);
  const sum = (k: "invoiced" | "paid" | "unpaid") => (data ?? []).reduce((s, r) => s + Math.round(r[k] * 100), 0) / 100;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold"><FileSignature size={28} className="text-brand-600" aria-hidden /> Contracts and purchase orders</h1>
          <p className="mt-1 text-slate-600">Each order with a buyer: its value, what you have invoiced, and what has been paid.</p>
        </div>
        <Link href="/cases/new" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700">
          <Plus size={18} aria-hidden /> Add contract
        </Link>
      </div>

      {loading && <LoadingState label="Loading contracts" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Contracts" value={String(data.length)} sub={`${data.filter((r) => r.unpaid > 0).length} with money owed`} icon={<FileSignature size={22} />} tone="violet" />
            <KpiCard label="Invoiced" value={formatINR(sum("invoiced"))} icon={<Wallet size={22} />} tone="blue" valueClass="text-brand-600" />
            <KpiCard label="Paid" value={formatINR(sum("paid"))} icon={<Wallet size={22} />} tone="green" valueClass="text-emerald-700" />
            <KpiCard label="Outstanding" value={formatINR(sum("unpaid"))} sub={<span className="text-red-600">{data.filter((r) => r.overdueCount).length} with overdue invoices</span>} icon={<Hourglass size={22} />} tone="amber" valueClass="text-orange-600" />
          </div>

          <Card>
            <div className="mb-4 flex flex-wrap gap-3">
              <div className="relative min-w-56 flex-1">
                <label htmlFor="c-q" className="sr-only">Search by PO reference or buyer</label>
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input id="c-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PO reference or buyer" className={`${inputClass} pl-9`} />
              </div>
              <label htmlFor="c-status" className="sr-only">Status</label>
              <select id="c-status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputClass} w-48!`}>
                <option value="all">All statuses</option><option>Payment overdue</option><option>Active</option>
                <option>Fully paid</option><option>Disputed</option><option>No invoices</option>
              </select>
            </div>
            {rows.length === 0 ? <EmptyState title="No contracts match" body="Try another search, or add a contract." /> : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[960px] text-sm">
                  <caption className="sr-only">Contracts and purchase orders</caption>
                  <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                    <th scope="col" className="py-2.5 pl-3 text-left font-semibold">PO reference</th>
                    <th scope="col" className="py-2.5 text-left font-semibold">Buyer</th>
                    <th scope="col" className="py-2.5 text-left font-semibold">PO date</th>
                    <th scope="col" className="py-2.5 text-right font-semibold">PO value</th>
                    <th scope="col" className="py-2.5 text-right font-semibold">Invoiced</th>
                    <th scope="col" className="py-2.5 text-right font-semibold">Paid</th>
                    <th scope="col" className="py-2.5 text-right font-semibold">Outstanding</th>
                    <th scope="col" className="py-2.5 pl-4 text-left font-semibold">Status</th>
                    <th scope="col"><span className="sr-only">Open</span></th>
                  </tr></thead>
                  <tbody>{rows.map((r) => {
                    const st = contractStatus(r);
                    return (
                      <tr key={r.c.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 pl-3 font-medium whitespace-nowrap"><Link href={`/contracts/${r.c.id}`} className="text-brand-600 hover:underline">{r.ref}</Link></td>
                        <td className="py-3">{r.c.buyer_name}</td>
                        <td className="py-3 whitespace-nowrap">{formatDate(r.c.contract_date)}</td>
                        <td className="py-3 text-right tabular-nums">{r.poValue === null ? <span className="text-slate-500">Not set</span> : formatINR(r.poValue)}</td>
                        <td className="py-3 text-right tabular-nums">{formatINR(r.invoiced)}</td>
                        <td className="py-3 text-right tabular-nums">{formatINR(r.paid)}</td>
                        <td className="py-3 text-right font-semibold tabular-nums">{formatINR(r.unpaid)}</td>
                        <td className="py-3 pl-4"><Badge tone={st.tone} icon={st.tone === "red" ? <TriangleAlert size={12} aria-hidden /> : undefined}>{st.label}</Badge></td>
                        <td className="py-3 pr-3"><Link href={`/contracts/${r.c.id}`} className="inline-flex items-center font-medium text-brand-600 hover:underline">View <ChevronRight size={14} aria-hidden /></Link></td>
                      </tr>);
                  })}</tbody>
                </table>
              </div>
            )}
          </Card>
          <Notice>PO references are generated from the order date and case ID. Add the PO value on a contract to check invoices against it.</Notice>
        </>
      )}
    </div>
  );
}
