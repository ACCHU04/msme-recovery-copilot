"use client";

// Buyer view of linked invoices, supplier -> adviser case sharing, and the adviser's list.
import { FolderOpen, Share2, Trash2, TriangleAlert, UserCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, inputClass, KpiCard, LoadingState } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatINR } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { BuyerInvoice, CaseShare, SharedCase } from "@/types/api";

const STATUS_TONE: Record<string, "red" | "amber" | "green" | "slate" | "blue"> = {
  overdue: "red", due_soon: "amber", not_due: "blue", paid: "green", disputed: "amber",
};
const STATUS_LABEL: Record<string, string> = {
  overdue: "Overdue", due_soon: "Due soon", not_due: "Not due", paid: "Paid", disputed: "Disputed",
};

/** Buyer dashboard: invoices suppliers have raised to this buyer, with the statutory amount. */
export function BuyerInvoices() {
  const { data, error, loading, reload } = useAsync(() => api.buyerInvoices(), []);
  if (loading) return <LoadingState label="Loading invoices" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const rows = data?.invoices ?? [];
  if (rows.length === 0) {
    return <EmptyState title="Nothing linked to your account yet"
      body="When a supplier's buyer record is linked to your account, the invoices they raised to you appear here with their legal due dates." />;
  }
  const overdue = rows.filter((r) => r.status === "overdue");
  const interest = overdue.reduce((s, r) => s + Number(r.estimated_interest ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Overdue invoices" value={String(overdue.length)} sub={formatINR(overdue.reduce((s, r) => s + Number(r.unpaid), 0)) + " unpaid"} icon={<TriangleAlert size={20} />} tone="red" valueClass="text-red-600" />
        <KpiCard label="Interest building up" value={formatINR(interest)} sub="Section 16, estimated" icon={<TriangleAlert size={20} />} tone="amber" />
        <KpiCard label="Suppliers" value={String(new Set(rows.map((r) => r.supplier_name)).size)} sub={data?.buyer_name ?? ""} icon={<UserCheck size={20} />} tone="blue" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <caption className="sr-only">Invoices raised to you</caption>
          <thead className="bg-slate-50 text-xs text-slate-600"><tr>
            <th scope="col" className="py-2 pl-3 text-left font-semibold">Invoice</th>
            <th scope="col" className="text-left font-semibold">Supplier</th>
            <th scope="col" className="text-left font-semibold">Pay by (law)</th>
            <th scope="col" className="text-right font-semibold">Unpaid</th>
            <th scope="col" className="text-right font-semibold">With interest</th>
            <th scope="col" className="pl-3 text-left font-semibold">Status</th>
          </tr></thead>
          <tbody>{rows.map((r: BuyerInvoice) => (
            <tr key={r.id} className="border-b border-slate-100 last:border-0">
              <td className="py-2.5 pl-3 font-medium">{r.number}<span className="block text-xs text-slate-500">{formatDate(r.invoice_date)}</span></td>
              <td>{r.supplier_name}<span className="block text-xs capitalize text-slate-500">{r.supplier_size} enterprise</span></td>
              <td>{r.last_day_to_pay ? formatDate(r.last_day_to_pay) : "—"}</td>
              <td className="text-right tabular-nums">{formatINR(Number(r.unpaid))}</td>
              <td className="text-right tabular-nums">{r.statutory_total && Number(r.unpaid) > 0 ? formatINR(Number(r.statutory_total)) : "—"}</td>
              <td className="pl-3"><Badge tone={STATUS_TONE[r.status] ?? "slate"}>{STATUS_LABEL[r.status] ?? r.status}{r.status === "overdue" && r.days_overdue ? ` · ${r.days_overdue} days` : ""}</Badge></td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Figures are estimates from the supplier&apos;s records and the MSMED Act rules; check them with the supplier. Paying before the legal date stops interest and protects your income-tax deduction.</p>
    </div>
  );
}

/** Supplier's case page: share this case, read-only, with an approved adviser. */
export function ShareCase({ caseId }: { caseId: string }) {
  const { data, error, loading, reload } = useAsync(() => api.listShares(caseId), [caseId]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const share = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try { await api.addShare(caseId, email.trim()); setEmail(""); reload(); }
    catch (err) { setMsg(err instanceof ApiError ? err.message : "Couldn't share the case."); }
    finally { setBusy(false); }
  };
  const remove = async (s: CaseShare) => {
    try { await api.removeShare(s.id); reload(); }
    catch (err) { setMsg(err instanceof ApiError ? err.message : "Couldn't stop sharing."); }
  };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">An approved adviser (CA or lawyer) can see this case&apos;s figures, next step and missing evidence. They can&apos;t change anything.</p>
      {loading && <LoadingState label="Loading" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {(data ?? []).map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5">
          <div className="min-w-0"><p className="font-medium">{s.adviser_name ?? s.adviser_email}</p>
            <p className="truncate text-xs text-slate-500">{[s.adviser_firm, s.adviser_email].filter(Boolean).join(" · ")}</p></div>
          <button type="button" aria-label={`Stop sharing with ${s.adviser_name ?? s.adviser_email}`} onClick={() => remove(s)}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100"><Trash2 size={16} aria-hidden /></button>
        </div>))}
      <form onSubmit={share} className="flex gap-2">
        <label htmlFor="share-email" className="sr-only">Adviser&apos;s email</label>
        <input id="share-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Adviser's account email" className={inputClass} />
        <Button type="submit" variant="primary" disabled={busy}><Share2 size={16} aria-hidden /> Share</Button>
      </form>
      {msg && <p role="alert" className="text-red-700">{msg}</p>}
    </div>
  );
}

/** Adviser portal: cases suppliers have shared with this adviser. */
export function SharedCases() {
  const { data, error, loading, reload } = useAsync(() => api.adviserCases(), []);
  if (loading) return <LoadingState label="Loading shared cases" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const rows = data ?? [];
  const action = rows.filter((r) => r.next_action && !["close_case", "wait_until_due", "await_promise"].includes(r.next_action.action));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Shared cases" value={String(rows.length)} sub={`${new Set(rows.map((r) => r.supplier_name)).size} supplier(s)`} icon={<FolderOpen size={22} />} tone="blue" />
        <KpiCard label="Needing action" value={String(action.length)} icon={<TriangleAlert size={22} />} tone="red" valueClass="text-red-600" />
        <KpiCard label="Amount at stake" value={formatINR(rows.reduce((s, r) => s + Number(r.totals?.total ?? 0), 0))} sub="Including interest where eligible" icon={<UserCheck size={22} />} tone="green" />
      </div>
      <Card title={`Shared with you (${rows.length})`}>
        {rows.length === 0 ? <EmptyState title="No cases have been shared with you yet"
          body="A supplier shares a case from its case page using your account email. Only that case becomes visible to you, read-only." /> : (
          <ul className="space-y-3">{rows.map((r: SharedCase) => (
            <li key={r.share_id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{r.supplier_name} <span className="font-normal text-slate-500">→</span> {r.buyer_name}
                    {r.buyer_is_cpse && <span className="ml-2"><Badge tone="blue">Central PSU</Badge></span>}</p>
                  <p className="text-xs text-slate-500"><span className="capitalize">{r.supplier_size}</span> enterprise · {r.invoice_count} invoice(s) · shared {r.shared_on ? formatDate(r.shared_on.slice(0, 10)) : ""}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold tabular-nums">{r.totals ? formatINR(Number(r.totals.total)) : "—"}</p>
                  <p className="text-xs text-slate-500">{r.totals && Number(r.totals.interest) > 0 ? `incl. ${formatINR(Number(r.totals.interest))} interest` : "principal"}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.eligibility && <Badge tone={r.eligibility === "eligible" ? "green" : r.eligibility === "uncertain" ? "amber" : "red"}>MSMED: {r.eligibility}</Badge>}
                {r.next_action && <Badge tone="blue">Next: {r.next_action.label}</Badge>}
                {r.evidence_missing.length > 0 && <Badge tone="amber">Missing: {r.evidence_missing.join(", ").replaceAll("_", " ")}</Badge>}
              </div>
              {r.next_action?.reasons?.[0] && <p className="mt-2 text-sm text-slate-700">{r.next_action.reasons[0]}</p>}
            </li>))}
          </ul>)}
      </Card>
    </div>
  );
}
