"use client";

import {
  ArrowLeft, CalendarClock, CheckCircle2, Circle, CircleAlert, FileText, Handshake, IndianRupee, Pencil,
  ReceiptIndianRupee, Scale, Send, ShieldCheck, Trash2, Truck, UserRound,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Badge, Button, Card, cx, Dialog, ErrorState, EstimateNote, Field, inputClass, LoadingState, PayStatusBadge, Toast,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { EVIDENCE_LABEL, formatDate, formatINR, todayISO } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { CaseDetail, Evaluation, InvoiceDetail, InvoiceRow } from "@/types/api";

type Check = { label: string; result: "Passed" | "Needs review" | "Not checked" | "Disputed"; detail: string };
const RESULT_STYLE = {
  Passed: { tone: "green" as const, icon: <CheckCircle2 size={14} aria-hidden /> },
  "Needs review": { tone: "amber" as const, icon: <CircleAlert size={14} aria-hidden /> },
  "Not checked": { tone: "slate" as const, icon: <Circle size={14} aria-hidden /> },
  Disputed: { tone: "violet" as const, icon: <CircleAlert size={14} aria-hidden /> },
};

function verify(inv: InvoiceDetail, row: InvoiceRow, all: InvoiceRow[], ev: Evaluation, c: CaseDetail): Check[] {
  const evd = Object.fromEntries(c.evidence.map((e) => [e.kind, e.status]));
  const f = new Set(ev.findings.map((x) => x.id));
  const due = ev.invoices.find((e) => e.invoice_id === inv.id)?.due;
  const dupes = all.filter((r) => r.number.trim().toLowerCase() === inv.number.trim().toLowerCase() && r.id !== inv.id);
  const caseTotal = c.invoices.reduce((s, i) => s + Number(i.amount), 0);
  const before = ev.findings.find((x) => x.id === "invoice_before_po" && x.message.startsWith(inv.number));
  return [
    { label: "Invoice number is unique", result: dupes.length ? "Needs review" : "Passed",
      detail: dupes.length ? `Same number used on ${dupes.length} other invoice(s) (${dupes.map((d) => d.buyer_name).join(", ")}).` : "No other invoice in your records uses this number." },
    { label: "Invoices match the purchase order amount", result: !c.po_amount ? "Not checked" : f.has("po_amount_exceeded") ? "Needs review" : "Passed",
      detail: !c.po_amount ? "Add the PO amount on the case to compare." : `Invoices in this case total ${formatINR(caseTotal)} against a PO of ${formatINR(c.po_amount)}.` },
    { label: "Invoice dated after the purchase order", result: !c.contract_date ? "Not checked" : before ? "Needs review" : "Passed",
      detail: !c.contract_date ? "Add the PO date on the case." : before ? before.message : `PO dated ${formatDate(c.contract_date)}; invoice dated ${formatDate(inv.invoice_date)}.` },
    { label: "Delivery date recorded", result: inv.delivery_date ? "Passed" : "Needs review",
      detail: inv.delivery_date ? `Delivered ${formatDate(inv.delivery_date)}. The payment clock runs from here.` : "Without it the due date and interest can't be worked out." },
    { label: "Delivery proof on file", result: evd.delivery_proof === "have" ? "Passed" : "Needs review",
      detail: evd.delivery_proof === "have" ? "Marked as on file for this case." : "No signed challan, e-way bill or courier record marked as on file." },
    { label: "Buyer acceptance", result: due?.acceptance_status === "disputed" ? "Disputed" : "Passed",
      detail: due?.acceptance_status === "disputed" ? `Buyer objected in writing on ${formatDate(inv.objection_date)}; not yet resolved.`
        : due?.acceptance_status === "objection_removed" ? `Objection resolved; accepted ${formatDate(due.acceptance_date)}.`
        : evd.acceptance_reply === "have" ? "Written acceptance from the buyer is on file."
        : `Deemed accepted on ${formatDate(due?.acceptance_date)}: no written objection recorded within 15 days of delivery.` },
    { label: "Payments recorded are consistent", result: Number(row.paid) <= Number(inv.amount) ? "Passed" : "Needs review",
      detail: `${formatINR(row.paid)} recorded against ${formatINR(inv.amount)}.` },
    { label: "E-invoice IRN / QR", result: "Not checked", detail: "This app does not connect to the GST e-invoice system." },
  ];
}

function TimelineItem({ done, warn, icon, title, sub, date, last }: { done: boolean; warn?: boolean; icon: ReactNode; title: string; sub: string; date: string; last?: boolean }) {
  return (
    <li className="relative flex gap-3 pb-5">
      {!last && <span className="absolute left-[13px] top-7 h-full w-0.5 bg-slate-200" aria-hidden />}
      <span className={cx("relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white",
        warn ? "bg-red-500" : done ? "bg-emerald-600" : "border-2 border-slate-300 bg-white text-slate-400")}>{icon}</span>
      <div className="flex flex-1 flex-wrap justify-between gap-x-3">
        <div><p className="font-semibold">{title}</p><p className="text-sm text-slate-600">{sub}</p></div>
        <p className={cx("text-sm", warn ? "font-medium text-red-600" : "text-slate-600")}>{date}</p>
      </div>
    </li>
  );
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "pay" | "edit" | "delete">(null);
  const [toast, setToast] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const inv = await api.getInvoice(id);
    const [ev, c, all] = await Promise.all([api.evaluate(inv.case.id), api.getCase(inv.case.id), api.listInvoices()]);
    return { inv, ev, c, all, row: all.find((r) => r.id === id)! };
  }, [id]);

  if (loading && !data) return <LoadingState label="Loading invoice" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const { inv, ev, c, all, row } = data;
  const evInv = ev.invoices.find((e) => e.invoice_id === id);
  const checks = verify(inv, row, all, ev, c);
  const counts = checks.reduce((m, k) => ({ ...m, [k.result]: (m[k.result] ?? 0) + 1 }), {} as Record<string, number>);
  const sent = ev.followups;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-slate-600">
        <Link href="/invoices" className="inline-flex items-center gap-1 hover:underline"><ArrowLeft size={16} aria-hidden /> Invoices</Link>
        <span aria-hidden>›</span><span className="font-medium text-navy-900">{inv.number}</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold">Invoice details</h1><PayStatusBadge status={row.status} partial={row.partially_paid} /></div>
          <p className="mt-1 text-slate-600">Payment status, verification checks and next steps for {inv.number}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/cases/${c.id}/report`} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"><FileText size={16} aria-hidden /> Report</Link>
          <Link href={`/assistant?case=${c.id}`} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"><Send size={16} aria-hidden /> Send reminder</Link>
          <Button variant="primary" onClick={() => setDialog("pay")}><IndianRupee size={16} aria-hidden /> Record payment</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <section className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5 2xl:grid-cols-[minmax(0,1fr)_auto]">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div><dt className="text-slate-500">Invoice no.</dt><dd className="text-2xl font-bold">{inv.number}</dd></div>
              <div><dt className="text-slate-500">Buyer</dt><dd className="font-medium">{inv.buyer.name}</dd></div>
              <div><dt className="text-slate-500">Recovery case</dt><dd><Link href={`/cases/${c.id}`} className="font-medium text-brand-600 underline">PO {formatDate(c.contract_date)}</Link></dd></div>
              <div><dt className="text-slate-500">Invoice date</dt><dd className="font-medium">{formatDate(inv.invoice_date)}</dd></div>
              <div><dt className="text-slate-500">Last day to pay</dt><dd className="font-medium">{formatDate(row.last_day_to_pay)}</dd></div>
              <div><dt className="text-slate-500">Credit period</dt><dd className="font-medium">{inv.agreed_due_date ? `Agreed: pay by ${formatDate(inv.agreed_due_date)}` : "None agreed in writing"}</dd></div>
              {evInv?.due?.basis && <div className="col-span-full"><dt className="sr-only">How the due date was worked out</dt><dd className="text-xs text-slate-600">{evInv.due.basis}</dd></div>}
            </dl>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 2xl:w-[460px]">
              <div className="rounded-xl bg-blue-50 p-3"><p className="text-xs text-slate-600">Invoice amount</p><p className="mt-1 text-lg font-bold text-brand-600 tabular-nums">{formatINR(inv.amount)}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-slate-600">Received</p><p className="mt-1 text-lg font-bold text-emerald-700 tabular-nums">{formatINR(row.paid)}</p></div>
              <div className="rounded-xl bg-orange-50 p-3"><p className="text-xs text-slate-600">Unpaid</p><p className="mt-1 text-lg font-bold text-orange-600 tabular-nums">{formatINR(row.unpaid)}</p>
                {row.days_overdue > 0 && <p className="text-xs font-medium text-red-600">{row.days_overdue} days overdue</p>}</div>
            </div>
          </section>

          {evInv?.interest && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
              <p><span className="font-semibold">Statutory amount (estimate):</span> {formatINR(evInv.interest.total_outstanding)}, including {formatINR(evInv.interest.interest_outstanding)} interest under s.16 since {formatDate(evInv.due?.interest_start)}.</p>
              <Link href={`/cases/${c.id}`} className="font-medium text-brand-600 underline">See the working</Link>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title={<span className="flex items-center gap-2"><CalendarClock size={20} className="text-brand-600" aria-hidden /> Payment timeline</span>}>
              <ol>
                <TimelineItem done icon={<FileText size={14} />} title="Invoice issued" sub={`${formatINR(inv.amount)} raised`} date={formatDate(inv.invoice_date)} />
                <TimelineItem done={!!inv.delivery_date} icon={<Truck size={14} />} title="Goods delivered" sub={inv.delivery_date ? "Delivery date recorded" : "Delivery date missing"} date={formatDate(inv.delivery_date)} />
                <TimelineItem done={evInv?.due?.acceptance_status !== "disputed"} warn={evInv?.due?.acceptance_status === "disputed"} icon={<Handshake size={14} />}
                  title="Acceptance" sub={evInv?.due?.acceptance_status === "disputed" ? "Buyer objected in writing" : evInv?.due?.acceptance_status === "deemed" ? "Deemed: no objection within 15 days" : "Accepted after objection resolved"}
                  date={formatDate(evInv?.due?.acceptance_date)} />
                <TimelineItem done={row.status === "paid"} warn={row.days_overdue > 0} icon={<ReceiptIndianRupee size={14} />} title="Payment due"
                  sub={inv.agreed_due_date ? "Date agreed in writing (max 45 days)" : "No credit period agreed: 15 days from acceptance"}
                  date={row.days_overdue > 0 ? `${formatDate(row.last_day_to_pay)} · ${row.days_overdue} days overdue` : formatDate(row.last_day_to_pay)} />
                {sent.map((f) => (
                  <TimelineItem key={f.id} done icon={<Send size={14} />} title={["", "Friendly nudge sent", "Firm reminder sent", "Formal demand sent"][f.step]} sub={f.reply_received ? "Buyer replied" : "No reply recorded"} date={formatDate(f.sent_on)} />
                ))}
                {inv.payments.map((p) => (
                  <TimelineItem key={p.id} done icon={<IndianRupee size={14} />} title="Payment received" sub={formatINR(p.amount)} date={formatDate(p.paid_on)} />
                ))}
                <TimelineItem last done={row.status === "paid"} icon={<CheckCircle2 size={14} />} title={row.status === "paid" ? "Invoice paid in full" : "Awaiting payment"} sub={row.status === "paid" ? "Statutory interest may still be claimable" : `${formatINR(row.unpaid)} still unpaid`} date={row.status === "paid" ? "Done" : "Pending"} />
              </ol>
            </Card>

            <Card title={<span className="flex items-center gap-2"><ReceiptIndianRupee size={20} className="text-brand-600" aria-hidden /> Payment history</span>}
              action={<Button onClick={() => setDialog("pay")} className="whitespace-nowrap py-1.5">+ Record payment</Button>}>
              {inv.payments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
                  <p className="font-semibold">No payments recorded yet</p>
                  <p className="mt-1 text-sm text-slate-600">When the buyer pays, record it here to update what is owed.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">Payments received for {inv.number}</caption>
                  <thead className="text-xs text-slate-500"><tr><th scope="col" className="py-2 text-left font-medium">Date</th><th scope="col" className="py-2 text-right font-medium">Amount</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
                  <tbody>{inv.payments.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="py-2">{formatDate(p.paid_on)}</td>
                      <td className="py-2 text-right tabular-nums">{formatINR(p.amount)}</td>
                      <td className="py-2 text-right">
                        <button type="button" aria-label={`Remove payment of ${formatINR(p.amount)} on ${formatDate(p.paid_on)}`} className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700"
                          onClick={async () => { if (window.confirm("Remove this payment? Use this only to fix a mistake.")) { await api.deletePayment(p.id); setToast("Payment removed"); reload(); } }}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <Card title={<span className="flex items-center gap-2"><ShieldCheck size={20} className="text-brand-600" aria-hidden /> Invoice verification</span>}
            action={<span className="flex flex-wrap gap-1.5">{(["Passed", "Needs review", "Disputed", "Not checked"] as const).filter((k) => counts[k]).map((k) => <Badge key={k} tone={RESULT_STYLE[k].tone}>{counts[k]} {k.toLowerCase()}</Badge>)}</span>}>
            <ul className="divide-y divide-slate-100">
              {checks.map((k) => (
                <li key={k.label} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div className="min-w-0 flex-1"><p className="font-medium">{k.label}</p><p className="text-sm text-slate-600">{k.detail}</p></div>
                  <Badge tone={RESULT_STYLE[k.result].tone} icon={RESULT_STYLE[k.result].icon}>{k.result}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">Checks use the facts and documents you entered. A flag means “look at this”, never that an invoice is false.</p>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title={<span className="flex items-center gap-2"><UserRound size={20} className="text-brand-600" aria-hidden /> Buyer details</span>}>
            <p className="text-lg font-bold">{inv.buyer.name}</p>
            <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">GSTIN</dt><dd>{inv.buyer.gstin ?? "Not given"}{inv.buyer.gstin && <span className="block text-xs text-slate-500">Format checked, not looked up</span>}</dd>
              <dt className="text-slate-500">Importance</dt><dd className="capitalize">{inv.buyer.relationship_importance ?? "Not set"}</dd>
              <dt className="text-slate-500">Dispute</dt><dd>{c.dispute_reason === "none" ? "None raised" : `${c.dispute_reason[0].toUpperCase()}${c.dispute_reason.slice(1)} dispute raised`}</dd>
            </dl>
            <Link href={`/buyers?buyer=${inv.buyer.id}`} className="mt-3 inline-block text-sm font-semibold text-brand-600 hover:underline">Payment record with this buyer</Link>
          </Card>

          <Card title="Invoice actions">
            <div className="space-y-2">
              {[
                { href: `/assistant?case=${c.id}`, icon: Send, label: "Get the next step and a draft" },
                { href: `/legal?invoice=${id}`, icon: CalendarClock, label: "Check the payment deadline" },
                { href: "/legal", icon: Scale, label: "Read your rights" },
                { href: `/cases/${c.id}/report`, icon: FileText, label: "Prepare the evidence report" },
              ].map(({ href, icon: Icon, label }) => (
                <Link key={label} href={href} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium hover:border-brand-600">
                  <Icon size={18} className="text-brand-600" aria-hidden /> <span className="flex-1">{label}</span> <span aria-hidden>›</span>
                </Link>
              ))}
              <button type="button" onClick={() => setDialog("edit")} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm font-medium hover:border-brand-600">
                <Pencil size={18} className="text-brand-600" aria-hidden /> <span className="flex-1">Correct invoice details</span> <span aria-hidden>›</span>
              </button>
              <button type="button" onClick={() => setDialog("delete")} className="flex w-full items-center gap-3 rounded-lg border border-red-200 px-3 py-2.5 text-left text-sm font-medium text-red-700 hover:bg-red-50">
                <Trash2 size={18} aria-hidden /> <span className="flex-1">Delete invoice</span>
              </button>
            </div>
          </Card>

          <Card title="Documents for this case">
            <ul className="space-y-2 text-sm">
              {c.evidence.map((e) => (
                <li key={e.kind} className="flex items-center justify-between gap-2">
                  <span>{EVIDENCE_LABEL[e.kind]}</span>
                  <Badge tone={e.status === "have" ? "green" : e.status === "missing" ? "red" : "slate"}>{e.status === "have" ? "On file" : e.status === "missing" ? "Missing" : "Not sure"}</Badge>
                </li>
              ))}
            </ul>
            <Link href={`/cases/${c.id}`} className="mt-3 inline-block text-sm font-semibold text-brand-600 hover:underline">Update on the case page</Link>
          </Card>
        </div>
      </div>
      <EstimateNote />

      {dialog === "pay" && <PaymentDialog invoice={inv} unpaid={row.unpaid} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setToast("Payment recorded"); reload(); }} />}
      {dialog === "edit" && <EditDialog inv={inv} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setToast("Invoice updated"); reload(); }} />}
      {dialog === "delete" && (
        <Dialog title={`Delete ${inv.number}?`} onClose={() => setDialog(null)}
          footer={<><Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="danger" onClick={async () => { await api.deleteInvoice(id); router.replace(`/cases/${c.id}`); }}>Delete invoice and its payments</Button></>}>
          <p className="text-sm text-slate-700">This removes the invoice and {inv.payments.length} recorded payment(s) from the case. It can&apos;t be undone.</p>
        </Dialog>
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function PaymentDialog({ invoice, unpaid, onClose, onSaved }: { invoice: InvoiceDetail; unpaid: string; onClose: () => void; onSaved: () => void }) {
  const [paidOn, setPaidOn] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dupe, setDupe] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(null);
    if (!(Number(amount) > 0)) return setError("Enter an amount above zero.");
    setBusy(true);
    try { await api.addPayment(invoice.id, { paid_on: paidOn, amount }, dupe); onSaved(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 409) { setDupe(true); setError(`${e.message} Press Save again to record it as a second payment.`); }
      else setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally { setBusy(false); }
  };
  return (
    <Dialog title={`Record a payment for ${invoice.number}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save payment"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid on" htmlFor="pay-date"><input id="pay-date" type="date" max={todayISO()} min={invoice.invoice_date} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputClass} /></Field>
        <Field label="Amount (₹)" htmlFor="pay-amt" hint={`Unpaid invoice amount: ${formatINR(unpaid)}`}>
          <input id="pay-amt" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, "")); setDupe(false); }} className={inputClass} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">A payment can be larger than the unpaid invoice amount if it also covers statutory interest; the server checks it against everything owed that day.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </Dialog>
  );
}

