"use client";

// Upload a photo or PDF; the backend has Gemini read it (every value must quote the text it
// came from) and then compares it with the records in plain code. Nothing is saved unless the
// owner presses "Mark as on file".
import { CheckCircle2, CircleAlert, CircleHelp, FileSearch, FileUp, Loader2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, cx, inputClass } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { EVIDENCE_LABEL } from "@/lib/format";
import type { DocumentCheck as Result, InvoiceRow } from "@/types/api";

const EXPECTED = [
  { id: "invoice", label: "Invoice" },
  { id: "purchase_order", label: "Purchase order" },
  { id: "delivery_proof", label: "Delivery challan or e-way bill" },
  { id: "udyam_certificate", label: "Udyam certificate" },
  { id: "", label: "Not sure (just read it)" },
] as const;

const FIELD_LABEL: Record<string, string> = {
  invoice_number: "Invoice number", invoice_date: "Invoice date", total_amount: "Total amount",
  seller_name: "Seller", buyer_name: "Buyer", seller_gstin: "Seller GSTIN", buyer_gstin: "Buyer GSTIN",
  po_number: "PO number", po_date: "PO date", delivery_date: "Delivery date", irn: "IRN", udyam_number: "Udyam number",
};

const VERDICT = {
  looks_right: { tone: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: CheckCircle2, title: "Looks right", body: "What we could read matches your records." },
  check_this: { tone: "border-amber-200 bg-amber-50 text-amber-900", icon: TriangleAlert, title: "Check this document", body: "Some details don't match your records or couldn't be confirmed." },
  wrong_document: { tone: "border-red-200 bg-red-50 text-red-900", icon: CircleAlert, title: "This may be the wrong document", body: "It doesn't look like the type you chose." },
  unreadable: { tone: "border-slate-200 bg-slate-50 text-slate-800", icon: CircleHelp, title: "Couldn't read it", body: "Try a sharper, well-lit photo of the whole page." },
} as const;

const STATUS: Record<string, { tone: "green" | "red" | "amber" | "slate"; label: string }> = {
  match: { tone: "green", label: "Matches" }, mismatch: { tone: "red", label: "Doesn't match" },
  not_on_document: { tone: "slate", label: "Not found" }, not_comparable: { tone: "slate", label: "Can't compare" },
  warning: { tone: "amber", label: "Check" },
};

