"use client";

import {
  BriefcaseBusiness, CircleCheck, FolderOpen, TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, ErrorState, KpiCard, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import { useViewer } from "@/lib/auth/viewer";
import { formatINR } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

export default function AdviserPage() {
  const viewer = useViewer();
  const { data: cases, error, loading, reload } = useAsync(() => api.getAdviserCases(), []);

  const totalOutstanding = (cases ?? []).reduce((acc, c) => acc + Number(c.total_outstanding), 0);
  const actionNeeded = (cases ?? []).filter((c) => c.max_days_overdue > 0 || c.findings.some((f) => f.severity === "blocking")).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold"><BriefcaseBusiness className="text-brand-600" aria-hidden /> Adviser portal</h1>
        <p className="text-slate-600">
          Welcome{viewer?.name ? `, ${viewer.name}` : ""}. Cases that MSME suppliers share with you appear here for independent review and statutory guidance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Shared cases" value={String(cases?.length ?? 0)} sub="Assigned to your account" icon={<FolderOpen size={22} />} tone="blue" />
        <KpiCard label="Total claim value" value={formatINR(totalOutstanding)} sub="Principal + s.16 interest" icon={<CircleCheck size={22} />} tone="green" />
        <KpiCard label="Needing action" value={String(actionNeeded)} sub="Overdue or blocking issue" icon={<TriangleAlert size={22} />} tone="red" />
      </div>

      <Card title="Shared cases">
        {loading && !cases ? (
          <LoadingState label="Loading shared cases..." />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !cases || cases.length === 0 ? (
          <EmptyState title="No cases have been shared with you yet"
            body="When a supplier chooses your profile on their case page, it will be listed here with calculations and legal evaluation."
            action={<Link href="/legal" className="font-semibold text-brand-600 hover:underline">Open the Legal Assistant</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th scope="col" className="p-3 font-medium">Buyer</th>
                  <th scope="col" className="p-3 font-medium">Supplier</th>
                  <th scope="col" className="p-3 font-medium text-right">Unpaid</th>
                  <th scope="col" className="p-3 font-medium text-right">Statutory Interest</th>
                  <th scope="col" className="p-3 font-medium text-right">Total Claim</th>
                  <th scope="col" className="p-3 font-medium text-center">Eligibility</th>
                  <th scope="col" className="p-3 font-medium">Next Recommended Step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cases.map((c) => (
                  <tr key={c.case_id} className="hover:bg-slate-50">
                    <td className="p-3">
                      <span className="font-semibold text-slate-900">
                        {c.buyer_name}
                      </span>
                      {c.max_days_overdue > 0 && (
                        <span className="block text-[11px] font-medium text-red-600">
                          {c.max_days_overdue} days overdue
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-slate-700">{c.supplier_name}</td>
                    <td className="p-3 text-right tabular-nums">{formatINR(c.unpaid)}</td>
                    <td className="p-3 text-right tabular-nums text-red-600 font-medium">
                      {formatINR(c.estimated_interest)}
                    </td>
                    <td className="p-3 text-right tabular-nums font-bold">
                      {formatINR(c.total_outstanding)}
                    </td>
                    <td className="p-3 text-center">
                      <Badge tone={c.eligibility === "eligible" ? "green" : c.eligibility === "uncertain" ? "amber" : "red"}>
                        {c.eligibility}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Badge tone="blue">{c.next_action?.label ?? "Review case"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
