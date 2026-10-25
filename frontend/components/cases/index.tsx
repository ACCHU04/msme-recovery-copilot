"use client";

import { ArrowRightLeft, Check, ChevronDown, ChevronUp, CircleAlert, Copy, Handshake, Info, MessageCircle, Send, ShieldAlert, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, cx, ErrorState, Field, inputClass, LoadingState, Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { describeSource, EVIDENCE_LABEL, EVIDENCE_WHY, formatDate, formatINR, todayISO } from "@/lib/format";
import type {
  CaseDetail, Draft, DraftKind, Evaluation, EvidenceItem, EvidenceKind, EvidenceStatus,
  Finding, PromiseCandidate, SettlementOption,
} from "@/types/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");
const STEP_FOR: Partial<Record<DraftKind, number>> = { nudge: 1, firm: 2, demand: 3 };
const DRAFT_LABEL: Record<DraftKind, string> = {
  acceptance_confirm: "Receipt confirmation", nudge: "Friendly nudge", firm: "Firm reminder", demand: "Formal demand",
};

// ---------------------------------------------------------------- recovery journey
const STAGES = [
  { label: "Due date", sub: "Payment approaching or past due" },
  { label: "Friendly reminder", sub: "Gentle nudge sent" },
  { label: "Buyer response", sub: "Reply, query or objection" },
  { label: "Negotiation", sub: "Promise or payment plan" },
  { label: "Formal reminder", sub: "Firm reminder or demand" },
  { label: "Evidence ready", sub: "Documents ODR needs" },
  { label: "Dispute resolution", sub: "MSME ODR portal, if needed" },
];
const CURRENT: Record<string, number> = {
  close_case: 0, wait_until_due: 0, nudge: 1, confirm_receipt: 1, resolve_dispute: 2, fix_mismatch: 2,
  complete_facts: 2, await_promise: 3, firm: 4, demand: 4, collect_evidence: 5, prepare_odr: 6, odr: 6,
};

