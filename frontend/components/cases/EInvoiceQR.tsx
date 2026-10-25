"use client";

// B1: read the signed QR code on a GST e-invoice. The browser decodes the QR from a photo
// (jsQR); the backend decodes the signed data and compares it with the invoice. No AI.
import jsQR from "jsqr";
import { CheckCircle2, CircleAlert, QrCode, ScanLine, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, inputClass } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatINR } from "@/lib/format";
import type { QRResult } from "@/types/api";

const TONE = { match: "green", mismatch: "red", warning: "amber", not_comparable: "slate" } as const;
const LABEL = { match: "Matches", mismatch: "Doesn't match", warning: "Check", not_comparable: "Can't compare" } as const;

/** Find a QR code in a photo. Tries a few sizes: a QR in a whole-page photo can be small. */
async function readQR(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    for (const max of [1600, 2400, 1000, 700]) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
      if (found?.data) return found.data;
    }
    return null;
  } finally { URL.revokeObjectURL(url); }
}

export function EInvoiceQR({ invoiceId, savedIrn, onSaved }: { invoiceId: string; savedIrn?: string | null; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QRResult | null>(null);
  const [paste, setPaste] = useState("");
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const check = async (text: string) => {
    setBusy(true); setError(null); setResult(null); setSaved(false);
    try { setResult(await api.checkQR(text.trim(), invoiceId)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't check the QR code."); }
    finally { setBusy(false); }
  };
  const fromPhoto = async (f: File | null) => {
    if (!f) return;
    setError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return setError("Choose a JPG, PNG or WebP photo of the e-invoice.");
    setBusy(true);
    const text = await readQR(f).catch(() => null);
    setBusy(false);
    if (!text) return setError("No QR code found. Take a sharper, well-lit photo with the QR code filling more of the picture.");
    await check(text);
  };
  const save = async () => {
    if (!result?.fields.irn) return;
    try { await api.patchInvoice(invoiceId, { irn: result.fields.irn }); setSaved(true); onSaved(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't save the IRN."); }
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Scan the QR code printed on a GST e-invoice. Its details come straight from the GST portal&apos;s signed code, so they are exact. No AI is used.</p>
      {savedIrn && <p className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={16} aria-hidden /> IRN saved: <span className="font-mono text-xs">{savedIrn.slice(0, 16)}…</span></p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}><ScanLine size={16} aria-hidden /> {busy ? "Reading…" : "Choose a photo of the QR"}</Button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" aria-label="Photo of the e-invoice QR code"
          onChange={(e) => { void fromPhoto(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      </div>
      <details>
        <summary className="cursor-pointer text-slate-600">Or paste the QR text</summary>
        <div className="mt-2 flex gap-2">
          <label htmlFor="qr-paste" className="sr-only">QR code text</label>
          <input id="qr-paste" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="eyJhbGciOi…" className={inputClass} />
          <Button onClick={() => paste.trim() && check(paste)} disabled={busy || paste.trim().length < 20}><QrCode size={16} aria-hidden /> Check</Button>
        </div>
      </details>
      {error && <p role="alert" className="flex gap-1.5 text-red-700"><CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />{error}</p>}
      {result && (
        <div className="space-y-3" aria-live="polite">
          <div className={`rounded-lg border p-3 ${result.verdict === "looks_right" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            <p className="font-semibold">{result.verdict === "looks_right" ? "The e-invoice matches this invoice" : "Some details don't match"}</p>
            <p className="mt-1 flex items-start gap-1.5 text-xs">{result.signature_verified ? <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden /> : <ShieldQuestion size={14} className="mt-0.5 shrink-0" aria-hidden />}{result.signature_note}</p>
          </div>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {result.checks.map((c, i) => (
              <li key={i} className="flex items-start justify-between gap-2 p-2.5">
                <div className="min-w-0"><p className="font-medium">{c.check}</p><p className="text-slate-600">{c.detail}</p></div>
                <Badge tone={TONE[c.status]}>{LABEL[c.status]}</Badge>
              </li>))}
          </ul>
          <dl className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs">
            <div><dt className="text-slate-500">Document</dt><dd>{result.fields.doc_type ?? "—"} {result.fields.doc_no}</dd></div>
            <div><dt className="text-slate-500">Date</dt><dd>{formatDate(result.fields.doc_date)}</dd></div>
            <div><dt className="text-slate-500">Total</dt><dd>{formatINR(result.fields.total)}</dd></div>
            <div><dt className="text-slate-500">Items · HSN</dt><dd>{result.fields.item_count ?? "—"} · {result.fields.main_hsn ?? "—"}</dd></div>
            <div className="col-span-2"><dt className="text-slate-500">IRN</dt><dd className="break-all font-mono">{result.fields.irn ?? "—"}</dd></div>
          </dl>
          {result.can_save_irn && !saved && <Button onClick={save}>Save IRN to this invoice</Button>}
          {saved && <p className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={16} aria-hidden /> IRN saved. The invoice&apos;s e-invoice check now shows it.</p>}
        </div>
      )}
    </div>
  );
}
