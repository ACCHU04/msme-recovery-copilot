"use client";

import {
  BookOpenText, Calculator, CalendarClock, FileWarning,
  Percent, ShieldAlert, ShoppingBag, Store,
} from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, ErrorState, LoadingState, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { useViewer } from "@/lib/auth/viewer";
import { formatDate, formatINR } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

const DUTIES = [
  { icon: CalendarClock, title: "Pay on time (s.15)", body: "Pay a micro or small supplier by the date agreed in writing, never more than 45 days after you accept the goods or services. With no written agreement, the limit is 15 days." },
  { icon: Percent, title: "Interest if late (s.16)", body: "Late payments carry compound interest with monthly rests at three times the RBI Bank Rate, whatever the contract says." },
  { icon: FileWarning, title: "Disclose unpaid amounts (s.22)", body: "If you must have your accounts audited, show the principal and interest still unpaid to these suppliers in your annual accounts." },
  { icon: BookOpenText, title: "No tax deduction for that interest (s.23)", body: "Interest you pay under the Act cannot be deducted when working out your taxable income." },
];

const STATUS_TONE = {
  overdue: "red",
  due_soon: "amber",
  not_due: "slate",
  paid: "green",
} as const;

export default function BuyerDashboard() {
  const viewer = useViewer();
  const { data: invoices, error, loading, reload } = useAsync(() => api.getBuyerInvoices(), []);

  const totalUnpaid = (invoices ?? []).reduce((acc, inv) => acc + Number(inv.unpaid), 0);
  const totalInterest = (invoices ?? []).reduce((acc, inv) => acc + Number(inv.estimated_interest), 0);
  const overdueCount = (invoices ?? []).filter((inv) => inv.status === "overdue").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold"><ShoppingBag className="text-brand-600" aria-hidden /> Buyer dashboard</h1>
        <p className="text-slate-600">
          Welcome{viewer?.name ? `, ${viewer.name.split(" ")[0]}` : ""}{viewer?.businessName ? ` · ${viewer.businessName}` : ""}. Stay on the right side of the MSMED Act when you buy from micro and small suppliers.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {DUTIES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-5">
            <span className="h-fit rounded-xl bg-blue-50 p-3 text-brand-600" aria-hidden><Icon size={22} /></span>
            <div><h2 className="font-bold">{title}</h2><p className="mt-1 text-sm text-slate-700">{body}</p></div>
          </div>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Outstanding principal</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatINR(totalUnpaid)}</p>
          <p className="mt-1 text-xs text-slate-500">{invoices?.length ?? 0} invoices on file</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Statutory interest building up (s.16)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-red-600">{formatINR(totalInterest)}</p>
          <p className="mt-1 text-xs text-slate-500">Compounded monthly at 3× RBI Bank Rate</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Overdue invoices</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600">{overdueCount}</p>
          <p className="mt-1 text-xs text-slate-500">Action needed to protect tax deduction</p>
        </div>
      </div>

      {/* Section 43B(h) Alert */}
      {overdueCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 flex items-start gap-3">
          <ShieldAlert size={22} className="text-amber-700 shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm space-y-1">
            <p className="font-semibold">Section 43B(h) Deduction Protection Notice</p>
            <p className="text-amber-900">
              Under Section 43B(h) of the Income Tax Act, any sum payable to a registered micro or small enterprise beyond the Section 15 statutory time limit is deductible <strong>only in the financial year in which it is actually paid</strong>. Pay overdue invoices promptly to protect your expense deductions.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[2.5fr_1fr]">
        <Card title="Invoices from your suppliers">
          {loading && !invoices ? (
            <LoadingState label="Loading invoices..." />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : !invoices || invoices.length === 0 ? (
            <EmptyState
              title="Nothing linked to your account yet"
              body="Invoices raised by micro and small suppliers to your business will appear here with their legal due dates."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th scope="col" className="p-3 font-medium">Invoice</th>
                    <th scope="col" className="p-3 font-medium">Supplier</th>
                    <th scope="col" className="p-3 font-medium text-right">Amount</th>
                    <th scope="col" className="p-3 font-medium text-right">Unpaid</th>
                    <th scope="col" className="p-3 font-medium">Pay by</th>
                    <th scope="col" className="p-3 font-medium text-right">s.16 Interest</th>
                    <th scope="col" className="p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="p-3 font-medium text-slate-900">{inv.number}</td>
                      <td className="p-3 text-slate-700">{inv.supplier_name}</td>
                      <td className="p-3 text-right tabular-nums">{formatINR(inv.amount)}</td>
                      <td className="p-3 text-right tabular-nums font-semibold">{formatINR(inv.unpaid)}</td>
                      <td className="p-3 text-xs text-slate-600">
                        {inv.last_day_to_pay ? formatDate(inv.last_day_to_pay) : "—"}
                        {inv.days_overdue > 0 && (
                          <span className="block text-[11px] font-medium text-red-600">
                            {inv.days_overdue} days late
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums text-red-600 font-medium">
                        {Number(inv.estimated_interest) > 0 ? formatINR(inv.estimated_interest) : "₹0"}
                      </td>
                      <td className="p-3">
                        <Badge tone={STATUS_TONE[inv.status]}>
                          {inv.status === "due_soon" ? "Due soon" : inv.status === "not_due" ? "On schedule" : inv.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Useful tools">
          <div className="space-y-3">
            <Link href="/legal" className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <Calculator size={20} className="text-brand-600" aria-hidden />
              <span><span className="block font-semibold">Verify statutory interest</span><span className="text-xs text-slate-600">Check statutory 3× Bank Rate compound interest</span></span>
            </Link>
            <Link href="/marketplace" className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <Store size={20} className="text-brand-600" aria-hidden />
              <span><span className="block font-semibold">MSME Marketplace</span><span className="text-xs text-slate-600">Discover verified suppliers</span></span>
            </Link>
          </div>
        </Card>
      </div>

      <Notice>A summary of the MSMED Act, 2006 for guidance, not legal advice. The Act protects micro and small enterprises registered on Udyam.</Notice>
    </div>
  );
}
