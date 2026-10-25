"use client";

// C4: ask the buyer to confirm receipt through a one-time link (no account needed).
// A "received in good order" answer is written acceptance from the buyer: strong evidence.
import { Check, Copy, Link2, Mail, MessageCircle } from "lucide-react";
import { useState } from "react";
import { Badge, Button, LoadingState } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

export function ConfirmationCard({ invoiceId, invoiceNumber, buyerName }: { invoiceId: string; invoiceNumber: string; buyerName?: string | null }) {
  const { data, loading, reload } = useAsync(() => api.listConfirmationLinks(invoiceId), [invoiceId]);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setError(null); setCopied(false);
    try {
      const l = await api.createConfirmationLink(invoiceId);
      setUrl(`${window.location.origin}${l.path}`);
      reload();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't create the link."); }
    finally { setBusy(false); }
  };
  const message = url ? `Hello${buyerName ? ` ${buyerName} team` : ""}, please confirm you received ${invoiceNumber} in good order (one click, no login): ${url}` : "";
  const copy = async () => { if (url) { try { await navigator.clipboard.writeText(message); setCopied(true); } catch { setCopied(false); } } };
  const answered = (data ?? []).filter((l) => l.used_at);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Send the buyer a one-time link to confirm delivery. A &quot;received in good order&quot; answer is written acceptance, stronger than deemed acceptance.</p>
      {url ? (
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="font-medium">Link ready (shown once, works for 30 days):</p>
          <p className="break-all text-xs text-slate-700">{url}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={copy}>{copied ? <><Check size={16} aria-hidden /> Copied</> : <><Copy size={16} aria-hidden /> Copy message</>}</Button>
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium hover:bg-slate-50"><MessageCircle size={16} aria-hidden /> Open in WhatsApp</a>
            <a href={`mailto:?subject=${encodeURIComponent("Delivery & Receipt Confirmation")}&body=${encodeURIComponent(message)}`}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-600 bg-white px-3 py-2 font-medium text-blue-700 hover:bg-blue-50"><Mail size={16} aria-hidden /> Open in email</a>
          </div>
        </div>
      ) : (
        <Button variant="primary" onClick={create} disabled={busy}><Link2 size={16} aria-hidden /> {busy ? "Creating…" : "Ask buyer to confirm receipt"}</Button>
      )}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {loading ? <LoadingState label="Loading" /> : (data ?? []).length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {(data ?? []).slice(0, 5).map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-2 p-2.5">
              <div className="min-w-0">
                <p className="font-medium">Sent {formatDate(l.created_at?.slice(0, 10))}</p>
                {l.used_at && <p className="text-slate-600">{l.responder_name}{l.note ? `: “${l.note}”` : ""}</p>}
              </div>
              {l.response === "received_ok" ? <Badge tone="green">Confirmed</Badge>
                : l.response === "issue" ? <Badge tone="amber">Problem raised</Badge>
                : new Date(l.expires_at ?? 0) < new Date() ? <Badge tone="slate">Expired</Badge>
                : <Badge tone="blue">Waiting</Badge>}
            </li>))}
        </ul>
      )}
      {answered.length > 0 && <p className="text-xs text-slate-500">Answers are also saved as invoice notes{answered.some((l) => l.response === "issue") ? " and problems as payment blockers" : ""}.</p>}
    </div>
  );
}