export function RecoveryJourney({ ev }: { ev: Evaluation }) {
  const maxStep = Math.max(0, ...ev.followups.map((f) => f.step));
  const done = [
    ev.bucket.startsWith("overdue"),
    maxStep >= 1,
    ev.followups.some((f) => f.reply_received) || ev.promises.length > 0,
    ev.promises.length > 0,
    maxStep >= 2,
    ev.readiness.odr_ready,
    false,
  ];
  const current = CURRENT[ev.next_action.action] ?? 0;
  return (
    <section aria-labelledby="journey" className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="journey" className="text-lg font-bold">Payment recovery journey</h2>
        <span className="text-sm text-slate-600">Now: <span className="font-semibold text-brand-600">{STAGES[current].label}</span></span>
      </div>
      <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {STAGES.map((s, i) => {
          const isCur = i === current, isDone = done[i] && !isCur;
          return (
            <li key={s.label} aria-current={isCur ? "step" : undefined} className="flex flex-col items-center text-center">
              <span className={cx("flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold",
                isCur ? "border-brand-600 bg-brand-600 text-white ring-4 ring-blue-100" : isDone ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-500")}>
                {isDone ? <Check size={16} aria-hidden /> : i + 1}
              </span>
              <span className={cx("mt-2 text-sm font-semibold", isCur ? "text-brand-600" : "text-navy-900")}>{s.label}</span>
              <span className="text-xs text-slate-500">{s.sub}</span>
              <span className="sr-only">{isCur ? "(current stage)" : isDone ? "(done)" : "(not yet)"}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs text-slate-500">Stages follow what you have recorded. Negotiating or agreeing a payment plan does not change your legal rights or the statutory deadline.</p>
    </section>
  );
}

// ---------------------------------------------------------------- next action
export function NextActionCard({ ev, onDraft }: { ev: Evaluation; onDraft: (k: DraftKind) => void }) {
  const na = ev.next_action;
  return (
    <section aria-labelledby="next-step" className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Recommended next step</p>
      <h2 id="next-step" className="mt-1 text-xl font-semibold text-slate-900">{na.label}</h2>
      <ul className="mt-3 space-y-1.5 text-sm text-slate-800">
        {na.reasons.map((r, i) => <li key={i} className="flex gap-2"><span aria-hidden className="text-brand-600">•</span>{r}</li>)}
      </ul>
      {na.based_on.length > 0 && (
        <p className="mt-3 text-xs text-slate-600">
          Based on: {na.based_on.map(describeSource).join(" · ")}
        </p>
      )}
      {na.caution && (
        <p className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden /> {na.caution}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {na.draft_kind && <Button variant="primary" onClick={() => onDraft(na.draft_kind!)}>Draft this message</Button>}
      </div>
      {na.alternatives.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Other options you could choose</summary>
          <ul className="mt-2 space-y-2">
            {na.alternatives.map((a) => (
              <li key={a.action} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2 text-sm">
                <span><span className="font-medium">{a.label}.</span> <span className="text-slate-600">{a.tradeoff}</span></span>
                {(["nudge", "firm", "demand"] as string[]).includes(a.action) && (
                  <Button className="py-1" onClick={() => onDraft(a.action as DraftKind)}>Draft</Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-3 text-xs text-slate-500">Rule {na.rule}. You decide; nothing is sent for you.</p>
    </section>
  );
}

// ---------------------------------------------------------------- draft editor
export function DraftEditor({ caseId, kind, onLogged, onClose }: {
  caseId: string; kind: DraftKind; onLogged: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sentOn, setSentOn] = useState(todayISO());

  useEffect(() => {
    setDraft(null);
    setError(null);
    setStatus(null);
    api.createDraft(caseId, kind).then((d) => { setDraft(d); setText(d.body); }).catch((e) => setError(msg(e)));
  }, [caseId, kind]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied. Paste it into WhatsApp or email and send it yourself.");
    } catch {
      setStatus("Copy didn't work here. Select the text and copy it manually.");
    }
  };
  const step = STEP_FOR[kind];
  const logSent = async () => {
    try {
      await api.addFollowup(caseId, { step: step!, sent_on: sentOn });
      setStatus("Logged as sent. The recommendation will update.");
      onLogged();
    } catch (e) {
      setError(msg(e));
    }
  };

  return (
    <Card title={`Draft: ${DRAFT_LABEL[kind]}`} action={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {error && <ErrorState message={error} />}
      {!draft && !error && <LoadingState label="Preparing draft" />}
      {draft && (
        <div className="space-y-3">
          <label htmlFor="draft-text" className="sr-only">Draft message, editable</label>
          <textarea id="draft-text" value={text} onChange={(e) => setText(e.target.value)} rows={10}
            className={`${inputClass} font-mono text-[13px] leading-relaxed`} />
          {draft.caution && <Notice tone="amber">{draft.caution}</Notice>}
          <p className="text-xs text-slate-500">
            Amounts and dates were filled in from the calculation, not written by AI. Edit freely before sending.
            “Open in WhatsApp” fills in the message; you pick the buyer&apos;s chat and press send yourself.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="primary" onClick={copy}><Copy size={16} aria-hidden /> Copy</Button>
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-white px-3.5 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
              <MessageCircle size={16} aria-hidden /> Open in WhatsApp
            </a>
            {step && (
              <>
                <div className="w-40"><Field label="Sent on" htmlFor="sent-on">
                  <input id="sent-on" type="date" value={sentOn} max={todayISO()} onChange={(e) => setSentOn(e.target.value)} className={inputClass} />
                </Field></div>
                <Button onClick={logSent}><Send size={16} aria-hidden /> I sent this</Button>
              </>
            )}
          </div>
          {status && <p role="status" className="text-sm text-emerald-700">{status}</p>}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- findings & readiness
const SEV = {
  blocking: { tone: "red" as const, label: "Needs fixing", icon: <CircleAlert size={12} aria-hidden /> },
  warning: { tone: "amber" as const, label: "Needs confirmation", icon: <TriangleAlert size={12} aria-hidden /> },
  info: { tone: "slate" as const, label: "Note", icon: <Info size={12} aria-hidden /> },
};

export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return <p className="text-sm text-slate-600">No inconsistencies found in the facts entered.</p>;
  return (
    <ul className="space-y-3">
      {findings.map((f) => (
        <li key={f.id} className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={SEV[f.severity].tone} icon={SEV[f.severity].icon}>{SEV[f.severity].label}</Badge></div>
          <p className="mt-2 text-sm text-slate-900">{f.message}</p>
          <p className="mt-1 text-sm text-slate-700"><span className="font-medium">Fix:</span> {f.fix}</p>
          {f.sources.length > 0 && <p className="mt-1 text-xs text-slate-500">Source: {f.sources.map(describeSource).join(" · ")}</p>}
        </li>
      ))}
    </ul>
  );
}

export function ReadinessBar({ ev }: { ev: Evaluation }) {
  const r = ev.readiness;
  const have = r.have.length, need = have + r.missing.length;
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-800">ODR readiness</span>
        <span className={r.odr_ready ? "text-emerald-700" : "text-amber-700"}>{r.odr_ready ? "Ready to file if needed" : "Not ready"}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={have} aria-label={r.score}>
        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${need ? (have / need) * 100 : 0}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-600">{r.score}{r.missing.length > 0 && `. Missing: ${r.missing.map((k) => EVIDENCE_LABEL[k].toLowerCase()).join(", ")}.`}</p>
    </div>
  );
}

// ---------------------------------------------------------------- evidence
export function EvidenceChecklist({ caseId, evidence, onChange }: {
  caseId: string; evidence: EvidenceItem[]; onChange: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const set = async (kind: EvidenceKind, status: EvidenceStatus) => {
    setError(null);
    try { await api.setEvidence(caseId, kind, status); onChange(); } catch (e) { setError(msg(e)); }
  };
  return (
    <div className="space-y-2">
      {error && <ErrorState message={error} />}
      {evidence.map((e) => (
        <div key={e.kind} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">{EVIDENCE_LABEL[e.kind]}</p>
            <p className="text-xs text-slate-500">{EVIDENCE_WHY[e.kind]}</p>
          </div>
          <label className="sr-only" htmlFor={`ev-${e.kind}`}>{EVIDENCE_LABEL[e.kind]} status</label>
          <select id={`ev-${e.kind}`} value={e.status} onChange={(x) => set(e.kind, x.target.value as EvidenceStatus)}
            className={`${inputClass} w-32!`}>
            <option value="have">Have it</option>
            <option value="missing">Missing</option>
            <option value="unknown">Not sure</option>
          </select>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- invoices
export function InvoicesPanel({ ev }: { ev: Evaluation }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="divide-y divide-slate-100">
      {ev.invoices.map((inv) => (
        <div key={inv.invoice_id} className="py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium text-slate-900">{inv.number} · {formatINR(inv.amount)}</p>
              {inv.due && (
                <p className="text-sm text-slate-600">
                  {inv.due.acceptance_status === "deemed" ? "Deemed accepted" : inv.due.acceptance_status === "disputed" ? "Acceptance disputed" : "Accepted"}
                  {inv.due.acceptance_date && ` ${formatDate(inv.due.acceptance_date)}`}
                  {inv.due.last_day_to_pay && ` · last day to pay ${formatDate(inv.due.last_day_to_pay)}`}
                  {inv.due.interest_start && ` · interest from ${formatDate(inv.due.interest_start)}`}
                </p>
              )}
              {inv.message && <p className="text-sm text-amber-800">{inv.message}</p>}
            </div>
            <div className="text-right">
              <p className="font-semibold tabular-nums">{formatINR(inv.interest?.total_outstanding ?? inv.principal_outstanding)}</p>
              <p className="text-xs text-slate-500">{inv.interest ? `incl. ${formatINR(inv.interest.interest_outstanding)} est. interest` : "principal only"}</p>
            </div>
          </div>
          {inv.interest && (
            <>
              <button type="button" onClick={() => setOpen(open === inv.invoice_id ? null : inv.invoice_id)}
                aria-expanded={open === inv.invoice_id}
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
                {open === inv.invoice_id ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                Why this number
              </button>
              {open === inv.invoice_id && (
                <div className="mt-2 space-y-2">
                  <p className="text-sm text-slate-700">{inv.due?.basis}</p>
                  <div className="relative overflow-x-auto">
                    <table className="w-full min-w-[560px] text-right text-xs">
                      <caption className="sr-only">Month by month interest for {inv.number}</caption>
                      <thead className="text-slate-500"><tr>
                        <th scope="col" className="py-1 text-left font-medium">Month from</th>
                        <th scope="col" className="py-1 font-medium">Opening</th>
                        <th scope="col" className="py-1 font-medium">Interest</th>
                        <th scope="col" className="py-1 font-medium">Paid</th>
                        <th scope="col" className="py-1 font-medium">Rate (3× Bank Rate)</th>
                      </tr></thead>
                      <tbody>{inv.interest.schedule.map((r) => (
                        <tr key={r.period_start} className="border-t border-slate-100 tabular-nums">
                          <td className="py-1 text-left">{formatDate(r.period_start)}</td>
                          <td className="py-1">{formatINR(r.opening_balance)}</td>
                          <td className="py-1">{formatINR(r.interest)}</td>
                          <td className="py-1">{Number(r.payments) ? formatINR(r.payments) : "—"}</td>
                          <td className="py-1">{r.rates_pct.join(", ")}</td>
                        </tr>))}
                      </tbody>
                    </table>
                  </div>
                  <details className="text-xs text-slate-600">
                    <summary className="cursor-pointer">Assumptions and rules ({inv.due?.rule_ids.join(", ")})</summary>
                    <ul className="mt-1 list-disc pl-5">{inv.interest.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                  </details>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- promises
const PROMISE_TONE = { kept: "green", kept_late: "green", part_kept: "amber", broken: "red", pending: "blue" } as const;

export function PromisesPanel({ caseId, ev, onChange }: { caseId: string; ev: Evaluation; onChange: () => void }) {
  const [text, setText] = useState("");
  const [saidOn, setSaidOn] = useState(todayISO());
  const [cand, setCand] = useState<PromiseCandidate | null>(null);
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const extract = async () => {
    setError(null);
    if (!text.trim()) return setError("Paste the buyer's message first.");
    setBusy(true);
    try {
      const c = await api.extractPromise(caseId, text, saidOn);
      setCand(c);
      setAmount(c.amount ?? "");
      setDue(c.due_date ?? "");
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };
  const save = async () => {
    setError(null);
    if (!amount || Number(amount) <= 0) return setError("Enter the promised amount.");
    if (!due) return setError("Enter the promised date.");
    setBusy(true);
    try {
      await api.addPromise(caseId, { made_on: cand!.made_on, due_date: due, amount, source_text: cand!.source_text });
      setCand(null); setText(""); onChange();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {ev.promises.length > 0 ? (
        <ul className="space-y-2">
          {ev.promises.map((p) => (
            <li key={p.promise_id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
              <div>
                <p className="font-medium text-slate-900">{formatINR(p.amount)} by {formatDate(p.due_date)}</p>
                <p className="text-xs text-slate-500">Promised {formatDate(p.made_on)}{p.source_text && <>: “{p.source_text}”</>}</p>
                <p className="text-xs text-slate-600">Received towards it: {formatINR(p.received)}</p>
              </div>
              <Badge tone={PROMISE_TONE[p.status]}>{p.status.replace("_", " ")}</Badge>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-600">No payment promises recorded.</p>}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-slate-900"><Handshake size={16} aria-hidden /> Record a promise from the buyer</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_160px]">
          <Field label="Buyer's message" htmlFor="promise-text" hint="Paste it as written, e.g. “will pay 50k by Friday”.">
            <textarea id="promise-text" rows={2} value={text} onChange={(e) => setText(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Message date" htmlFor="said-on">
            <input id="said-on" type="date" value={saidOn} max={todayISO()} onChange={(e) => setSaidOn(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <Button className="mt-2" onClick={extract} disabled={busy}>Read amount and date</Button>
        {cand && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-white p-3">
            <p className="text-sm font-medium text-slate-900">Check before saving</p>
            {cand.missing.length > 0 && <p className="text-xs text-amber-800">Couldn&apos;t find the {cand.missing.join(" and ").replace("due_date", "date")}. Fill it in.</p>}
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="Amount (₹)" htmlFor="p-amount">
                <input id="p-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={inputClass} />
              </Field>
              <Field label="Promised by" htmlFor="p-due">
                <input id="p-due" type="date" value={due} min={cand.made_on} onChange={(e) => setDue(e.target.value)} className={inputClass} />
              </Field>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="primary" onClick={save} disabled={busy}>Confirm and save</Button>
              <Button variant="ghost" onClick={() => setCand(null)}>Cancel</Button>
            </div>
          </div>
        )}
        {error && <div className="mt-2"><ErrorState message={error} /></div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- follow-ups
export function FollowupLog({ ev, onChange }: { ev: Evaluation; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (ev.followups.length === 0) return <p className="text-sm text-slate-600">No messages logged yet. Use “I sent this” after sending a draft.</p>;
  const toggle = async (id: string, v: boolean) => {
    try { await api.setFollowupReply(id, v); onChange(); } catch (e) { setError(msg(e)); }
  };
  return (
    <ul className="space-y-2">
      {error && <ErrorState message={error} />}
      {[...ev.followups].reverse().map((f) => (
        <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span><Send size={14} className="mr-1 inline text-slate-500" aria-hidden />
            {["", "Friendly nudge", "Firm reminder", "Formal demand"][f.step]} · {formatDate(f.sent_on)}</span>
          <label className="flex items-center gap-2 text-slate-700">
            <input type="checkbox" checked={f.reply_received} onChange={(e) => toggle(f.id, e.target.checked)} />
            Buyer replied
          </label>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- settlement
export function SettlementCard({ caseId, calcId }: { caseId: string; calcId: string }) {
  const [opts, setOpts] = useState<SettlementOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.settlement(caseId).then((r) => setOpts(r.options)).catch((e) => setError(msg(e)));
  }, [caseId, calcId]);
  return (
    <Card title={<span className="flex items-center gap-2"><ArrowRightLeft size={18} aria-hidden /> Settlement options</span>}>
      <p className="mb-3 text-sm text-slate-600">What you would give up by waiving some interest. Your commercial choice, not legal advice.</p>
      {error && <ErrorState message={error} />}
      {!opts && !error && <LoadingState />}
      {opts && (
        <div className="relative overflow-x-auto"><table className="w-full min-w-[480px] text-sm">
          <caption className="sr-only">Settlement options</caption>
          <thead className="text-xs text-slate-500"><tr>
            <th scope="col" className="py-1 text-left font-medium">Offer</th>
            <th scope="col" className="py-1 text-right font-medium">Ask for</th>
            <th scope="col" className="py-1 text-right font-medium">You give up</th>
            <th scope="col" className="py-1 text-right font-medium">Of full claim</th>
          </tr></thead>
          <tbody>{opts.map((o) => (
            <tr key={o.label} className="border-t border-slate-100 tabular-nums">
              <td className="py-2 text-left">{o.label}</td>
              <td className="py-2 text-right font-medium">{formatINR(o.amount_requested)}</td>
              <td className="py-2 text-right">{formatINR(o.amount_forgone)}</td>
              <td className="py-2 text-right">{o.pct_of_full_claim}%</td>
            </tr>))}
          </tbody>
        </table></div>
      )}
      <p className="mt-3 text-xs text-slate-600">
        &ldquo;Principal&rdquo; here can be higher than the unpaid invoice amount: with interest-first allocation, part of each
        payment the buyer made went to interest that was already due, so less of the principal was cleared.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------- case facts
export function CaseFactsForm({ c, onChange }: { c: CaseDetail; onChange: () => void }) {
  const [po, setPo] = useState(c.po_amount ?? "");
  const [error, setError] = useState<string | null>(null);
  const patch = async (body: Record<string, unknown>) => {
    setError(null);
    try { await api.patchCase(c.id, body); onChange(); } catch (e) { setError(msg(e)); }
  };
  return (
    <div className="grid gap-3">
      <Field label="PO amount (₹)" htmlFor="po-amt" hint="Checked against the invoice total">
        <input id="po-amt" inputMode="decimal" value={po} onChange={(e) => setPo(e.target.value.replace(/[^\d.]/g, ""))}
          onBlur={() => po && po !== c.po_amount && patch({ po_amount: po })} className={inputClass} />
      </Field>
      <Field label="Has the buyer raised a dispute?" htmlFor="dispute">
        <select id="dispute" value={c.dispute_reason} onChange={(e) => patch({ dispute_reason: e.target.value })} className={inputClass}>
          <option value="none">No dispute</option>
          <option value="quality">Quality</option>
          <option value="quantity">Quantity</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Field label="Apply payments to" htmlFor="alloc" hint="The Act doesn't say; you choose">
        <select id="alloc" value={c.allocation} onChange={(e) => patch({ allocation: e.target.value })} className={inputClass}>
          <option value="interest_first">Interest first</option>
          <option value="principal_first">Principal first</option>
        </select>
      </Field>
      {error && <ErrorState message={error} />}
    </div>
  );
}

export { ShareWithAdviserCard } from "./ShareWithAdviserCard";
