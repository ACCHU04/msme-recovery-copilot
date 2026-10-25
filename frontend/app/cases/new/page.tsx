"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorState, Field, inputClass, Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { EVIDENCE_LABEL, EVIDENCE_WHY, formatDate, formatINR, todayISO } from "@/lib/format";
import type { EvidenceKind, EvidenceStatus } from "@/types/api";

type Pay = { paid_on: string; amount: string };
type Inv = {
  number: string; invoice_date: string; amount: string; delivery_date: string;
  agreed_due_date: string; objected: boolean; objection_date: string; objection_removed_date: string;
  payments: Pay[];
};
const blankInv = (): Inv => ({
  number: "", invoice_date: "", amount: "", delivery_date: "", agreed_due_date: "",
  objected: false, objection_date: "", objection_removed_date: "", payments: [],
});
const KINDS = Object.keys(EVIDENCE_LABEL) as EvidenceKind[];
const STEPS = ["Buyer", "Order", "Invoices", "Evidence", "Review"];
const money = (s: string) => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

export default function NewCasePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [buyer, setBuyer] = useState({ name: "", gstin: "", relationship_importance: "medium" });
  const [order, setOrder] = useState({ contract_date: "", po_amount: "" });
  const [invs, setInvs] = useState<Inv[]>([blankInv()]);
  const [evidence, setEvidence] = useState<Record<EvidenceKind, EvidenceStatus>>(
    Object.fromEntries(KINDS.map((k) => [k, "unknown"])) as Record<EvidenceKind, EvidenceStatus>);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const today = todayISO();

  const setInv = (i: number, patch: Partial<Inv>) => setInvs((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  function validate(s: number): boolean {
    const e: Record<string, string> = {};
    if (s === 0 && !buyer.name.trim()) e.buyer_name = "Enter the buyer's name.";
    if (s === 0 && buyer.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(buyer.gstin.toUpperCase()))
      e.gstin = "GSTIN should be 15 characters, like 29ABCDE1234F1Z5.";
    if (s === 1) {
      if (order.contract_date && order.contract_date > today) e.contract_date = "The PO date can't be in the future.";
      if (order.po_amount && !(Number(order.po_amount) > 0)) e.po_amount = "Enter an amount above zero.";
    }
    if (s === 2) invs.forEach((v, i) => {
      if (!v.number.trim()) e[`inv${i}_number`] = "Enter the invoice number.";
      if (invs.filter((x) => x.number.trim() === v.number.trim()).length > 1) e[`inv${i}_number`] = "Invoice numbers must be different.";
      if (!v.invoice_date) e[`inv${i}_invoice_date`] = "Enter the invoice date.";
      else if (v.invoice_date > today) e[`inv${i}_invoice_date`] = "Can't be in the future.";
      if (!(Number(v.amount) > 0)) e[`inv${i}_amount`] = "Enter an amount above zero.";
      if (v.delivery_date && v.delivery_date > today) e[`inv${i}_delivery_date`] = "Can't be in the future.";
      if (v.objected) {
        if (!v.objection_date) e[`inv${i}_objection_date`] = "Enter when the buyer objected.";
        else if (v.delivery_date && v.objection_date < v.delivery_date) e[`inv${i}_objection_date`] = "Can't be before delivery.";
        if (v.objection_removed_date && v.objection_removed_date < v.objection_date) e[`inv${i}_objection_removed_date`] = "Can't be before the objection.";
      }
      const paid = v.payments.reduce((s, p) => s + Math.round(Number(p.amount || 0) * 100), 0);
      v.payments.forEach((p, j) => {
        if (!p.paid_on) e[`inv${i}_pay${j}`] = "Enter the payment date.";
        else if (p.paid_on > today || (v.invoice_date && p.paid_on < v.invoice_date)) e[`inv${i}_pay${j}`] = "Date must be between the invoice date and today.";
        if (!(Number(p.amount) > 0)) e[`inv${i}_pay${j}`] = "Enter an amount above zero.";
      });
      if (paid > Math.round(Number(v.amount) * 100)) e[`inv${i}_pays`] = "Payments add up to more than the invoice. Check them (interest paid is handled later on the case page).";
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const next = () => validate(step) && setStep((s) => s + 1);

  async function submit() {
    setSubmitError(null);
    if (createdId) return router.push(`/cases/${createdId}`);
    setBusy(true);
    try {
      const c = await api.createCase({
        buyer: { name: buyer.name.trim(), gstin: buyer.gstin.trim().toUpperCase() || null, relationship_importance: buyer.relationship_importance },
        contract_date: order.contract_date || null,
      });
      setCreatedId(c.id);
      if (order.po_amount) await api.patchCase(c.id, { po_amount: order.po_amount, status: "active" });
      else await api.patchCase(c.id, { status: "active" });
      for (const v of invs) {
        const inv = await api.addInvoice(c.id, {
          number: v.number.trim(), invoice_date: v.invoice_date, amount: v.amount,
          delivery_date: v.delivery_date || null, agreed_due_date: v.agreed_due_date || null,
          objection_date: v.objected ? v.objection_date : null,
          objection_removed_date: v.objected && v.objection_removed_date ? v.objection_removed_date : null,
        });
        for (const p of [...v.payments].sort((a, b) => a.paid_on.localeCompare(b.paid_on)))
          await api.addPayment(inv.id, p);
      }
      for (const k of KINDS) if (evidence[k] !== "unknown") await api.setEvidence(c.id, k, evidence[k]);
      router.push(`/cases/${c.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && /profile/i.test(e.message)) {
        setSubmitError("Set up your Business Profile first, then try again.");
      } else setSubmitError(e instanceof ApiError ? `${e.message}${e.field ? ` (${e.field})` : ""}` : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => errors[k];
  const inputProps = (k: string) => ({ "aria-invalid": err(k) ? true : undefined, className: inputClass });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Add a case</h1>
        <p className="text-sm text-slate-600">One buyer, one order, one or more unpaid invoices.</p>
      </div>
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined}
            className={`rounded-full px-3 py-1 ${i === step ? "bg-brand-600 text-white" : i < step ? "bg-blue-50 text-brand-600" : "bg-slate-100 text-slate-600"}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card title="Who owes you?">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Buyer name" htmlFor="b-name" error={err("buyer_name")}>
              <input id="b-name" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} {...inputProps("buyer_name")} placeholder="Buyer company name" />
            </Field>
            <Field label="Buyer GSTIN (optional)" htmlFor="b-gstin" error={err("gstin")} hint="Format is checked; it is not looked up.">
              <input id="b-gstin" value={buyer.gstin} onChange={(e) => setBuyer({ ...buyer, gstin: e.target.value })} {...inputProps("gstin")} />
            </Field>
            <Field label="How important is keeping this customer?" htmlFor="b-imp" hint="Shapes how gently the app suggests following up.">
              <select id="b-imp" value={buyer.relationship_importance} onChange={(e) => setBuyer({ ...buyer, relationship_importance: e.target.value })} className={inputClass}>
                <option value="high">Very important</option>
                <option value="medium">Somewhat important</option>
                <option value="low">Not important</option>
              </select>
            </Field>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card title="The order">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Purchase order or contract date" htmlFor="po-date" error={err("contract_date")}
              hint="Used to check your Udyam registration was in place before the order.">
              <input id="po-date" type="date" max={today} value={order.contract_date} onChange={(e) => setOrder({ ...order, contract_date: e.target.value })} {...inputProps("contract_date")} />
            </Field>
            <Field label="PO amount (₹, optional)" htmlFor="po-amount" error={err("po_amount")} hint="Checked against the invoice total.">
              <input id="po-amount" inputMode="decimal" value={order.po_amount} onChange={(e) => setOrder({ ...order, po_amount: money(e.target.value) })} {...inputProps("po_amount")} />
            </Field>
          </div>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Notice tone="blue">The invoice date alone doesn&apos;t set the legal deadline. The clock runs from delivery and acceptance, and any credit period agreed in writing (never more than 45 days).</Notice>
          {invs.map((v, i) => (
            <Card key={i} title={`Invoice ${i + 1}`} action={invs.length > 1 && (
              <Button variant="ghost" aria-label={`Remove invoice ${i + 1}`} onClick={() => setInvs((a) => a.filter((_, j) => j !== i))}><Trash2 size={16} /></Button>)}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Invoice number" htmlFor={`n${i}`} error={err(`inv${i}_number`)}>
                  <input id={`n${i}`} value={v.number} onChange={(e) => setInv(i, { number: e.target.value })} {...inputProps(`inv${i}_number`)} />
                </Field>
                <Field label="Invoice date" htmlFor={`d${i}`} error={err(`inv${i}_invoice_date`)}>
                  <input id={`d${i}`} type="date" max={today} value={v.invoice_date} onChange={(e) => setInv(i, { invoice_date: e.target.value })} {...inputProps(`inv${i}_invoice_date`)} />
                </Field>
                <Field label="Amount (₹)" htmlFor={`a${i}`} error={err(`inv${i}_amount`)}>
                  <input id={`a${i}`} inputMode="decimal" value={v.amount} onChange={(e) => setInv(i, { amount: money(e.target.value) })} {...inputProps(`inv${i}_amount`)} />
                </Field>
                <Field label="Delivered on" htmlFor={`dd${i}`} error={err(`inv${i}_delivery_date`)} hint="Needed to work out the due date.">
                  <input id={`dd${i}`} type="date" max={today} value={v.delivery_date} onChange={(e) => setInv(i, { delivery_date: e.target.value })} {...inputProps(`inv${i}_delivery_date`)} />
                </Field>
                <Field label="Agreed in writing to pay by (optional)" htmlFor={`ad${i}`} hint="Leave empty if no credit period was agreed in writing.">
                  <input id={`ad${i}`} type="date" value={v.agreed_due_date} onChange={(e) => setInv(i, { agreed_due_date: e.target.value })} className={inputClass} />
                </Field>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-slate-800">
                    <input type="checkbox" checked={v.objected} onChange={(e) => setInv(i, { objected: e.target.checked })} />
                    Buyer objected in writing
                  </label>
                </div>
                {v.objected && (
                  <>
                    <Field label="Objection date" htmlFor={`od${i}`} error={err(`inv${i}_objection_date`)}>
                      <input id={`od${i}`} type="date" max={today} value={v.objection_date} onChange={(e) => setInv(i, { objection_date: e.target.value })} {...inputProps(`inv${i}_objection_date`)} />
                    </Field>
                    <Field label="Objection resolved on (if resolved)" htmlFor={`or${i}`} error={err(`inv${i}_objection_removed_date`)}>
                      <input id={`or${i}`} type="date" max={today} value={v.objection_removed_date} onChange={(e) => setInv(i, { objection_removed_date: e.target.value })} {...inputProps(`inv${i}_objection_removed_date`)} />
                    </Field>
                  </>
                )}
              </div>
              <div className="mt-4 space-y-2">
                <p className="text-sm font-medium text-slate-800">Payments received</p>
                {v.payments.map((p, j) => (
                  <div key={j} className="flex flex-wrap items-end gap-2">
                    <div className="w-40"><Field label="Paid on" htmlFor={`p${i}-${j}`}>
                      <input id={`p${i}-${j}`} type="date" max={today} value={p.paid_on} onChange={(e) => setInv(i, { payments: v.payments.map((x, k) => (k === j ? { ...x, paid_on: e.target.value } : x)) })} className={inputClass} />
                    </Field></div>
                    <div className="w-40"><Field label="Amount (₹)" htmlFor={`pa${i}-${j}`}>
                      <input id={`pa${i}-${j}`} inputMode="decimal" value={p.amount} onChange={(e) => setInv(i, { payments: v.payments.map((x, k) => (k === j ? { ...x, amount: money(e.target.value) } : x)) })} className={inputClass} />
                    </Field></div>
                    <Button variant="ghost" aria-label="Remove payment" onClick={() => setInv(i, { payments: v.payments.filter((_, k) => k !== j) })}><Trash2 size={16} /></Button>
                    {err(`inv${i}_pay${j}`) && <p role="alert" className="w-full text-xs text-red-700">{err(`inv${i}_pay${j}`)}</p>}
                  </div>
                ))}
                {err(`inv${i}_pays`) && <p role="alert" className="text-xs text-red-700">{err(`inv${i}_pays`)}</p>}
                <Button onClick={() => setInv(i, { payments: [...v.payments, { paid_on: "", amount: "" }] })}><Plus size={14} aria-hidden /> Add payment</Button>
              </div>
            </Card>
          ))}
          <Button onClick={() => setInvs((a) => [...a, blankInv()])}><Plus size={16} aria-hidden /> Add another invoice</Button>
        </div>
      )}

      {step === 3 && (
        <Card title="What documents do you have?">
          <div className="space-y-3">
            {KINDS.map((k) => (
              <div key={k} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">{EVIDENCE_LABEL[k]}</p><p className="text-xs text-slate-500">{EVIDENCE_WHY[k]}</p></div>
                <label className="sr-only" htmlFor={`e-${k}`}>{EVIDENCE_LABEL[k]}</label>
                <select id={`e-${k}`} value={evidence[k]} onChange={(e) => setEvidence({ ...evidence, [k]: e.target.value as EvidenceStatus })} className={`${inputClass} w-32!`}>
                  <option value="have">Have it</option><option value="missing">Missing</option><option value="unknown">Not sure</option>
                </select>
              </div>
            ))}
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card title="Check before saving">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <dt className="text-slate-500">Buyer</dt><dd>{buyer.name} ({buyer.relationship_importance} importance)</dd>
            <dt className="text-slate-500">PO</dt><dd>{formatDate(order.contract_date)}{order.po_amount && ` · ${formatINR(order.po_amount)}`}</dd>
            {invs.map((v) => (
              <div key={v.number} className="contents">
                <dt className="text-slate-500">{v.number}</dt>
                <dd>{formatINR(v.amount)} · invoiced {formatDate(v.invoice_date)} · delivered {formatDate(v.delivery_date)}
                  {v.agreed_due_date && ` · pay by ${formatDate(v.agreed_due_date)}`}{v.objected && " · objection recorded"}
                  {v.payments.length > 0 && ` · ${v.payments.length} payment(s)`}</dd>
              </div>
            ))}
            <dt className="text-slate-500">Documents marked “have”</dt><dd>{KINDS.filter((k) => evidence[k] === "have").map((k) => EVIDENCE_LABEL[k]).join(", ") || "None"}</dd>
          </dl>
          <p className="mt-4 text-xs text-slate-500">Amounts owed and interest are worked out by the server after saving.</p>
        </Card>
      )}

      {submitError && <ErrorState message={submitError} />}
      {submitError?.includes("Business Profile") && <Link href="/profile" className="text-sm font-medium text-brand-600 underline">Go to Business Profile</Link>}
      {submitError && createdId && (
        <p className="text-sm text-slate-700">The case was created but not everything saved.{" "}
          <Link href={`/cases/${createdId}`} className="font-medium text-brand-600 underline">Open the case</Link> to check it rather than saving again.</p>
      )}

      <div className="flex justify-between">
        <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>Back</Button>
        {step < 4 ? <Button variant="primary" onClick={next}>Continue</Button>
          : <Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save case"}</Button>}
      </div>
    </div>
  );
}
