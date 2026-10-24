"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { DraftEditor, FindingsList, NextActionCard, ReadinessBar, RecoveryJourney } from "@/components/cases";
import { Badge, Card, EmptyState, ErrorState, inputClass, LoadingState, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatINR } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { DraftKind, Evaluation } from "@/types/api";

function Timeline({ ev }: { ev: Evaluation }) {
  const items = [
    ...ev.followups.map((f) => ({ date: f.sent_on, text: `${["", "Friendly nudge", "Firm reminder", "Formal demand"][f.step]} sent${f.reply_received ? ", buyer replied" : ", no reply"}` })),
    ...ev.promises.map((p) => ({ date: p.made_on, text: `Buyer promised ${formatINR(p.amount)} by ${formatDate(p.due_date)}: ${p.status.replace("_", " ")}` })),
    ...ev.invoices.filter((i) => i.due?.last_day_to_pay).map((i) => ({ date: i.due!.last_day_to_pay!, text: `${i.number} payment due` })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ol className="space-y-2 border-l border-slate-200 pl-4">
      {items.map((x, i) => (
        <li key={i} className="text-sm"><span className="text-xs text-slate-500">{formatDate(x.date)}</span><p className="text-slate-800">{x.text}</p></li>
      ))}
    </ol>
  );
}

function Assistant() {
  const params = useSearchParams();
  const router = useRouter();
  const cases = useAsync(() => api.listCases(), []);
  const selected = params.get("case") ?? cases.data?.find((c) => c.totals)?.id ?? null;
  const [draftKind, setDraftKind] = useState<DraftKind | null>(null);
  const ev = useAsync(async () => (selected ? api.evaluate(selected) : null), [selected]);

  if (cases.loading) return <LoadingState label="Loading cases" />;
  if (cases.error) return <ErrorState message={cases.error} onRetry={cases.reload} />;
  const withInvoices = (cases.data ?? []).filter((c) => c.totals);
  if (withInvoices.length === 0)
    return <EmptyState title="No cases to review" body="Add a case with at least one invoice first."
      action={<Link href="/cases/new" className="font-medium text-brand-600 underline">Add case</Link>} />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Recovery assistant</h1>
          <p className="text-sm text-slate-600">A suggested next step with its reasons. You review every message and send it yourself.</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="case-pick" className="text-xs font-medium text-slate-600">Case</label>
          <select id="case-pick" value={selected ?? ""} className={`${inputClass} w-64!`}
            onChange={(e) => { setDraftKind(null); router.replace(`/assistant?case=${e.target.value}`); }}>
            {withInvoices.map((c) => <option key={c.id} value={c.id}>{c.buyer_name} · {formatINR(c.totals?.total)}</option>)}
          </select>
        </div>
      </div>

      {ev.loading && <LoadingState label="Checking the case" />}
      {ev.error && <ErrorState message={ev.error} onRetry={ev.reload} />}
      {ev.data && selected && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            <RecoveryJourney ev={ev.data} />
            <NextActionCard ev={ev.data} onDraft={setDraftKind} />
            {draftKind && <DraftEditor caseId={selected} kind={draftKind} onClose={() => setDraftKind(null)} onLogged={ev.reload} />}
            <Card title="What needs attention"><FindingsList findings={ev.data.findings.filter((f) => f.severity !== "info")} /></Card>
          </div>
          <div className="space-y-6">
            <Card title="Case readiness">
              <ReadinessBar ev={ev.data} />
              <div className="mt-3 flex flex-wrap gap-2">
                {ev.data.findings.some((f) => f.severity === "blocking") && <Badge tone="red">Has blocking issues</Badge>}
                <Badge tone={ev.data.eligibility.verdict === "eligible" ? "green" : "amber"}>
                  {ev.data.eligibility.verdict === "eligible" ? "Act applies" : "Eligibility needs confirmation"}
                </Badge>
              </div>
            </Card>
            <Card title="Recovery timeline"><Timeline ev={ev.data} /></Card>
            <Link href={`/cases/${selected}`} className="block text-sm font-medium text-brand-600 hover:underline">Open full case</Link>
          </div>
        </div>
      )}
      <Notice>Drafts are built from fixed templates with figures from the calculation. AI wording is not switched on in this version.</Notice>
    </div>
  );
}

export default function AssistantPage() {
  return <Suspense fallback={<LoadingState />}><Assistant /></Suspense>;
}
