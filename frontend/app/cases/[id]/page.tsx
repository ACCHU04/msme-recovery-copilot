"use client";

import { ShareCase } from "@/components/sharing";
import { FileText } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  CaseFactsForm, DraftEditor, RecoveryJourney, EvidenceChecklist, FindingsList, FollowupLog, InvoicesPanel,
  NextActionCard, PromisesPanel, ReadinessBar, SettlementCard,
} from "@/components/cases";
import { BucketBadge, Card, ErrorState, EstimateNote, inputClass, LoadingState, VerdictBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatINR, todayISO, totalsConsistent } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { DraftKind } from "@/types/api";

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const [asOf, setAsOf] = useState(todayISO());
  const [draftKind, setDraftKind] = useState<DraftKind | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const c = await api.getCase(id);
    const ev = c.invoices.length ? await api.evaluate(id, asOf) : null;
    return { c, ev };
  }, [id, asOf]);

  if (loading && !data) return <LoadingState label="Loading case" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const { c, ev } = data;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500"><Link href="/cases" className="hover:underline">Recovery cases</Link> / {c.buyer.name}</p>
          <h1 className="text-3xl font-bold">{c.buyer.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span>PO {formatDate(c.contract_date)}</span>
            {ev && <><BucketBadge bucket={ev.bucket} /><VerdictBadge verdict={ev.eligibility.verdict} /></>}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="as-of" className="text-xs font-medium text-slate-600">Value as of</label>
            <input id="as-of" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className={`${inputClass} w-40!`} />
          </div>
          <Link href={`/cases/${id}/report?asOf=${asOf}`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50">
            <FileText size={16} aria-hidden /> Report
          </Link>
        </div>
      </div>

      {!ev ? (
        <Card title="No invoices yet"><p className="text-sm text-slate-600">This case has no invoices. Add one from the case form to get a calculation.</p>
          <Link href="/cases/new" className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline">Add a case with invoices</Link></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[["Principal outstanding", ev.totals.principal], ["Estimated interest", ev.totals.interest], ["Estimated total", ev.totals.total]].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm text-slate-600">{l}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatINR(v)}</p>
              </div>
            ))}
          </div>
          {!totalsConsistent(ev.totals) && <ErrorState message="The total returned does not equal principal plus interest. Shown as returned; please report this." />}
          {ev.eligibility.verdict !== "eligible" && (
            <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Eligibility: {ev.eligibility.verdict === "uncertain" ? "needs confirmation" : "not eligible"}</p>
              {ev.eligibility.reasons.map((r) => <p key={r}>{r}</p>)}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-6">
              <RecoveryJourney ev={ev} />
              <NextActionCard ev={ev} onDraft={setDraftKind} />
              {draftKind && <DraftEditor caseId={id} kind={draftKind} onClose={() => setDraftKind(null)} onLogged={reload} />}
              <Card title="Case check"><FindingsList findings={ev.findings} /></Card>
              <Card title="Invoices"><InvoicesPanel ev={ev} /></Card>
              <Card title="Payment promises"><PromisesPanel caseId={id} ev={ev} onChange={reload} /></Card>
              <SettlementCard caseId={id} calcId={ev.calculation_id} />
            </div>
            <div className="space-y-6">
              <Card title="Evidence"><div className="mb-4"><ReadinessBar ev={ev} /></div>
                <EvidenceChecklist caseId={id} evidence={c.evidence} onChange={reload} /></Card>
              <Card title="Messages sent"><FollowupLog ev={ev} onChange={reload} /></Card>
              <Card title="Share with an adviser"><ShareCase caseId={id} /></Card>
              <Card title="Case facts"><CaseFactsForm key={`${c.po_amount}-${c.dispute_reason}-${c.allocation}`} c={c} onChange={reload} /></Card>
              <p className="text-xs text-slate-500">Values as of {formatDate(ev.as_of)} · engine {ev.engine_version} · {formatINR(ev.totals.total)} total</p>
            </div>
          </div>
          <EstimateNote />
        </>
      )}
    </div>
  );
}
