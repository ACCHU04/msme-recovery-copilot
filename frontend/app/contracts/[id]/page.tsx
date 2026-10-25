"use client";

import {
  ArrowLeft, Building2, ChevronRight, FileSignature, FileText, Flag, Gavel, IndianRupee, Pencil, Plus, Send, Trash2, TriangleAlert, Truck, Wallet,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Badge, Button, Card, cx, Dialog, ErrorState, EstimateNote, Field, inputClass, LoadingState, PayStatusBadge, Toast,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { contractRef, contractStatus, paymentTerms } from "@/lib/contracts";
import { EVIDENCE_LABEL, formatDate, formatINR, todayISO } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { InvoiceRow, Milestone } from "@/types/api";

const TABS = ["Overview", "Milestones", "Linked invoices", "Documents", "Activity"] as const;
type Tab = (typeof TABS)[number];

function Tile({ label, value, pct, tone, icon }: { label: string; value: string; pct?: string; tone: string; icon: ReactNode }) {
  return (
    <div className={cx("flex items-start gap-3 rounded-xl p-4", tone)}>
      <span className="rounded-lg bg-white/70 p-2" aria-hidden>{icon}</span>
      <div><p className="text-xs text-slate-600">{label}</p><p className="text-xl font-bold tabular-nums">{value}</p>{pct && <p className="text-xs text-slate-600">{pct}</p>}</div>
    </div>
  );
}

export default function ContractPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("Overview");
  const [dialog, setDialog] = useState<null | "edit" | "invoice" | "milestone">(null);
  // Opened from the dashboard's "Add invoice" quick action: /contracts/<id>?add=invoice
  useEffect(() => { if (new URLSearchParams(window.location.search).get("add") === "invoice") setDialog("invoice"); }, []);
  const [toast, setToast] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const [c, all, ms] = await Promise.all([api.getCase(id), api.listInvoices(), api.listMilestones(id)]);
    const ev = c.invoices.length ? await api.evaluate(id) : null;
    return { c, ev, inv: all.filter((r) => r.case_id === id), ms };
  }, [id]);

  if (loading && !data) return <LoadingState label="Loading contract" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const { c, ev, inv, ms } = data;
  const ref = contractRef(c);
  const invoiced = inv.reduce((s, r) => s + Number(r.amount), 0);
  const paid = inv.reduce((s, r) => s + Number(r.paid), 0);
  const unpaid = inv.reduce((s, r) => s + Number(r.unpaid), 0);
  const po = c.po_amount ? Number(c.po_amount) : null;
  const pct = (n: number) => (po ? `${Math.round((n / po) * 100)}% of PO value` : invoiced ? `${Math.round((n / invoiced) * 100)}% of invoiced` : undefined);
  const st = contractStatus({ c: { ...c, buyer_name: c.buyer.name, totals: null, bucket: null, eligibility: null }, ref, invoices: inv, invoiced, paid, unpaid, poValue: po, overdueCount: inv.filter((r) => r.status === "overdue").length, maxDaysOverdue: 0 });
  const activity = [
    ...(c.contract_date ? [{ date: c.contract_date, icon: <FileSignature size={14} />, text: `Purchase order placed${po ? ` for ${formatINR(po)}` : ""}` }] : []),
    ...inv.flatMap((r) => [
      { date: r.invoice_date, icon: <FileText size={14} />, text: `${r.number} raised for ${formatINR(r.amount)}` },
      ...(r.delivery_date ? [{ date: r.delivery_date, icon: <Truck size={14} />, text: `${r.number} delivered` }] : []),
      ...r.payments.map((p) => ({ date: p.paid_on, icon: <IndianRupee size={14} />, text: `${formatINR(p.amount)} received against ${r.number}` })),
    ]),
    ...(ev?.followups ?? []).map((f) => ({ date: f.sent_on, icon: <Send size={14} />, text: `${["", "Friendly nudge", "Firm reminder", "Formal demand"][f.step]} sent${f.reply_received ? ", buyer replied" : ""}` })),
    ...(ev?.promises ?? []).map((p) => ({ date: p.made_on, icon: <Wallet size={14} />, text: `Buyer promised ${formatINR(p.amount)} by ${formatDate(p.due_date)} (${p.status.replace("_", " ")})` })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-slate-600">
        <Link href="/contracts" className="inline-flex items-center gap-1 hover:underline"><ArrowLeft size={16} aria-hidden /> Contracts</Link>
        <span aria-hidden>›</span><span className="font-medium text-navy-900">{ref}</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold">Contract details</h1><Badge tone={st.tone}>{st.label}</Badge></div>
          <p className="mt-1 text-slate-600">Order terms, linked invoices and payment status.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/cases/${id}/report`} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"><FileText size={16} aria-hidden /> Report</Link>
          <Button onClick={() => setDialog("edit")}><Pencil size={16} aria-hidden /> Edit contract</Button>
          <Button variant="primary" onClick={() => setDialog("invoice")}><Plus size={16} aria-hidden /> Add invoice</Button>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-slate-200 bg-white p-5 text-sm md:grid-cols-3 xl:grid-cols-6">
        <div><p className="text-slate-500">Contract no.</p><p className="text-xl font-bold">{ref}</p><p className="text-xs text-slate-500">Purchase order</p></div>
        <div><p className="text-slate-500">Buyer</p><p className="font-semibold">{c.buyer.name}</p><Link href={`/buyers?buyer=${c.buyer.id}`} className="text-xs text-brand-600 underline">View profile</Link></div>
        <div><p className="text-slate-500">Contract value</p><p className="text-xl font-bold text-brand-600">{po ? formatINR(po) : "Not set"}</p></div>
        <div><p className="text-slate-500">PO date</p><p className="font-semibold">{formatDate(c.contract_date)}</p></div>
        <div><p className="text-slate-500">Status</p><Badge tone={st.tone}>{st.label}</Badge></div>
        <div><p className="text-slate-500">Payment terms</p><p className="font-semibold">{paymentTerms(inv)}</p></div>
      </section>

      <div role="tablist" aria-label="Contract sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cx("-mb-px border-b-2 px-4 py-2.5 text-sm font-medium", tab === t ? "border-brand-600 text-brand-600" : "border-transparent text-slate-600 hover:text-navy-900")}>{t}</button>
        ))}
      </div>

      <div className={cx("grid grid-cols-1 gap-6", tab === "Overview" && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
        <div role="tabpanel" aria-label={tab} className="min-w-0 space-y-6">
          {tab === "Overview" && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                <Tile label="Contract value" value={po ? formatINR(po) : "Not set"} tone="bg-violet-50" icon={<FileSignature size={18} className="text-violet-700" />} />
                <Tile label="Invoiced" value={formatINR(invoiced)} pct={pct(invoiced)} tone="bg-emerald-50" icon={<FileText size={18} className="text-emerald-700" />} />
                <Tile label="Paid" value={formatINR(paid)} pct={pct(paid)} tone="bg-amber-50" icon={<Wallet size={18} className="text-amber-700" />} />
                <Tile label="Outstanding" value={formatINR(unpaid)} pct={pct(unpaid)} tone="bg-red-50" icon={<TriangleAlert size={18} className="text-red-600" />} />
              </div>
              <Card title="Payment progress">
                <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Share of invoiced amount paid" aria-valuemin={0} aria-valuemax={100} aria-valuenow={invoiced ? Math.round((paid / invoiced) * 100) : 0}>
                  <div className="h-3 rounded-full bg-emerald-500" style={{ width: `${invoiced ? (paid / invoiced) * 100 : 0}%` }} />
                </div>
                <p className="mt-2 text-sm text-slate-600">{formatINR(paid)} paid of {formatINR(invoiced)} invoiced{po && invoiced > po ? `. Invoices exceed the PO value by ${formatINR(invoiced - po)}.` : "."}</p>
                {ev && <p className="mt-1 text-sm text-slate-600">With statutory interest (estimate): {formatINR(ev.totals.total)} owed. <Link href={`/cases/${id}`} className="font-medium text-brand-600 underline">See the recovery case</Link></p>}
              </Card>
              <Card title={<span className="flex items-center gap-2"><Flag size={18} className="text-brand-600" aria-hidden /> Delivery and payment milestones</span>}
                action={<button type="button" onClick={() => setTab("Milestones")} className="text-sm font-semibold text-brand-600 hover:underline">Manage</button>}>
                <MilestoneTable ms={ms} inv={inv} po={po} />
              </Card>
            </>
          )}
          {tab === "Milestones" && (
            <Card title={`Milestones (${ms.length})`} action={<Button className="py-1.5" onClick={() => setDialog("milestone")}>+ Add milestone</Button>}>
              <MilestoneTable ms={ms} inv={inv} po={po} onDelete={async (mid) => {
                try { await api.deleteMilestone(mid); setToast("Milestone removed"); reload(); }
                catch (e) { setToast(e instanceof ApiError ? e.message : "Couldn't remove it."); }
              }} />
              <p className="mt-3 text-xs text-slate-600">Milestones are the deliveries you planned under this order. Link each one to its invoice once raised; its payment status then follows that invoice.</p>
            </Card>
          )}
          {tab === "Linked invoices" && <Card title={`Linked invoices (${inv.length})`} action={<Button className="py-1.5" onClick={() => setDialog("invoice")}>+ Add invoice</Button>}><InvoiceTable inv={inv} /></Card>}
          {tab === "Documents" && (
            <Card title="Contract documents">
              <ul className="divide-y divide-slate-100">{c.evidence.map((e) => (
                <li key={e.kind} className="flex items-center justify-between gap-2 py-2.5 text-sm"><span>{EVIDENCE_LABEL[e.kind]}</span>
                  <Badge tone={e.status === "have" ? "green" : e.status === "missing" ? "red" : "slate"}>{e.status === "have" ? "On file" : e.status === "missing" ? "Missing" : "Not sure"}</Badge></li>))}
              </ul>
              <p className="mt-3 text-sm text-slate-600">File upload isn&apos;t available in this build. Mark what you hold on the <Link href={`/cases/${id}`} className="font-medium text-brand-600 underline">case page</Link>.</p>
            </Card>
          )}
          {tab === "Activity" && (
            <Card title="Activity">
              {activity.length === 0 ? <p className="text-sm text-slate-600">Nothing recorded yet.</p> : (
                <ol className="space-y-3">{activity.map((a, i) => (
                  <li key={i} className="flex gap-3 text-sm"><span className="mt-0.5 rounded-full bg-blue-50 p-1.5 text-brand-600" aria-hidden>{a.icon}</span>
                    <div><p>{a.text}</p><p className="text-xs text-slate-500">{formatDate(a.date)}</p></div></li>))}
                </ol>
              )}
            </Card>
          )}
        </div>

        {tab === "Overview" && <div className="space-y-6">
          <Card title={<span className="flex items-center gap-2"><Building2 size={20} className="text-brand-600" aria-hidden /> Buyer details</span>}>
            <p className="text-lg font-bold">{c.buyer.name}</p>
            <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">GSTIN</dt><dd>{c.buyer.gstin ?? "Not given"}</dd>
              <dt className="text-slate-500">Importance</dt><dd className="capitalize">{c.buyer.relationship_importance ?? "Not set"}</dd>
              <dt className="text-slate-500">Dispute</dt><dd>{c.dispute_reason === "none" ? "None raised" : `${c.dispute_reason} dispute raised`}</dd>
            </dl>
          </Card>
          <Card title="Quick actions">
            <div className="space-y-2">
              <button type="button" onClick={() => setDialog("invoice")} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm font-medium hover:border-brand-600"><Plus size={18} className="text-brand-600" aria-hidden /><span className="flex-1">Add an invoice</span><ChevronRight size={16} aria-hidden /></button>
              {[
                { href: `/assistant?case=${id}`, icon: Send, label: "Send a payment reminder" },
                { href: `/cases/${id}`, icon: Gavel, label: "Open the recovery case" },
                { href: `/cases/${id}/report`, icon: FileText, label: "Prepare the report" },
              ].map(({ href, icon: Icon, label }) => (
                <Link key={label} href={href} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium hover:border-brand-600"><Icon size={18} className="text-brand-600" aria-hidden /><span className="flex-1">{label}</span><ChevronRight size={16} aria-hidden /></Link>
              ))}
            </div>
          </Card>
        </div>}
      </div>
      <EstimateNote />

      {dialog === "edit" && <EditContract id={id} date={c.contract_date} po={c.po_amount} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setToast("Contract updated"); reload(); }} />}
      {dialog === "milestone" && <AddMilestone caseId={id} inv={inv} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setToast("Milestone added"); reload(); }} />}
      {dialog === "invoice" && <AddInvoice caseId={id} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setToast("Invoice added"); reload(); }} />}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function InvoiceTable({ inv }: { inv: import("@/types/api").InvoiceRow[] }) {
  if (inv.length === 0) return <p className="text-sm text-slate-600">No invoices yet.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm [&_td]:pr-3 [&_th]:pr-3">
        <caption className="sr-only">Invoices under this contract</caption>
        <thead className="bg-slate-50 text-xs text-slate-600"><tr>
          <th scope="col" className="py-2.5 pl-3 text-left font-semibold">Invoice</th><th scope="col" className="text-left font-semibold">Invoice date</th>
          <th scope="col" className="text-left font-semibold">Delivered</th><th scope="col" className="text-left font-semibold">Due by</th>
          <th scope="col" className="text-right font-semibold">Amount</th><th scope="col" className="text-right font-semibold">Paid</th>
          <th scope="col" className="text-right font-semibold">Days overdue</th><th scope="col" className="pl-4 text-left font-semibold">Status</th>
        </tr></thead>
        <tbody>{inv.map((r) => (
          <tr key={r.id} className="border-b border-slate-100 last:border-0">
            <td className="py-3 pl-3"><Link href={`/invoices/${r.id}`} className="font-medium text-brand-600 hover:underline">{r.number}</Link></td>
            <td className="whitespace-nowrap">{formatDate(r.invoice_date)}</td><td className="whitespace-nowrap">{formatDate(r.delivery_date)}</td>
            <td className="whitespace-nowrap">{formatDate(r.last_day_to_pay)}</td>
            <td className="text-right tabular-nums">{formatINR(r.amount)}</td><td className="text-right tabular-nums">{formatINR(r.paid)}</td>
            <td className={cx("text-right tabular-nums", r.days_overdue ? "font-medium text-red-600" : "text-slate-500")}>{r.days_overdue || "—"}</td>
            <td className="whitespace-nowrap pl-4"><PayStatusBadge status={r.status} partial={r.partially_paid} /></td>
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

function EditContract({ id, date, po, onClose, onSaved }: { id: string; date: string | null; po: string | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(date ?? "");
  const [amount, setAmount] = useState(po ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const body: Record<string, unknown> = {};
    if (d && d !== date) body.contract_date = d;
    if (amount && amount !== po) body.po_amount = amount;
    try { await api.patchCase(id, body); onSaved(); } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong."); }
  };
  return (
    <Dialog title="Edit contract" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="PO date" htmlFor="ec-date" hint="Used to check Udyam registration was in place"><input id="ec-date" type="date" max={todayISO()} value={d} onChange={(e) => setD(e.target.value)} className={inputClass} /></Field>
        <Field label="PO value (₹)" htmlFor="ec-amt" hint="Invoices are checked against it"><input id="ec-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={inputClass} /></Field>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </Dialog>
  );
}

function AddInvoice({ caseId, onClose, onSaved }: { caseId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ number: "", invoice_date: "", amount: "", delivery_date: "", agreed_due_date: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === "amount" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value });
  const save = async () => {
    setError(null);
    if (!f.number.trim() || !f.invoice_date || !(Number(f.amount) > 0)) return setError("Enter the invoice number, date and an amount above zero.");
    try {
      await api.addInvoice(caseId, { number: f.number.trim(), invoice_date: f.invoice_date, amount: f.amount, delivery_date: f.delivery_date || null, agreed_due_date: f.agreed_due_date || null });
      onSaved();
    } catch (e) { setError(e instanceof ApiError ? `${e.message}${e.field ? ` (${e.field})` : ""}` : "Something went wrong."); }
  };
  const today = todayISO();
  return (
    <Dialog title="Add an invoice to this contract" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Add invoice</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice number" htmlFor="ai-num"><input id="ai-num" value={f.number} onChange={set("number")} className={inputClass} /></Field>
        <Field label="Amount (₹)" htmlFor="ai-amt"><input id="ai-amt" inputMode="decimal" value={f.amount} onChange={set("amount")} className={inputClass} /></Field>
        <Field label="Invoice date" htmlFor="ai-date"><input id="ai-date" type="date" max={today} value={f.invoice_date} onChange={set("invoice_date")} className={inputClass} /></Field>
        <Field label="Delivered on" htmlFor="ai-del" hint="Needed for the due date"><input id="ai-del" type="date" max={today} value={f.delivery_date} onChange={set("delivery_date")} className={inputClass} /></Field>
        <Field label="Agreed in writing to pay by (optional)" htmlFor="ai-agr"><input id="ai-agr" type="date" value={f.agreed_due_date} onChange={set("agreed_due_date")} className={inputClass} /></Field>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </Dialog>
  );
}

type Tone = "green" | "red" | "amber" | "blue" | "slate";
function milestoneStatus(m: Milestone, r: InvoiceRow | undefined): { delivery: [string, Tone]; payment: [string, Tone] } {
  const today = todayISO();
  const delivery: [string, Tone] = r?.delivery_date ? ["Delivered", "green"] : m.due_date < today ? ["Delayed", "red"] : ["Upcoming", "slate"];
  const payment: [string, Tone] = !r ? ["Not invoiced", "slate"]
    : r.status === "paid" ? ["Paid", "green"]
    : r.status === "overdue" ? [r.partially_paid ? "Overdue · part paid" : "Overdue", "red"]
    : r.partially_paid ? ["Part paid", "amber"] : ["Invoiced", "blue"];
  return { delivery, payment };
}

function MilestoneTable({ ms, inv, po, onDelete }: { ms: Milestone[]; inv: InvoiceRow[]; po: number | null; onDelete?: (id: string) => void }) {
  if (ms.length === 0) return <p className="text-sm text-slate-600">No milestones yet. Add the deliveries you planned under this order.</p>;
  const total = ms.reduce((s, m) => s + Number(m.amount), 0);
  return (
    <>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm [&_td]:pr-3 [&_th]:pr-3">
          <caption className="sr-only">Delivery and payment milestones</caption>
          <thead className="bg-slate-50 text-xs text-slate-600"><tr>
            <th scope="col" className="py-2.5 pl-3 text-left font-semibold">#</th>
            <th scope="col" className="text-left font-semibold">Milestone</th>
            <th scope="col" className="text-left font-semibold">Due</th>
            <th scope="col" className="text-right font-semibold">Value</th>
            <th scope="col" className="text-left font-semibold">Delivery</th>
            <th scope="col" className="text-left font-semibold">Payment</th>
            {onDelete && <th scope="col"><span className="sr-only">Remove</span></th>}
          </tr></thead>
          <tbody>{ms.map((m, i) => {
            const r = inv.find((x) => x.id === m.invoice_id);
            const st = milestoneStatus(m, r);
            return (
              <tr key={m.id} className="border-b border-slate-100 last:border-0">
                <td className="py-3 pl-3 text-slate-500">M{i + 1}</td>
                <td className="min-w-[180px]">{m.title}{r && <> · <Link href={`/invoices/${r.id}`} className="whitespace-nowrap text-brand-600 hover:underline">{r.number}</Link></>}</td>
                <td className="whitespace-nowrap">{formatDate(m.due_date)}</td>
                <td className="text-right tabular-nums">{formatINR(m.amount)}</td>
                <td className="whitespace-nowrap"><Badge tone={st.delivery[1]}>{st.delivery[0]}</Badge></td>
                <td className="whitespace-nowrap"><Badge tone={st.payment[1]}>{st.payment[0]}</Badge></td>
                {onDelete && <td className="text-right"><button type="button" aria-label={`Remove ${m.title}`} onClick={() => onDelete(m.id)}
                  className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 size={15} aria-hidden /></button></td>}
              </tr>);
          })}</tbody>
        </table>
      </div>
      {po !== null && Math.abs(total - po) > 0.005 && (
        <p className="mt-2 text-xs text-amber-800">Milestones add up to {formatINR(total)}; the PO value is {formatINR(po)}.</p>
      )}
    </>
  );
}

function AddMilestone({ caseId, inv, onClose, onSaved }: { caseId: string; inv: InvoiceRow[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: "", due_date: "", amount: "", invoice_id: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === "amount" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value });
  const save = async () => {
    setError(null);
    if (!f.title.trim()) return setError("Name the milestone, e.g. Second delivery.");
    if (!f.due_date) return setError("Choose the planned date.");
    if (!(Number(f.amount) > 0)) return setError("Enter the value of this milestone.");
    setBusy(true);
    try {
      await api.addMilestone(caseId, { title: f.title.trim(), due_date: f.due_date, amount: f.amount, invoice_id: f.invoice_id || null });
      onSaved();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't save it."); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title="Add a milestone" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Add milestone"}</Button></>}>
      <div className="space-y-4">
        <Field label="Milestone" htmlFor="ms-title"><input id="ms-title" value={f.title} onChange={set("title")} maxLength={120} placeholder="e.g. Third delivery: 1,000 cartons" className={inputClass} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Planned date" htmlFor="ms-date"><input id="ms-date" type="date" value={f.due_date} onChange={set("due_date")} className={inputClass} /></Field>
          <Field label="Value (₹)" htmlFor="ms-amount"><input id="ms-amount" inputMode="decimal" value={f.amount} onChange={set("amount")} className={inputClass} /></Field>
        </div>
        <Field label="Linked invoice (optional)" htmlFor="ms-inv"><select id="ms-inv" value={f.invoice_id} onChange={set("invoice_id")} className={inputClass}>
          <option value="">Not invoiced yet</option>{inv.map((r) => <option key={r.id} value={r.id}>{r.number} · {formatINR(r.amount)}</option>)}</select></Field>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    </Dialog>
  );
}
