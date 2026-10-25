"use client";

import { AlertCircle, AlertOctagon, Check, CheckCircle2, ChevronDown, ChevronUp, Info, MessageSquare, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, ErrorState, Field, inputClass } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatINR, todayISO } from "@/lib/format";
import type { BlockerReason, BlockerSource, DraftKind, Evaluation, PaymentBlocker } from "@/types/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

export const BLOCKER_META: Record<BlockerReason, { label: string; fix: string; draftKind?: DraftKind }> = {
  po_missing: {
    label: "PO number missing",
    fix: "Send a corrected invoice quoting the buyer's PO number to unblock processing.",
    draftKind: "fix_blocker_po",
  },
  grn_not_entered: {
    label: "Goods receipt not entered (GRN)",
    fix: "Share the signed delivery challan and ask the buyer's stores team to enter the GRN.",
    draftKind: "fix_blocker_grn",
  },
  amount_mismatch: {
    label: "Amount or GST mismatch",
    fix: "Issue a credit note or debit note to reconcile the difference.",
    draftKind: "fix_blocker_amount",
  },
  quality_dispute: {
    label: "Quality dispute",
    fix: "Address the buyer's quality objection; the undisputed principal portion can still be chased.",
    draftKind: "resolve_dispute",
  },
  waiting_approval: {
    label: "Waiting for approval",
    fix: "Continue standard follow-up ladder; internal approval delays do not alter legal due dates.",
    draftKind: undefined,
  },
  other: {
    label: "Other payment blocker",
    fix: "Address the buyer's query or request formal written clarification.",
    draftKind: "fix_blocker",
  },
};

export const SOURCE_META: Record<BlockerSource, { label: string; tone: "blue" | "green" | "slate" }> = {
  buyer_said: { label: "Buyer stated verbally", tone: "blue" },
  documented: { label: "Documented in writing", tone: "green" },
  not_verified: { label: "Not verified", tone: "slate" },
};

