"use client";

import { Download, FileText, ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Card, inputClass } from "@/components/ui";
import { api, ApiError, downloadFile } from "@/lib/api";
import { EVIDENCE_LABEL, formatDate } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { EvidenceKind } from "@/types/api";

const KINDS = Object.keys(EVIDENCE_LABEL) as EvidenceKind[];
const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** B2: keep the actual documents with the case. Stored privately; downloads are checked against
 *  the SHA-256 recorded at upload, so a changed file is caught. */
export function EvidenceFilesCard({ caseId, onChange }: { caseId: string; onChange: () => void }) {
  const { data, error, loading, reload } = useAsync(() => api.listFiles(caseId), [caseId]);
  const [kind, setKind] = useState<EvidenceKind | "">("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setMsg(null);
    if (data && file.size > data.max_bytes) {
      setMsg({ ok: false, text: "That file is larger than 10 MB. Use a smaller photo or PDF." });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    if (kind) form.append("kind", kind);
    setBusy(true);
    try {
      const f = await api.uploadFile(caseId, form);
      setMsg({ ok: true, text: `Kept “${f.file_name}”${f.kind ? `, and marked ${EVIDENCE_LABEL[f.kind].toLowerCase()} as held` : ""}.` });
      reload();
      if (f.kind) onChange();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Upload failed. Try again." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Remove “${name}” from this case?`)) return;
    try { await api.deleteFile(id); reload(); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Could not remove the file." }); }
  }

  async function get(id: string, name: string) {
    setMsg(null);
    try { await downloadFile(`/api/files/${id}/download`, name); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Could not download the file." }); }
  }

  return (
    <Card title="Documents kept">
      {loading && !data && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-red-700">Could not load the documents.</p>}
      {data && !data.enabled && (
        <p className="text-sm text-slate-600">File storage is turned off on this server. You can still tick evidence as held above.</p>
      )}
      {data?.enabled && (
        <>
          <div className="flex flex-col gap-2">
            <label className="sr-only" htmlFor="file-kind">What is this document?</label>
            <select id="file-kind" value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind | "")}
              className={inputClass}>
              <option value="">What is it? (optional)</option>
              {KINDS.map((k) => <option key={k} value={k}>{EVIDENCE_LABEL[k]}</option>)}
            </select>
            <input ref={input} type="file" accept={ACCEPT} className="hidden" id="evidence-file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
            <button type="button" disabled={busy} onClick={() => input.current?.click()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
              <Upload size={16} aria-hidden /> {busy ? "Uploading…" : "Add PDF or photo"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">PDF, JPG, PNG or WebP, up to 10 MB. Kept privately with this case.</p>
          {msg && <p role="status" className={"mt-2 text-sm " + (msg.ok ? "text-emerald-700" : "text-red-700")}>{msg.text}</p>}
          {data.files.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Paperclip size={14} aria-hidden /> No documents yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {data.files.map((f) => (
                <li key={f.id} className="flex items-start gap-3 py-2">
                  {f.content_type === "application/pdf"
                    ? <FileText size={18} className="mt-0.5 shrink-0 text-red-600" aria-hidden />
                    : <ImageIcon size={18} className="mt-0.5 shrink-0 text-sky-600" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900" title={f.file_name}>{f.file_name}</p>
                    <p className="text-xs text-slate-500">
                      {f.kind ? EVIDENCE_LABEL[f.kind] : "Other"} · {size(f.size_bytes)} · {formatDate(f.uploaded_at.slice(0, 10))}
                    </p>
                    <p className="truncate font-mono text-[10px] text-slate-400" title={`SHA-256 ${f.sha256}`}>SHA-256 {f.sha256}</p>
                  </div>
                  <button type="button" onClick={() => get(f.id, f.file_name)} aria-label={`Download ${f.file_name}`}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Download size={16} /></button>
                  <button type="button" onClick={() => remove(f.id, f.file_name)} aria-label={`Remove ${f.file_name}`}
                    className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
