"use client";

import {
  BriefcaseBusiness, Check, ChevronRight, CircleCheck, Clock, FileText, FolderOpen, Hourglass, Info, Search, Send, StickyNote, TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, EmptyState, ErrorState, inputClass, KpiCard, LoadingState } from "@/components/ui";
import { api } from "@/lib/api";
import { authEnabled } from "@/lib/auth/config";
import { SharedCases } from "@/components/sharing";
import { useViewer } from "@/lib/auth/viewer";
import { contractRef, loadContracts, type ContractRow } from "@/lib/contracts";
import { EVIDENCE_LABEL, formatDate, formatINR } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { Evaluation, EvidenceKind } from "@/types/api";

type Row = ContractRow & { ev: Evaluation | null; priority: "High" | "Medium" | "Low" };
const PRIORITY_TONE = { High: "red", Medium: "amber", Low: "slate" } as const;
const STAGES = ["Case opened", "Reminder sent", "Buyer responded", "Formal reminder", "Evidence ready", "Resolved"];

function priorityOf(r: ContractRow, ev: Evaluation | null): Row["priority"] {
  if (r.unpaid === 0) return "Low";
  if (r.maxDaysOverdue > 90 || r.unpaid >= 200000 || ev?.findings.some((f) => f.severity === "blocking")) return "High";
  if (r.overdueCount > 0) return "Medium";
  return "Low";
}

async function load(): Promise<Row[]> {
  const rows = await loadContracts();
  return Promise.all(rows.map(async (r) => {
    const ev = r.invoices.length ? await api.viewEvaluation(r.c.id).catch(() => null) : null;
    return { ...r, ev, priority: priorityOf(r, ev) };
  }));
}

function stagesDone(r: Row): boolean[] {
  const fu = r.ev?.followups ?? [];
  return [true, fu.length > 0, fu.some((f) => f.reply_received) || (r.ev?.promises.length ?? 0) > 0,
    fu.some((f) => f.step >= 2), !!r.ev?.readiness.odr_ready, r.unpaid === 0];
}