export function DocumentCheck({ invoiceId, expected: initialExpected }: { invoiceId?: string; expected?: string }) {
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [inv, setInv] = useState(invoiceId ?? "");
  const [expected, setExpected] = useState<string>(initialExpected ?? "invoice");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { api.listInvoices().then(setInvoices).catch(() => setInvoices([])); }, []);
  useEffect(() => { if (invoiceId) setInv(invoiceId); }, [invoiceId]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (f: File | null) => {
    setResult(null); setError(null); setSaved(false);
    if (preview) URL.revokeObjectURL(preview);
    if (!f) { setFile(null); setPreview(null); return; }
    if (f.size > 8 * 1024 * 1024) { setError("That file is larger than 8 MB. Use a smaller photo or PDF."); return; }
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)) { setError("Upload a JPG, PNG or WebP photo, or a PDF."); return; }
    setFile(f);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  };

  const check = async () => {
    if (!file) return setError("Choose a photo or PDF first.");
    setBusy(true); setError(null); setResult(null); setSaved(false);
    try {
      const r = await api.checkDocument(file, { invoiceId: inv || undefined, expected: expected || undefined });
      if (r.source !== "ai") setError("Document reading isn't available right now (AI is not set up, or the service didn't respond). Nothing was checked.");
      else setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't check the document. Try again.");
    } finally { setBusy(false); }
  };

  const markOnFile = async () => {
    if (!result?.case_id || !result.evidence_kind) return;
    try { await api.setEvidence(result.case_id, result.evidence_kind, "have"); setSaved(true); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't update the case."); }
  };

  const v = result?.verdict ? VERDICT[result.verdict] : null;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Upload a photo or PDF. The AI reads it, then the app compares it with your records and tells you if it looks wrong.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-medium">It should be</span>
          <select value={expected} onChange={(e) => { setExpected(e.target.value); setResult(null); }} className={`${inputClass} py-2`}>
            {EXPECTED.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">For invoice</span>
          <select value={inv} onChange={(e) => { setInv(e.target.value); setResult(null); }} className={`${inputClass} py-2`} disabled={!invoices}>
            <option value="">{invoices ? "Don't compare" : "Loading…"}</option>
            {(invoices ?? []).map((r) => <option key={r.id} value={r.id}>{r.number} · {r.buyer_name}</option>)}
          </select>
        </label>
      </div>

      <div className="rounded-xl border-2 border-dashed border-slate-300 p-3">
        {!file ? (
          <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-1 py-4 text-brand-600 hover:bg-blue-50/50">
            <FileUp size={28} aria-hidden /><span className="font-semibold">Choose a photo or PDF</span>
            <span className="text-xs text-slate-500">JPG, PNG, WebP or PDF, up to 8 MB. On a phone you can take a photo.</span>
          </button>
        ) : (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not a served image */}
            {preview ? <img src={preview} alt="Selected document" className="h-16 w-16 rounded-md border border-slate-200 object-cover" />
              : <span className="flex h-16 w-16 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">PDF</span>}
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{file.name}</p><p className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</p></div>
            <button type="button" aria-label="Remove file" onClick={() => pick(null)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100"><X size={16} aria-hidden /></button>
          </div>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="sr-only"
          aria-label="Document file" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </div>

      <Button variant="primary" onClick={check} disabled={!file || busy} className="w-full justify-center">
        {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Reading the document…</> : <><FileSearch size={16} aria-hidden /> Check document</>}
      </Button>
      {error && <p role="alert" className="text-red-700">{error}</p>}

      {result && v && (
        <div className="space-y-3" aria-live="polite">
          <div className={cx("flex gap-2 rounded-lg border p-3", v.tone)}>
            <v.icon size={20} className="mt-0.5 shrink-0" aria-hidden />
            <div><p className="font-semibold">{v.title}</p><p>{v.body} {result.document_label && <>It looks like {result.document_label}.</>}</p></div>
          </div>
          {result.findings.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {result.findings.map((f, i) => (
                <li key={i} className="flex items-start justify-between gap-2 p-2.5">
                  <div className="min-w-0"><p className="font-medium">{f.check}</p><p className="text-slate-600">{f.detail}</p></div>
                  <Badge tone={STATUS[f.status].tone}>{STATUS[f.status].label}</Badge>
                </li>))}
            </ul>
          )}
          {result.fields.length > 0 && (
            <details className="rounded-lg border border-slate-200 p-2.5">
              <summary className="cursor-pointer font-medium">What the AI read ({result.fields.length})</summary>
              <dl className="mt-2 space-y-1.5">{result.fields.map((f) => (
                <div key={f.name}><dt className="text-xs text-slate-500">{FIELD_LABEL[f.name] ?? f.name}</dt>
                  <dd><span className="font-medium">{f.value}</span> <span className="text-xs text-slate-500">from “{f.source_text}”</span></dd></div>))}
              </dl>
            </details>
          )}
          {result.evidence_kind && result.case_id && (
            saved ? <p className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={16} aria-hidden /> Marked {EVIDENCE_LABEL[result.evidence_kind].toLowerCase()} as on file for this case.</p>
              : <Button onClick={markOnFile} className="w-full justify-center">Mark {EVIDENCE_LABEL[result.evidence_kind].toLowerCase()} as on file</Button>
          )}
        </div>
      )}
      <p className="text-xs text-slate-500">The file is sent to Google Gemini to be read and is not stored. Only values the AI can point to on the document are shown; the comparison with your records is done by the app. Always check against the original.</p>
    </div>
  );
}
