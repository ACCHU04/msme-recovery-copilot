"use client";

import {
  Building2, Circle, CircleCheck, FileText, Globe, Mail, MapPin, Package, Pencil, Phone, Plus, ShieldCheck, Trash2, UserPlus, Users, X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Dialog, ErrorState, Field, inputClass, LoadingState, Notice, Toast, VerdictBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useViewer } from "@/lib/auth/viewer";
import { formatDate, todayISO } from "@/lib/format";
import type { Business, BusinessDocKind, CaseSummary, TeamMember } from "@/types/api";

type Form = {
  name: string; udyam_no: string; size: string; activity: string; udyam_registered: string; udyam_reg_date: string;
  description: string; phone: string; email: string; address: string; website: string; gstin: string; pan: string; established_year: string;
};
const toForm = (b: Partial<Business>): Form => ({
  name: b.name ?? "", udyam_no: b.udyam_no ?? "", size: b.size ?? "", activity: b.activity ?? "",
  udyam_registered: b.udyam_registered === null || b.udyam_registered === undefined ? "" : String(b.udyam_registered),
  udyam_reg_date: b.udyam_reg_date ?? "", description: b.description ?? "", phone: b.phone ?? "", email: b.email ?? "",
  address: b.address ?? "", website: b.website ?? "", gstin: b.gstin ?? "", pan: b.pan ?? "",
  established_year: b.established_year ? String(b.established_year) : "",
});
const SIZE: Record<string, string> = { micro: "Micro enterprise", small: "Small enterprise", medium: "Medium enterprise" };
const ACT: Record<string, string> = { manufacturing: "Manufacturing", services: "Services", trader: "Trading (retail or wholesale)" };
const DOCS: { kind: BusinessDocKind; label: string }[] = [
  { kind: "udyam_certificate", label: "Udyam registration certificate" },
  { kind: "gst_certificate", label: "GST registration certificate" },
  { kind: "pan_card", label: "PAN card" },
  { kind: "address_proof", label: "Business address proof" },
  { kind: "bank_details", label: "Bank account details (cancelled cheque)" },
];
const DOC_STATUS = { have: { label: "On file", tone: "green" }, missing: { label: "Missing", tone: "red" }, unknown: { label: "Not sure", tone: "slate" } } as const;

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
  const [newProduct, setNewProduct] = useState("");
  const [memberOpen, setMemberOpen] = useState(false);

  const load = () => {
    api.getBusiness().then((b) => { setBiz(b); setForm(toForm(b)); })
      .catch((e) => { if (e instanceof ApiError && e.status === 404) { setForm(toForm({})); setEditing(true); } else setLoadError(e.message); });
    api.listCases().then(setCases).catch(() => setCases([]));
  };
  useEffect(load, []);

  if (loadError) return <ErrorState message={loadError} />;
  if (!form) return <LoadingState />;
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  /** Save part of the profile. The backend updates only the fields sent. */
  async function saveSection(patch: Partial<Business>, message: string) {
    if (!biz) return;
    try {
      const b = await api.saveBusiness({ name: biz.name, ...patch });
      setBiz(b); setForm(toForm(b)); setToast(message);
    } catch (e) {
      setToast(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    }
  }

  const products = biz?.products ?? [];
  const team = biz?.team ?? [];
  const docs = biz?.documents ?? {};
  const checklist = [
    { label: "Basic business details", ok: !!(biz?.name && biz.size && biz.activity) },
    { label: "Udyam registration", ok: !!(biz?.udyam_registered && biz.udyam_no && biz.udyam_reg_date) },
    { label: "GSTIN", ok: !!biz?.gstin },
    { label: "Contact details", ok: !!((biz?.phone || biz?.email) && biz?.address) },
    { label: "Products or services", ok: products.length > 0 },
    { label: "Udyam certificate on file", ok: docs.udyam_certificate === "have" },
  ];
  const pct = Math.round((checklist.filter((c) => c.ok).length / checklist.length) * 100);
  const r = 40, circ = 2 * Math.PI * r;

  async function save() {
    setError(null);
    const f = form!;
    if (!f.name.trim()) return setError({ message: "Enter your business name.", field: "name" });
    if (f.established_year && !/^(19|20)\d{2}$/.test(f.established_year)) return setError({ message: "Enter a year like 2016.", field: "established_year" });
    setBusy(true);
    try {
      const b = await api.saveBusiness({
        name: f.name.trim(), udyam_no: f.udyam_no || null,
        size: (f.size || null) as Business["size"], activity: (f.activity || null) as Business["activity"],
        udyam_registered: f.udyam_registered === "" ? null : f.udyam_registered === "true",
        udyam_reg_date: f.udyam_reg_date || null,
        description: f.description.trim() || null, phone: f.phone.trim() || null, email: f.email.trim() || null,
        address: f.address.trim() || null, website: f.website.trim() || null, gstin: f.gstin.trim() || null,
        pan: f.pan.trim() || null, established_year: f.established_year ? Number(f.established_year) : null,
      });
      setBiz(b); setForm(toForm(b)); setEditing(false); setToast("Profile saved. Eligibility re-checked on every case.");
      api.listCases().then(setCases).catch(() => {});
    } catch (e) {
      setError(e instanceof ApiError ? { message: e.message, field: e.field } : { message: "Something went wrong." });
    } finally { setBusy(false); }
  }
  const fe = (f: string) => (error?.field === f ? error.message : undefined);
  const input = (k: keyof Form, id: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={id} value={form[k]} onChange={set(k)} className={inputClass} aria-invalid={!!fe(k) || undefined} {...extra} />
  );

  const addProduct = () => {
    const p = newProduct.trim();
    if (!p) return;
    if (p.length > 60) return setToast("Keep each product or service under 60 characters.");
    setNewProduct("");
    saveSection({ products: [...products, p] }, "Product added");
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Business profile</h1>
          <p className="mt-1 text-slate-600">Your details, registrations, team and documents. Udyam details decide whether the MSMED Act protects you.</p>
        </div>
        {!editing && <Button variant="primary" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden /> Edit profile</Button>}
      </div>

      {editing && (
        <Card title={biz ? "Edit profile" : "Set up your business"}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Business and eligibility</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Business name" htmlFor="s-name" error={fe("name")}>{input("name", "s-name")}</Field>
            <Field label="Enterprise size" htmlFor="s-size"><select id="s-size" value={form.size} onChange={set("size")} className={inputClass}><option value="">Not sure</option><option value="micro">Micro</option><option value="small">Small</option><option value="medium">Medium</option></select></Field>
            <Field label="Main activity" htmlFor="s-act"><select id="s-act" value={form.activity} onChange={set("activity")} className={inputClass}><option value="">Not sure</option><option value="manufacturing">Manufacturing</option><option value="services">Services</option><option value="trader">Trading (retail or wholesale)</option></select></Field>
            <Field label="Udyam registered?" htmlFor="s-reg"><select id="s-reg" value={form.udyam_registered} onChange={set("udyam_registered")} className={inputClass}><option value="">Not sure</option><option value="true">Yes</option><option value="false">No</option></select></Field>
            <Field label="Udyam number" htmlFor="s-udyam" error={fe("udyam_no")} hint="Like UDYAM-KR-00-0000000. Format only; not looked up.">{input("udyam_no", "s-udyam")}</Field>
            <Field label="Udyam registration date" htmlFor="s-regdate" error={fe("udyam_reg_date")}>{input("udyam_reg_date", "s-regdate", { type: "date", max: todayISO() })}</Field>
            <Field label="GSTIN (optional)" htmlFor="s-gstin" error={fe("gstin")} hint="Format and check digit only.">{input("gstin", "s-gstin", { placeholder: "29ABCDE1234F1ZW" })}</Field>
            <Field label="PAN (optional)" htmlFor="s-pan" error={fe("pan")}>{input("pan", "s-pan", { placeholder: "ABCDE1234F" })}</Field>
            <Field label="Year established (optional)" htmlFor="s-year" error={fe("established_year")}>{input("established_year", "s-year", { inputMode: "numeric" })}</Field>
          </div>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-700">Contact details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="s-phone" error={fe("phone")}>{input("phone", "s-phone", { type: "tel" })}</Field>
            <Field label="Email" htmlFor="s-email" error={fe("email")}>{input("email", "s-email", { type: "email" })}</Field>
            <Field label="Business address" htmlFor="s-addr" error={fe("address")}>{input("address", "s-addr")}</Field>
            <Field label="Website (optional)" htmlFor="s-web" error={fe("website")}>{input("website", "s-web")}</Field>
            <div className="sm:col-span-2"><Field label="What you make or do (optional)" htmlFor="s-desc" error={fe("description")}>
              <textarea id="s-desc" value={form.description} onChange={set("description")} maxLength={500} rows={2} className={inputClass} /></Field></div>
          </div>
          {error && !error.field && <div className="mt-3"><ErrorState message={error.message} /></div>}
          {error?.field && !(error.field in form) && <p role="alert" className="mt-3 text-sm text-red-700">{error.message}</p>}
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button>
            {biz && <Button onClick={() => { setForm(toForm(biz)); setEditing(false); setError(null); }}>Cancel</Button>}
          </div>
        </Card>
      )}

      {biz && (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="grid gap-6 rounded-xl border border-slate-200 bg-white p-6 lg:grid-cols-2">
              <div className="flex items-start gap-4">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-navy-800 text-white"><Building2 size={28} aria-hidden /></span>
                <div className="min-w-0">
                  <h2 className="text-2xl font-bold">{biz.name}</h2>
                  <p className="text-slate-600">{[biz.size && SIZE[biz.size], biz.activity && ACT[biz.activity]].filter(Boolean).join(" · ") || "Size and activity not set"}</p>
                  {biz.description && <p className="mt-2 text-sm text-slate-700">{biz.description}</p>}
                  <p className="mt-2 text-sm text-slate-500">Owner: {owner}{biz.established_year ? ` · Established ${biz.established_year}` : ""}</p>
                </div>
              </div>
              <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm lg:border-l lg:border-slate-200 lg:pl-6">
                <dt className="text-slate-500">Udyam number</dt>
                <dd className="min-w-0 break-words">{biz.udyam_no ?? "Not added"}</dd>
                <dt className="text-slate-500">Udyam registered</dt><dd>{biz.udyam_registered === null ? "Not sure" : biz.udyam_registered ? `Yes, on ${formatDate(biz.udyam_reg_date)}` : "No"}</dd>
                <dt className="text-slate-500">GSTIN</dt><dd className="break-words">{biz.gstin ?? "Not added"}</dd>
                <dt className="text-slate-500">PAN</dt><dd>{biz.pan ?? "Not added"}</dd>
              </dl>
            </section>
            <Card title="Contact information">
              <ul className="space-y-3 text-sm">
                <li className="flex gap-3"><Phone size={18} className="mt-0.5 shrink-0 text-slate-500" aria-hidden /><span><span className="sr-only">Phone: </span>{biz.phone ?? "Phone not added"}</span></li>
                <li className="flex gap-3"><Mail size={18} className="mt-0.5 shrink-0 text-slate-500" aria-hidden /><span className="min-w-0 break-words"><span className="sr-only">Email: </span>{biz.email ?? "Email not added"}</span></li>
                <li className="flex gap-3"><MapPin size={18} className="mt-0.5 shrink-0 text-slate-500" aria-hidden /><span><span className="sr-only">Address: </span>{biz.address ?? "Address not added"}</span></li>
                <li className="flex gap-3"><Globe size={18} className="mt-0.5 shrink-0 text-slate-500" aria-hidden /><span className="min-w-0 break-words"><span className="sr-only">Website: </span>{biz.website ?? "No website"}</span></li>
              </ul>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card title={<span className="flex items-center gap-2"><ShieldCheck size={20} className="text-brand-600" aria-hidden /> Registration status</span>}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Udyam registration", ok: !!biz.udyam_no, what: "Number", doc: docs.udyam_certificate },
                  { label: "GST registration", ok: !!biz.gstin, what: "Number", doc: docs.gst_certificate },
                  { label: "PAN", ok: !!biz.pan, what: "Number", doc: docs.pan_card },
                  { label: "Address proof", ok: !!biz.address, what: "Address", doc: docs.address_proof },
                ].map((x) => (
                  <div key={x.label} className="rounded-xl border border-slate-200 p-3">
                    <p className="font-semibold">{x.label}</p>
                    <p className="mt-1 text-sm text-slate-600">{x.ok ? `${x.what} added` : `${x.what} not added`}</p>
                    <div className="mt-2"><Badge tone={x.doc ? DOC_STATUS[x.doc].tone : "slate"}>{x.doc ? `Document ${DOC_STATUS[x.doc].label.toLowerCase()}` : "Document not marked"}</Badge></div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-600">Numbers are format-checked only. This app does not confirm them with government systems, so nothing here is marked &ldquo;verified&rdquo;.</p>
            </Card>
            <Card title="Profile completeness">
              <div className="flex items-center gap-5">
                <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0 -rotate-90" role="img" aria-label={`Profile ${pct}% complete`}>
                  <circle cx="50" cy="50" r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
                  <circle cx="50" cy="50" r={r} fill="none" stroke="#1a56db" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(pct / 100) * circ} ${circ}`} />
                  <text x="50" y="50" textAnchor="middle" dominantBaseline="central" transform="rotate(90 50 50)" className="fill-navy-900 text-[20px] font-bold">{pct}%</text>
                </svg>
                <ul className="space-y-1.5 text-sm">{checklist.map((c) => (
                  <li key={c.label} className="flex items-center gap-2">{c.ok ? <CircleCheck size={16} className="shrink-0 text-emerald-600" aria-hidden /> : <Circle size={16} className="shrink-0 text-slate-400" aria-hidden />}
                    <span>{c.label}</span><span className="sr-only">{c.ok ? "done" : "missing"}</span></li>))}
                </ul>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title={<span className="flex items-center gap-2"><Package size={20} className="text-brand-600" aria-hidden /> Products and services</span>}>
              <ul className="flex flex-wrap gap-2">
                {products.length === 0 && <li className="text-sm text-slate-600">None added yet.</li>}
                {products.map((p) => (
                  <li key={p} className="flex items-center gap-1 rounded-lg bg-slate-100 py-1.5 pl-3 pr-1.5 text-sm">
                    {p}
                    <button type="button" aria-label={`Remove ${p}`} onClick={() => saveSection({ products: products.filter((x) => x !== p) }, "Removed")}
                      className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-red-700"><X size={14} aria-hidden /></button>
                  </li>
                ))}
              </ul>
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addProduct(); }}>
                <label htmlFor="new-product" className="sr-only">Add a product or service</label>
                <input id="new-product" value={newProduct} onChange={(e) => setNewProduct(e.target.value)} maxLength={60} placeholder="e.g. Printed cartons" className={`${inputClass} w-auto! min-w-0 flex-1`} />
                <Button type="submit" disabled={!newProduct.trim() || products.length >= 20}><Plus size={16} aria-hidden /> Add</Button>
              </form>
            </Card>

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
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title={<span className="flex items-center gap-2"><Users size={20} className="text-brand-600" aria-hidden /> Team members</span>}
              action={<Button onClick={() => setMemberOpen(true)} disabled={team.length >= 10} className="whitespace-nowrap py-1.5"><UserPlus size={16} aria-hidden /> Add member</Button>}>
              {team.length === 0 ? <p className="text-sm text-slate-600">No one listed yet.</p> : (
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <caption className="sr-only">Team members</caption>
                    <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                      <th scope="col" className="py-2 pl-3 text-left font-semibold">Name</th><th scope="col" className="text-left font-semibold">Role</th>
                      <th scope="col" className="text-left font-semibold">Email</th><th scope="col"><span className="sr-only">Remove</span></th>
                    </tr></thead>
                    <tbody>{team.map((m, i) => (
                      <tr key={`${m.name}-${i}`} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pl-3 font-medium">{m.name}</td>
                        <td><Badge tone="blue">{m.role}</Badge></td>
                        <td className="break-all text-slate-600">{m.email ?? "—"}</td>
                        <td className="text-right"><button type="button" aria-label={`Remove ${m.name}`} onClick={() => saveSection({ team: team.filter((_, j) => j !== i) }, "Member removed")}
                          className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 size={16} aria-hidden /></button></td>
                      </tr>))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-xs text-slate-600">Listed for reference only. Team sign-in and invitations are not built yet, so listing someone gives them no access.</p>
            </Card>

            <Card title={<span className="flex items-center gap-2"><FileText size={20} className="text-brand-600" aria-hidden /> Business documents</span>}>
              <ul className="divide-y divide-slate-100">
                {DOCS.map(({ kind, label }) => (
                  <li key={kind} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span>{label}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={DOC_STATUS[docs[kind] ?? "unknown"].tone}>{DOC_STATUS[docs[kind] ?? "unknown"].label}</Badge>
                      <label htmlFor={`doc-${kind}`} className="sr-only">Status of {label}</label>
                      <select id={`doc-${kind}`} value={docs[kind] ?? "unknown"} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                        onChange={(e) => saveSection({ documents: { ...docs, [kind]: e.target.value as "have" | "missing" | "unknown" } }, "Document status saved")}>
                        <option value="have">On file</option><option value="missing">Missing</option><option value="unknown">Not sure</option>
                      </select>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-600">Mark what you hold. File upload isn&apos;t available in this build; keep the originals safe for a Facilitation Council reference.</p>
            </Card>
          </div>
        </>
      )}
      <Notice tone="blue">Covered: micro and small enterprises with Udyam Registration in manufacturing or services. Not covered: medium enterprises and retail or wholesale traders. Registering after the order date is legally unsettled.</Notice>
      {memberOpen && <AddMember onClose={() => setMemberOpen(false)} onAdd={(m) => { setMemberOpen(false); saveSection({ team: [...team, m] }, "Member added"); }} />}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function AddMember({ onClose, onAdd }: { onClose: () => void; onAdd: (m: TeamMember) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("Accounts");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!name.trim()) return setError("Enter their name.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError("Enter a valid email or leave it empty.");
    onAdd({ name: name.trim(), role, email: email.trim() || null });
  };
  return (
    <Dialog title="Add a team member" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Add member</Button></>}>
      <div className="space-y-4">
        <Field label="Name" htmlFor="m-name"><input id="m-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={inputClass} /></Field>
        <Field label="Role" htmlFor="m-role"><select id="m-role" value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
          {["Owner", "Partner", "Accounts", "Sales", "Manager", "View only"].map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Email (optional)" htmlFor="m-email"><input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} /></Field>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <p className="text-xs text-slate-600">They won&apos;t get access or an email; this only records who works with you.</p>
      </div>
    </Dialog>
  );
}