function Notes({ caseId }: { caseId: string }) {
  const key = `ls03.notes.${caseId}`;
  const [notes, setNotes] = useState<{ at: string; text: string }[]>([]);
  const [text, setText] = useState("");
  useEffect(() => {
    try { setNotes(JSON.parse(localStorage.getItem(key) ?? "[]")); } catch { setNotes([]); }
  }, [key]);
  const add = () => {
    if (!text.trim()) return;
    const next = [{ at: new Date().toISOString(), text: text.trim() }, ...notes];
    setNotes(next); setText("");
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage blocked: kept for this visit only */ }
  };
  return (
    <div className="space-y-3">
      <label htmlFor={`note-${caseId}`} className="sr-only">New case note</label>
      <textarea id={`note-${caseId}`} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a case note" className={inputClass} />
      <Button onClick={add} className="py-1.5">Add note</Button>
      {notes.length === 0 ? <p className="text-sm text-slate-600">No notes yet.</p> : (
        <ul className="space-y-2">{notes.map((n) => (
          <li key={n.at} className="rounded-lg bg-slate-50 p-2.5 text-sm"><p>{n.text}</p><p className="mt-1 text-xs text-slate-500">{new Date(n.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p></li>))}
        </ul>
      )}
      <p className="text-xs text-slate-500">Notes are saved in this browser only.</p>
    </div>
  );
}

function Detail({ r }: { r: Row }) {
  const [tab, setTab] = useState<"Overview" | "Documents" | "Notes" | "Timeline">("Overview");
  const done = stagesDone(r);
  const current = done.findIndex((d) => !d);
  const timeline = [
    ...r.invoices.map((i) => ({ date: i.invoice_date, text: `${i.number} raised, ${formatINR(i.amount)}` })),
    ...r.invoices.flatMap((i) => i.payments.map((p) => ({ date: p.paid_on, text: `${formatINR(p.amount)} received (${i.number})` }))),
    ...(r.ev?.followups ?? []).map((f) => ({ date: f.sent_on, text: `${["", "Friendly nudge", "Firm reminder", "Formal demand"][f.step]} sent` })),
    ...(r.ev?.promises ?? []).map((p) => ({ date: p.made_on, text: `Promise of ${formatINR(p.amount)} by ${formatDate(p.due_date)}: ${p.status.replace("_", " ")}` })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold">{r.ref}</h2>
        <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority} priority</Badge>
      </div>
      <p className="mt-1 font-semibold">{r.c.buyer_name}</p>
      <p className="text-sm text-slate-600">{r.ev ? `Next step: ${r.ev.next_action.label}` : "No invoices yet"}</p>
      <div role="tablist" aria-label="Case details" className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
        {(["Overview", "Documents", "Notes", "Timeline"] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === t ? "border-brand-600 text-brand-600" : "border-transparent text-slate-600")}>{t}</button>
        ))}
      </div>
      <div className="mt-4" role="tabpanel" aria-label={tab}>
        {tab === "Overview" && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Invoices</dt><dd>{r.invoices.map((i) => i.number).join(", ") || "—"}</dd>
              <dt className="text-slate-500">Unpaid</dt><dd className="font-semibold">{formatINR(r.unpaid)}</dd>
              <dt className="text-slate-500">With interest (est.)</dt><dd>{r.ev ? formatINR(r.ev.totals.total) : "—"}</dd>
              <dt className="text-slate-500">Days delayed</dt><dd className={r.maxDaysOverdue ? "font-semibold text-red-600" : ""}>{r.maxDaysOverdue || "—"}</dd>
              <dt className="text-slate-500">Eligibility</dt><dd>{r.ev ? { eligible: "Eligible", not_eligible: "Not eligible", uncertain: "Needs confirmation" }[r.ev.eligibility.verdict] : "—"}</dd>
              <dt className="text-slate-500">PO date</dt><dd>{formatDate(r.c.contract_date)}</dd>
            </dl>
            <div>
              <p className="mb-2 text-sm font-semibold">Case progress</p>
              <ol className="space-y-2">{STAGES.map((s, i) => (
                <li key={s} className="flex items-center gap-2 text-sm" aria-current={i === current ? "step" : undefined}>
                  <span className={cx("flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-semibold",
                    done[i] ? "border-emerald-600 bg-emerald-600 text-white" : i === current ? "border-brand-600 text-brand-600" : "border-slate-300 text-slate-400")}>
                    {done[i] ? <Check size={12} aria-hidden /> : i + 1}</span>
                  <span className={cx(i === current && "font-semibold text-brand-600")}>{s}</span>
                  <span className="sr-only">{done[i] ? "(done)" : i === current ? "(current)" : ""}</span>
                </li>))}
              </ol>
            </div>
          </div>
        )}
        {tab === "Documents" && (
          <ul className="space-y-2 text-sm">{(r.ev ? [...r.ev.readiness.have.map((k): [EvidenceKind, boolean] => [k, true]), ...r.ev.readiness.missing.map((k): [EvidenceKind, boolean] => [k, false])] : []).map(([k, ok]) => (
            <li key={k} className="flex items-center justify-between"><span>{EVIDENCE_LABEL[k]}</span><Badge tone={ok ? "green" : "red"}>{ok ? "On file" : "Missing"}</Badge></li>))}
            {r.ev && <li className="pt-2 text-xs text-slate-500">{r.ev.readiness.score}</li>}
          </ul>
        )}
        {tab === "Notes" && <Notes caseId={r.c.id} />}
        {tab === "Timeline" && (
          timeline.length === 0 ? <p className="text-sm text-slate-600">Nothing recorded yet.</p> : (
            <ol className="space-y-2 border-l border-slate-200 pl-4">{timeline.map((x, i) => (
              <li key={i} className="text-sm"><p className="text-xs text-slate-500">{formatDate(x.date)}</p><p>{x.text}</p></li>))}
            </ol>)
        )}
      </div>
      <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
        <p className="text-sm font-semibold">Quick actions</p>
        {[
          { href: `/assistant?case=${r.c.id}`, icon: Send, label: "Draft a reminder to the buyer" },
          { href: `/cases/${r.c.id}`, icon: FolderOpen, label: "Request missing documents" },
          { href: `/cases/${r.c.id}/report`, icon: FileText, label: "Prepare the case report" },
        ].map(({ href, icon: Icon, label }) => (
          <Link key={label} href={href} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:border-brand-600">
            <Icon size={16} className="text-brand-600" aria-hidden /><span className="flex-1">{label}</span><ChevronRight size={16} aria-hidden />
          </Link>))}
      </div>
    </Card>
  );
}