function EditDialog({ inv, onClose, onSaved }: { inv: InvoiceDetail; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    number: inv.number, amount: inv.amount, invoice_date: inv.invoice_date, delivery_date: inv.delivery_date ?? "",
    agreed_due_date: inv.agreed_due_date ?? "", objection_date: inv.objection_date ?? "", objection_removed_date: inv.objection_removed_date ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setError(null);
    const clear = (["delivery_date", "agreed_due_date", "objection_date", "objection_removed_date"] as const).filter((k) => !f[k] && inv[k]);
    const body: Record<string, unknown> = { clear };
    (Object.keys(f) as (keyof typeof f)[]).forEach((k) => { if (f[k] && f[k] !== (inv[k] ?? "")) body[k] = f[k]; });
    try { await api.patchInvoice(inv.id, body); onSaved(); } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong."); }
  };
  const today = todayISO();
  return (
    <Dialog title={`Correct ${inv.number}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save changes</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice number" htmlFor="e-num"><input id="e-num" value={f.number} onChange={set("number")} className={inputClass} /></Field>
        <Field label="Amount (₹)" htmlFor="e-amt"><input id="e-amt" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} className={inputClass} /></Field>
        <Field label="Invoice date" htmlFor="e-idate"><input id="e-idate" type="date" max={today} value={f.invoice_date} onChange={set("invoice_date")} className={inputClass} /></Field>
        <Field label="Delivered on" htmlFor="e-del"><input id="e-del" type="date" max={today} value={f.delivery_date} onChange={set("delivery_date")} className={inputClass} /></Field>
        <Field label="Agreed in writing to pay by" htmlFor="e-agr" hint="Clear it if no credit period was agreed in writing"><input id="e-agr" type="date" value={f.agreed_due_date} onChange={set("agreed_due_date")} className={inputClass} /></Field>
        <Field label="Buyer objected on" htmlFor="e-obj"><input id="e-obj" type="date" max={today} value={f.objection_date} onChange={set("objection_date")} className={inputClass} /></Field>
        <Field label="Objection resolved on" htmlFor="e-objr"><input id="e-objr" type="date" max={today} value={f.objection_removed_date} onChange={set("objection_removed_date")} className={inputClass} /></Field>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </Dialog>
  );
}
