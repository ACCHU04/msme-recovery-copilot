"use client";

import { FileBarChart, FileText, Printer, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BucketBadge, Card, EmptyState, ErrorState, inputClass, KpiCard, LoadingState, Notice, VerdictBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatINR, todayISO } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

const INCLUDES = [
  "Summary: principal, estimated interest, total, eligibility and next step",
  "Invoice table with acceptance, last day to pay and interest start",
  "Month-by-month interest schedule with the Bank Rate used",
  "Evidence checklist and ODR readiness",
  "Points to check, payment promises and assumptions",
  "How to file on the MSME ODR portal, and the disclaimer",
];

export default function ReportsPage() {
  const [asOf, setAsOf] = useState(todayISO());
  const { data, error, loading, reload } = useAsync(() => api.listCases(), []);
  const cases = (data ?? []).filter((c) => c.totals);
  const total = cases.reduce((s, c) => s + Math.round(Number(c.totals!.total) * 100), 0) / 100;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold"><FileBarChart size={28} className="text-brand-600" aria-hidden /> Reports</h1>
          <p className="mt-1 text-slate-600">A printable case report for your records, a professional, or an ODR filing.</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="rep-asof" className="text-xs font-medium text-slate-600">Value reports as of</label>
          <input id="rep-asof" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className={`${inputClass} w-44!`} />
        </div>
      </div>

      {loading && <LoadingState label="Loading cases" />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard label="Cases with invoices" value={String(cases.length)} sub={`${data.length} case(s) in total`} icon={<FileText size={22} />} tone="blue" />
            <KpiCard label="Estimated total owed" value={formatINR(total)} sub="As of today, across these cases" icon={<FileBarChart size={22} />} tone="amber" valueClass="text-orange-600" />
            <KpiCard label="Eligible under the Act" value={`${cases.filter((c) => c.eligibility === "eligible").length} of ${cases.length}`} sub="Others get reminders only" icon={<ShieldCheck size={22} />} tone="green" />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card title="Case reports">
              {cases.length === 0 ? (
                <EmptyState title="No cases with invoices" body="Reports need at least one invoice." action={<Link href="/cases/new" className="font-medium text-brand-600 underline">Add case</Link>} />
              ) : (
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <caption className="sr-only">Case reports available</caption>
                    <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                      <th scope="col" className="py-2.5 pl-3 text-left font-semibold">Buyer</th>
                      <th scope="col" className="py-2.5 text-left font-semibold">PO date</th>
                      <th scope="col" className="py-2.5 text-right font-semibold">Est. total</th>
                      <th scope="col" className="py-2.5 pl-4 text-left font-semibold">Status</th>
                      <th scope="col" className="py-2.5 text-left font-semibold">Eligibility</th>
                      <th scope="col" className="py-2.5 text-left font-semibold"><span className="sr-only">Actions</span></th>
                    </tr></thead>
                    <tbody>{cases.map((c) => (
                      <tr key={c.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 pl-3 pr-3 font-medium">{c.buyer_name}</td>
                        <td className="py-3 whitespace-nowrap">{formatDate(c.contract_date)}</td>
                        <td className="py-3 text-right font-semibold tabular-nums">{formatINR(c.totals?.total)}</td>
                        <td className="py-3 pl-4"><BucketBadge bucket={c.bucket} /></td>
                        <td className="py-3"><VerdictBadge verdict={c.eligibility} /></td>
                        <td className="py-3 pr-3 text-right">
                          <Link href={`/cases/${c.id}/report?asOf=${asOf}`}
                            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white hover:bg-brand-700">
                            <Printer size={15} aria-hidden /> Open<span className="sr-only"> report for {c.buyer_name}</span>
                          </Link>
                        </td>
                      </tr>))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <div className="space-y-6">
              <Card title="Each report includes">
                <ul className="space-y-2 text-sm">{INCLUDES.map((x) => (
                  <li key={x} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden />{x}</li>))}
                </ul>
              </Card>
              <Notice>Reports are drafts for your review, not official legal documents. Use “Print or save as PDF” in the report to download it.</Notice>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