function AdviserPreview() {
  const { data, error, loading, reload } = useAsync(load, []);
  const [tab, setTab] = useState<"all" | "action" | "resolved">("all");
  const [q, setQ] = useState("");
  const [prio, setPrio] = useState("all");
  const [sel, setSel] = useState<string | null>(null);
  const rows = useMemo(() => (data ?? [])
    .filter((r) => tab === "all" || (tab === "resolved" ? r.unpaid === 0 && r.invoices.length > 0 : r.unpaid > 0))
    .filter((r) => prio === "all" || r.priority === prio)
    .filter((r) => { const s = q.trim().toLowerCase(); return !s || r.ref.toLowerCase().includes(s) || (r.c.buyer_name ?? "").toLowerCase().includes(s) || r.invoices.some((i) => i.number.toLowerCase().includes(s)); })
    .sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.priority] - { High: 0, Medium: 1, Low: 2 }[b.priority]) || b.unpaid - a.unpaid), [data, tab, q, prio]);
  const selected = rows.find((r) => r.c.id === sel) ?? rows[0];
  const all = data ?? [];
  const overdue = all.filter((r) => r.overdueCount > 0);
  const avg = overdue.length ? Math.round(overdue.reduce((s, r) => s + r.maxDaysOverdue, 0) / overdue.length) : 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><BriefcaseBusiness size={28} className="text-brand-600" aria-hidden /> Adviser portal</h1>
        <p className="mt-1 text-slate-600">Review cases by priority, track progress and keep notes, the way a support adviser would.</p>
      </div>
      <p className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
        Role preview: this shows your own business&apos;s cases from an adviser&apos;s point of view. No adviser service is connected and nothing is shared with anyone.
      </p>
      {loading && <LoadingState label="Loading cases" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total cases" value={String(all.length)} sub={`${all.filter((r) => r.unpaid > 0).length} open`} icon={<FolderOpen size={22} />} tone="blue" />
            <KpiCard label="Overdue cases" value={String(overdue.length)} sub={<span className="text-red-600">Needs attention</span>} icon={<TriangleAlert size={22} />} tone="red" valueClass="text-red-600" />
            <KpiCard label="Average days overdue" value={overdue.length ? `${avg} days` : "—"} sub="Across overdue cases" icon={<Clock size={22} />} tone="amber" />
            <KpiCard label="Fully paid" value={String(all.filter((r) => r.unpaid === 0 && r.invoices.length).length)} sub={`${formatINR(all.reduce((s, r) => s + r.unpaid, 0))} still open`} icon={<CircleCheck size={22} />} tone="green" />
          </div>
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Card title={`Cases (${rows.length})`}>
              <div role="tablist" aria-label="Case filter" className="mb-4 flex gap-1 border-b border-slate-200">
                {([["all", "All cases"], ["action", "Needs action"], ["resolved", "Resolved"]] as const).map(([k, l]) => (
                  <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
                    className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-brand-600 text-brand-600" : "border-transparent text-slate-600")}>{l}</button>))}
              </div>
              <div className="mb-4 flex flex-wrap gap-3">
                <div className="relative min-w-56 flex-1">
                  <label htmlFor="a-q" className="sr-only">Search cases</label>
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input id="a-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search buyer, PO or invoice number" className={`${inputClass} pl-9`} />
                </div>
                <label htmlFor="a-prio" className="sr-only">Priority</label>
                <select id="a-prio" value={prio} onChange={(e) => setPrio(e.target.value)} className={`${inputClass} w-44!`}>
                  <option value="all">All priorities</option><option>High</option><option>Medium</option><option>Low</option>
                </select>
              </div>
              {rows.length === 0 ? <EmptyState title="No cases here" body="Change the filter or add a case." /> : (
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <caption className="sr-only">Cases by priority</caption>
                    <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                      <th scope="col" className="py-2.5 pl-3 text-left font-semibold">Case</th><th scope="col" className="text-left font-semibold">Buyer</th>
                      <th scope="col" className="text-right font-semibold">Unpaid</th><th scope="col" className="text-right font-semibold">Days delayed</th>
                      <th scope="col" className="pl-4 text-left font-semibold">Priority</th><th scope="col" className="pl-3 text-left font-semibold">Next step</th>
                    </tr></thead>
                    <tbody>{rows.map((r) => (
                      <tr key={r.c.id} className={cx("cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50", selected?.c.id === r.c.id && "bg-blue-50/60")} onClick={() => setSel(r.c.id)}>
                        <td className="py-3 pl-3"><button type="button" onClick={() => setSel(r.c.id)} className="font-medium whitespace-nowrap text-brand-600 hover:underline">{contractRef(r.c)}</button></td>
                        <td>{r.c.buyer_name}</td>
                        <td className="text-right tabular-nums">{formatINR(r.unpaid)}</td>
                        <td className={cx("text-right tabular-nums", r.maxDaysOverdue > 0 && "font-medium text-red-600")}>{r.maxDaysOverdue || "—"}</td>
                        <td className="pl-4"><Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge></td>
                        <td className="pl-3 pr-3"><Badge tone="blue">{r.ev?.next_action.label ?? "Add invoices"}</Badge></td>
                      </tr>))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 flex items-center gap-1 text-xs text-slate-500"><Hourglass size={12} aria-hidden /> Priority: High if over 90 days late, ₹2 lakh or more unpaid, or a blocking issue; Medium if overdue.</p>
            </Card>
            {selected ? <Detail key={selected.c.id} r={selected} /> : null}
          </div>
        </>
      )}
      <p className="flex items-center gap-1 text-xs text-slate-500"><StickyNote size={12} aria-hidden /> Figures come from your cases and the calculation engine.</p>
    </div>
  );
}

/** Cases suppliers have shared with this adviser. In demo mode the demo adviser
 *  (Meera Raghavan) is shown, with the role preview of your own cases below it. */
function AdviserWorkspace() {
  const viewer = useViewer();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold"><BriefcaseBusiness className="text-brand-600" aria-hidden /> Adviser portal</h1>
        <p className="text-slate-600">{authEnabled ? `Welcome${viewer?.name ? `, ${viewer.name.split(" ")[0]}` : ""}. ` : "Demo adviser: Meera Raghavan, Chartered Accountant. "}Cases MSME suppliers have shared with you, read-only.</p>
      </div>
      <SharedCases />
      <p className="text-xs text-slate-500">Need the law? <Link href="/legal" className="font-semibold text-brand-600 hover:underline">Open the Legal Assistant</Link></p>
    </div>
  );
}

export default function AdviserPage() {
  if (authEnabled) return <AdviserWorkspace />;
  return (
    <div className="space-y-10">
      <AdviserWorkspace />
      <details className="mx-auto max-w-[1400px]">
        <summary className="cursor-pointer font-semibold text-brand-600">Role preview: your own cases from an adviser&apos;s point of view</summary>
        <div className="mt-4"><AdviserPreview /></div>
      </details>
    </div>
  );
}