export function BlockersCard({
  caseId,
  ev,
  onDraft,
  onChange,
}: {
  caseId: string;
  ev: Evaluation;
  onDraft: (kind: DraftKind) => void;
  onChange: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [reason, setReason] = useState<BlockerReason>("po_missing");
  const [source, setSource] = useState<BlockerSource>("buyer_said");
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [disputedAmount, setDisputedAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [reportedOn, setReportedOn] = useState<string>(todayISO());

  const blockers = ev.blockers ?? [];
  const openBlockers = blockers.filter((b) => !b.resolved_on);
  const resolvedBlockers = blockers.filter((b) => !!b.resolved_on);

  const resetForm = () => {
    setReason("po_missing");
    setSource("buyer_said");
    setInvoiceId("");
    setDisputedAmount("");
    setNote("");
    setReportedOn(todayISO());
    setShowAdd(false);
    setError(null);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.addBlocker(caseId, {
        reason,
        source,
        invoice_id: invoiceId || null,
        disputed_amount: disputedAmount.trim() ? disputedAmount.trim() : null,
        note: note.trim() || null,
        reported_on: reportedOn,
      });
      resetForm();
      onChange();
    } catch (err) {
      setError(msg(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (id: string) => {
    try {
      await api.patchBlocker(id, { resolved_on: todayISO() });
      onChange();
    } catch (err) {
      setError(msg(err));
    }
  };

  const handleReopen = async (id: string) => {
    try {
      await api.patchBlocker(id, { resolved_on: null });
      onChange();
    } catch (err) {
      setError(msg(err));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this payment blocker?")) return;
    try {
      await api.deleteBlocker(id);
      onChange();
    } catch (err) {
      setError(msg(err));
    }
  };

  // Helper to check 15-day statutory window
  const isAfter15Days = (b: PaymentBlocker) => {
    const targetInv = b.invoice_id
      ? ev.invoices.find((i) => i.invoice_id === b.invoice_id)
      : ev.invoices[0];
    if (targetInv?.due?.acceptance_date) {
      const repDate = new Date(b.reported_on);
      const accDate = new Date(targetInv.due.acceptance_date);
      const diffDays = Math.round((repDate.getTime() - accDate.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays > 15;
    }
    return false;
  };

  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <AlertOctagon size={18} className={openBlockers.length > 0 ? "text-amber-600" : "text-slate-500"} aria-hidden />
          <span>Payment blockers</span>
          {openBlockers.length > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {openBlockers.length} open
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              None open
            </span>
          )}
        </div>
      }
      action={
        !showAdd && (
          <Button variant="ghost" onClick={() => setShowAdd(true)}>
            <Plus size={16} aria-hidden /> Record reason
          </Button>
        )
      }
    >
      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {/* Add Blocker Form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="mb-6 rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-slate-900">Why isn&apos;t this invoice getting paid?</h4>
            <Button variant="ghost" className="text-xs py-1" onClick={resetForm}>Cancel</Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Reason given by buyer" htmlFor="blocker-reason">
              <select
                id="blocker-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as BlockerReason)}
                className={inputClass}
                required
              >
                <option value="po_missing">PO number missing</option>
                <option value="grn_not_entered">Goods receipt not entered (GRN)</option>
                <option value="amount_mismatch">Amount or GST mismatch</option>
                <option value="quality_dispute">Quality dispute</option>
                <option value="waiting_approval">Waiting for approval</option>
                <option value="other">Other reason</option>
              </select>
            </Field>

            <Field label="Source / proof of reason" htmlFor="blocker-source">
              <select
                id="blocker-source"
                value={source}
                onChange={(e) => setSource(e.target.value as BlockerSource)}
                className={inputClass}
              >
                <option value="buyer_said">Buyer stated verbally</option>
                <option value="documented">Documented in writing (email / letter)</option>
                <option value="not_verified">Not verified</option>
              </select>
            </Field>

            <Field label="Associated invoice (optional)" htmlFor="blocker-inv">
              <select
                id="blocker-inv"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                className={inputClass}
              >
                <option value="">All invoices in case</option>
                {ev.invoices.map((inv) => (
                  <option key={inv.invoice_id} value={inv.invoice_id}>
                    {inv.number} ({formatINR(inv.amount)})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Disputed amount (if partial, ₹)" htmlFor="blocker-amount">
              <input
                id="blocker-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="Leave blank if whole invoice"
                value={disputedAmount}
                onChange={(e) => setDisputedAmount(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Reported on" htmlFor="blocker-date">
              <input
                id="blocker-date"
                type="date"
                value={reportedOn}
                max={todayISO()}
                onChange={(e) => setReportedOn(e.target.value)}
                className={inputClass}
                required
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Buyer's note or explanation" htmlFor="blocker-note">
                <textarea
                  id="blocker-note"
                  rows={2}
                  maxLength={1000}
                  placeholder="e.g. Accounts team requested PO 2026/0882 to be printed on invoice copy..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-blue-200">
            <Button variant="ghost" onClick={resetForm}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save blocker"}
            </Button>
          </div>
        </form>
      )}

      {/* Open Blockers List */}
      {openBlockers.length > 0 ? (
        <div className="space-y-4">
          {openBlockers.map((b) => {
            const meta = BLOCKER_META[b.reason] ?? BLOCKER_META.other;
            const src = SOURCE_META[b.source] ?? SOURCE_META.not_verified;
            const targetInv = b.invoice_id ? ev.invoices.find((i) => i.invoice_id === b.invoice_id) : null;
            const after15 = isAfter15Days(b);

            return (
              <div
                key={b.id}
                className="rounded-xl border border-amber-200 bg-amber-50/30 p-4 transition-all"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-slate-900">{meta.label}</h4>
                      <Badge tone={src.tone}>{src.label}</Badge>
                      {targetInv && (
                        <span className="text-xs font-mono text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                          {targetInv.number}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Reported on {formatDate(b.reported_on)}
                      {b.disputed_amount && (
                        <> · Disputed: <strong className="text-slate-800 tabular-nums">{formatINR(b.disputed_amount)}</strong></>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      className="text-xs py-1 text-emerald-700 hover:bg-emerald-50"
                      onClick={() => handleResolve(b.id)}
                    >
                      <Check size={14} aria-hidden /> Mark resolved
                    </Button>
                    <button
                      type="button"
                      title="Remove blocker"
                      onClick={() => handleDelete(b.id)}
                      className="text-slate-400 hover:text-red-600 p-1 rounded"
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </div>
                </div>

                {b.note && (
                  <p className="mt-2 text-sm text-slate-700 bg-white/70 p-2.5 rounded-lg border border-amber-100">
                    <span className="font-medium text-slate-900">Buyer note:</span> {b.note}
                  </p>
                )}

                {/* Suggested Fix */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-sm">
                  <div className="flex items-start gap-2 max-w-xl">
                    <Info size={16} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
                    <div>
                      <span className="font-semibold text-brand-900">Suggested fix: </span>
                      <span className="text-slate-800">{meta.fix}</span>
                    </div>
                  </div>
                  {meta.draftKind && (
                    <Button
                      variant="primary"
                      className="py-1.5 text-xs whitespace-nowrap"
                      onClick={() => onDraft(meta.draftKind!)}
                    >
                      <MessageSquare size={14} aria-hidden /> Draft message
                    </Button>
                  )}
                </div>

                {/* 15-day statutory objection period warning */}
                {after15 && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-900">
                    <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-600" aria-hidden />
                    <span>
                      <strong>Statutory limit:</strong> This blocker was reported more than 15 days after delivery.
                      Under Section 2(b) of the MSMED Act, objections must be notified in writing within 15 days of delivery.
                      This reason does <em>not</em> alter your legal due date or pause interest accrual.
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-4 text-center text-sm text-slate-500">
          <p>No active payment blockers recorded.</p>
          <p className="mt-1 text-xs text-slate-400">
            If the buyer gave a reason for withholding payment (e.g. missing PO, GRN pending, quality dispute), record it to get a tailored fix and response draft.
          </p>
        </div>
      )}

      {/* Resolved Blockers Collapsible Section */}
      {resolvedBlockers.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={() => setShowResolved(!showResolved)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            {showResolved ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>Resolved blockers ({resolvedBlockers.length})</span>
          </button>

          {showResolved && (
            <ul className="mt-3 space-y-2">
              {resolvedBlockers.map((b) => {
                const meta = BLOCKER_META[b.reason] ?? BLOCKER_META.other;
                return (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-xs text-slate-600"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={15} className="text-emerald-600 shrink-0" aria-hidden />
                      <span className="font-medium text-slate-800 line-through">{meta.label}</span>
                      <span>· Resolved on {formatDate(b.resolved_on!)}</span>
                      {b.note && <span className="text-slate-500 truncate max-w-xs">({b.note})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleReopen(b.id)}
                        className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
                      >
                        <RotateCcw size={12} /> Re-open
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(b.id)}
                        className="text-slate-400 hover:text-red-600"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
