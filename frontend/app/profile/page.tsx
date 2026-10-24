"use client";

import { Building2, CircleCheck, Circle, Pencil, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorState, Field, inputClass, LoadingState, Notice, Toast, VerdictBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate, todayISO } from "@/lib/format";
import { useViewer } from "@/lib/auth/viewer";
import type { Business, CaseSummary } from "@/types/api";

type Form = { name: string; udyam_no: string; size: string; activity: string; udyam_registered: string; udyam_reg_date: string };
const toForm = (b: Partial<Business>): Form => ({
  name: b.name ?? "", udyam_no: b.udyam_no ?? "", size: b.size ?? "", activity: b.activity ?? "",
  udyam_registered: b.udyam_registered === null || b.udyam_registered === undefined ? "" : String(b.udyam_registered),
  udyam_reg_date: b.udyam_reg_date ?? "",
});
const SIZE = { micro: "Micro enterprise", small: "Small enterprise", medium: "Medium enterprise" } as Record<string, string>;
const ACT = { manufacturing: "Manufacturing", services: "Services", trader: "Trading (retail or wholesale)" } as Record<string, string>;

export default function ProfilePage() {
  const owner = useViewer()?.name;
  const [biz, setBiz] = useState<Business | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [editing, setEditing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.getBusiness().then((b) => { setBiz(b); setForm(toForm(b)); })
      .catch((e) => { if (e instanceof ApiError && e.status === 404) { setForm(toForm({})); setEditing(true); } else setLoadError(e.message); });
    api.listCases().then(setCases).catch(() => setCases([]));
  };
  useEffect(load, []);

  if (loadError) return <ErrorState message={loadError} />;
  if (!form) return <LoadingState />;
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const checklist = [
    { label: "Business name", ok: !!biz?.name },
    { label: "Enterprise size", ok: !!biz?.size },
    { label: "Main activity", ok: !!biz?.activity },
    { label: "Udyam registration status", ok: biz?.udyam_registered !== null && biz?.udyam_registered !== undefined },
    { label: "Udyam number", ok: !!biz?.udyam_no },
    { label: "Udyam registration date", ok: !!biz?.udyam_reg_date },
  ];
  const pct = Math.round((checklist.filter((c) => c.ok).length / checklist.length) * 100);
  const r = 40, circ = 2 * Math.PI * r;

  async function save() {
    setError(null);
    if (!form!.name.trim()) return setError({ message: "Enter your business name.", field: "name" });
    setBusy(true);
    try {
      const b = await api.saveBusiness({
        name: form!.name.trim(), udyam_no: form!.udyam_no || null,
        size: (form!.size || null) as Business["size"], activity: (form!.activity || null) as Business["activity"],
        udyam_registered: form!.udyam_registered === "" ? null : form!.udyam_registered === "true",
        udyam_reg_date: form!.udyam_reg_date || null,
      });
      setBiz(b); setForm(toForm(b)); setEditing(false); setToast("Profile saved. Eligibility re-checked on every case.");
      api.listCases().then(setCases).catch(() => {});
    } catch (e) {
      setError(e instanceof ApiError ? { message: e.message, field: e.field } : { message: "Something went wrong." });
    } finally { setBusy(false); }
  }
  const fe = (f: string) => (error?.field === f ? error.message : undefined);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Business profile</h1>
          <p className="mt-1 text-slate-600">These details decide whether the MSMED Act&apos;s delayed-payment rights apply to you.</p>
        </div>
        {!editing && <Button variant="primary" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden /> Edit profile</Button>}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {!editing && biz && (
            <section className="grid gap-6 rounded-xl border border-slate-200 bg-white p-6 lg:grid-cols-2">
              <div className="flex items-start gap-4">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-navy-800 text-white"><Building2 size={28} aria-hidden /></span>
                <div>
                  <h2 className="text-2xl font-bold">{biz.name}</h2>
                  <p className="text-slate-600">{[biz.size && SIZE[biz.size], biz.activity && ACT[biz.activity]].filter(Boolean).join(" · ") || "Size and activity not set"}</p>
                  <p className="mt-1 text-sm text-slate-500">Owner: {owner}</p>
                </div>
              </div>
              <dl className="grid grid-cols-[150px_1fr] gap-y-2 text-sm lg:border-l lg:border-slate-200 lg:pl-6">
                <dt className="text-slate-500">Udyam number</dt>
                <dd>{biz.udyam_no ?? "Not added"} {biz.udyam_no && <Badge tone="slate">Format checked</Badge>}</dd>
                <dt className="text-slate-500">Udyam registered</dt><dd>{biz.udyam_registered === null ? "Not sure" : biz.udyam_registered ? "Yes" : "No"}</dd>
                <dt className="text-slate-500">Registered on</dt><dd>{formatDate(biz.udyam_reg_date)}</dd>
                <dt className="text-slate-500">Phone</dt><dd>{biz.phone ?? "Not added"}</dd>
              </dl>
            </section>
          )}

          {editing && (
            <Card title={biz ? "Edit profile" : "Set up your business"}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name" htmlFor="s-name" error={fe("name")}><input id="s-name" value={form.name} onChange={set("name")} className={inputClass} aria-invalid={!!fe("name") || undefined} /></Field>
                <Field label="Udyam number" htmlFor="s-udyam" error={fe("udyam_no")} hint="Like UDYAM-KR-00-0000000. Format only; not looked up."><input id="s-udyam" value={form.udyam_no} onChange={set("udyam_no")} className={inputClass} aria-invalid={!!fe("udyam_no") || undefined} /></Field>
                <Field label="Enterprise size" htmlFor="s-size"><select id="s-size" value={form.size} onChange={set("size")} className={inputClass}><option value="">Not sure</option><option value="micro">Micro</option><option value="small">Small</option><option value="medium">Medium</option></select></Field>
                <Field label="Main activity" htmlFor="s-act"><select id="s-act" value={form.activity} onChange={set("activity")} className={inputClass}><option value="">Not sure</option><option value="manufacturing">Manufacturing</option><option value="services">Services</option><option value="trader">Trading (retail or wholesale)</option></select></Field>
                <Field label="Udyam registered?" htmlFor="s-reg"><select id="s-reg" value={form.udyam_registered} onChange={set("udyam_registered")} className={inputClass}><option value="">Not sure</option><option value="true">Yes</option><option value="false">No</option></select></Field>
                <Field label="Udyam registration date" htmlFor="s-regdate" error={fe("udyam_reg_date")}><input id="s-regdate" type="date" max={todayISO()} value={form.udyam_reg_date} onChange={set("udyam_reg_date")} className={inputClass} /></Field>
              </div>
              {error && !error.field && <div className="mt-3"><ErrorState message={error.message} /></div>}
              <div className="mt-4 flex gap-2">
                <Button variant="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button>
                {biz && <Button onClick={() => { setForm(toForm(biz)); setEditing(false); setError(null); }}>Cancel</Button>}
              </div>
            </Card>
          )}

          <Card title={<span className="flex items-center gap-2"><ShieldCheck size={20} className="text-brand-600" aria-hidden /> Eligibility on your cases</span>}>
            <p className="mb-3 text-sm text-slate-600">Checked per case, because it depends on whether your Udyam registration was in place before that order.</p>
            {cases.length === 0 ? <p className="text-sm text-slate-600">No cases yet.</p> : (
              <ul className="divide-y divide-slate-100">{cases.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <Link href={`/cases/${c.id}`} className="font-medium text-brand-600 hover:underline">{c.buyer_name} · PO {formatDate(c.contract_date)}</Link>
                  <VerdictBadge verdict={c.eligibility} />
                </li>))}
              </ul>
            )}
          </Card>
          <Notice tone="blue">Covered: micro and small enterprises with Udyam Registration in manufacturing or services. Not covered: medium enterprises and retail or wholesale traders. Registering after the order date is legally unsettled.</Notice>
        </div>

        <div className="space-y-6">
          <Card title="Profile completeness">
            <div className="flex items-center gap-5">
              <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90" role="img" aria-label={`Profile ${pct}% complete`}>
                <circle cx="50" cy="50" r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
                <circle cx="50" cy="50" r={r} fill="none" stroke="#1a56db" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(pct / 100) * circ} ${circ}`} />
                <text x="50" y="50" textAnchor="middle" dominantBaseline="central" transform="rotate(90 50 50)" className="fill-navy-900 text-[20px] font-bold">{pct}%</text>
              </svg>
              <ul className="space-y-1.5 text-sm">{checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2">{c.ok ? <CircleCheck size={16} className="text-emerald-600" aria-hidden /> : <Circle size={16} className="text-slate-400" aria-hidden />}
                  <span>{c.label}</span><span className="sr-only">{c.ok ? "done" : "missing"}</span></li>))}
              </ul>
            </div>
          </Card>
          <Card title="About verification">
            <p className="text-sm text-slate-600">This app checks the format of your Udyam number and the buyer&apos;s GSTIN. It does not confirm them with government systems, so nothing here is marked “verified”. Keep your Udyam certificate on file for each case.</p>
          </Card>
        </div>
      </div>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
