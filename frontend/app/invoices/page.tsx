"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { InvoicesTable } from "@/components/dashboard";
import { Card, ErrorState, EstimateNote, inputClass, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { InvoiceRow, PayStatus } from "@/types/api";

const SORTS: Record<string, (a: InvoiceRow, b: InvoiceRow) => number> = {
  newest: (a, b) => b.invoice_date.localeCompare(a.invoice_date),
  overdue: (a, b) => b.days_overdue - a.days_overdue,
  unpaid: (a, b) => Number(b.unpaid) - Number(a.unpaid),
  due: (a, b) => (a.last_day_to_pay ?? "9").localeCompare(b.last_day_to_pay ?? "9"),
};

export default function InvoicesPage() {
  const { data, error, loading, reload } = useAsync(() => api.listInvoices(), []);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | PayStatus>("all");
  const [sort, setSort] = useState("newest");
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? [])
      .filter((r) => status === "all" || r.status === status)
      .filter((r) => !s || r.number.toLowerCase().includes(s) || (r.buyer_name ?? "").toLowerCase().includes(s))
      .sort(SORTS[sort]);
  }, [data, q, status, sort]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Invoices</h1>
          <p className="mt-1 text-slate-600">Every invoice, when it was due and what is still unpaid.</p>
        </div>
        <Link href="/cases/new" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700">
          <Plus size={18} aria-hidden /> Add case with invoices
        </Link>
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative min-w-56 flex-1">
            <label htmlFor="inv-q" className="sr-only">Search by invoice number or buyer</label>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input id="inv-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice number or buyer" className={`${inputClass} pl-9`} />
          </div>
          <label htmlFor="inv-status" className="sr-only">Status</label>
          <select id="inv-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={`${inputClass} w-44!`}>
            <option value="all">All statuses</option><option value="overdue">Overdue</option><option value="due_soon">Due soon</option>
            <option value="not_due">Not yet due</option><option value="paid">Paid</option><option value="disputed">Disputed</option><option value="missing_dates">Dates missing</option>
          </select>
          <label htmlFor="inv-sort" className="sr-only">Sort</label>
          <select id="inv-sort" value={sort} onChange={(e) => setSort(e.target.value)} className={`${inputClass} w-48!`}>
            <option value="newest">Newest first</option><option value="overdue">Most days overdue</option>
            <option value="unpaid">Largest unpaid</option><option value="due">Due date</option>
          </select>
        </div>
        {loading && <LoadingState label="Loading invoices" />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {data && <InvoicesTable rows={rows} />}
        {data && <p className="mt-3 text-xs text-slate-500" aria-live="polite">Showing {rows.length} of {data.length} invoices</p>}
      </Card>
      <EstimateNote />
    </div>
  );
}
