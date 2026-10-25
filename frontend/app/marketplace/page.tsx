"use client";

import { Bookmark, BookmarkCheck, Building2, CalendarDays, CircleAlert, CircleCheck, Factory, Info, MapPin, Search, Send, Store, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, EmptyState, inputClass, Toast } from "@/components/ui";
import { formatDate, formatINR, todayISO } from "@/lib/format";

// Fictional sample data. The marketplace is a preview: nothing here is a real company or order.
interface Opp {
  id: string; buyer: string; title: string; industry: string; location: string; value: number;
  orderType: string; closesInDays: number; paymentDays: number; summary: string; requirements: [string, string][];
}
const OPPS: Opp[] = [
  { id: "o1", buyer: "Vindhya Heavy Equipment Ltd", title: "Precision machined shafts", industry: "Machine components", location: "Coimbatore, Tamil Nadu",
    value: 4800000, orderType: "Long term (12 months)", closesInDays: 12, paymentDays: 30, summary: "CNC-machined shafts for conveyor assemblies, monthly call-offs.",
    requirements: [["Quantity", "2,000 to 5,000 units a month"], ["Quality", "ISO 9001 preferred"], ["Delivery", "Coimbatore plant"], ["Payment terms", "30 days from delivery"]] },
  { id: "o2", buyer: "Konkan Fresh Foods Pvt Ltd", title: "Food-grade corrugated cartons", industry: "Packaging", location: "Pune, Maharashtra",
    value: 1150000, orderType: "One-time order", closesInDays: 6, paymentDays: 60, summary: "Five-ply cartons with food-grade inner coating for a festive season run.",
    requirements: [["Quantity", "40,000 cartons"], ["Compliance", "FSSAI-compliant materials"], ["Delivery", "Pune warehouse"], ["Payment terms", "60 days from invoice"]] },
  { id: "o3", buyer: "Sahyadri Auto Systems Ltd", title: "Sheet metal brackets", industry: "Automotive parts", location: "Chakan, Maharashtra",
    value: 2400000, orderType: "Long term (6 months)", closesInDays: 20, paymentDays: 45, summary: "Laser-cut and bent brackets for two-wheeler sub-assemblies.",
    requirements: [["Quantity", "15,000 units a month"], ["Tolerances", "As per drawing"], ["Delivery", "Chakan line-side"], ["Payment terms", "45 days from acceptance"]] },
  { id: "o4", buyer: "Godavari Power Panels Pvt Ltd", title: "Electrical enclosures", industry: "Electrical", location: "Hyderabad, Telangana",
    value: 1750000, orderType: "Long term (12 months)", closesInDays: 15, paymentDays: 90, summary: "Powder-coated MS enclosures for distribution panels.",
    requirements: [["Quantity", "300 enclosures a month"], ["Finish", "Powder coat, RAL 7035"], ["Delivery", "Hyderabad"], ["Payment terms", "90 days from invoice"]] },
  { id: "o5", buyer: "Malabar Spice Exports LLP", title: "Printed laminated pouches", industry: "Packaging", location: "Kochi, Kerala",
    value: 640000, orderType: "One-time order", closesInDays: 9, paymentDays: 15, summary: "Multi-layer printed pouches for 100 g and 250 g spice packs.",
    requirements: [["Quantity", "2 lakh pouches"], ["Print", "8 colour gravure"], ["Delivery", "Kochi"], ["Payment terms", "15 days from delivery"]] },
  { id: "o6", buyer: "Sabarmati Process Controls Ltd", title: "Stainless steel valve manifolds", industry: "Machine components", location: "Ahmedabad, Gujarat",
    value: 3100000, orderType: "Long term (6 months)", closesInDays: 14, paymentDays: 30, summary: "SS316 machined valve blocks for chemical dosing skids.",
    requirements: [["Quantity", "450 manifolds a month"], ["Material", "SS316 with mill test certificate"], ["Delivery", "Vatva GIDC, Ahmedabad"], ["Payment terms", "30 days from acceptance"]] },
];
const SUPPLIERS = [
  { name: "Tunga Precision Works", industry: "Machine components", location: "Shivamogga, Karnataka", size: "Micro" },
  { name: "Hemavathi Corrugators", industry: "Packaging", location: "Mysuru, Karnataka", size: "Small" },
  { name: "Narmada Fab Tech", industry: "Electrical", location: "Indore, Madhya Pradesh", size: "Small" },
  { name: "Peenya Eco Pack Solutions", industry: "Packaging", location: "Bengaluru, Karnataka", size: "Micro" },
  { name: "Kovai Gear & Shafts", industry: "Automotive parts", location: "Coimbatore, Tamil Nadu", size: "Small" },
  { name: "Deccan Switchgear Enclosures", industry: "Electrical", location: "Hyderabad, Telangana", size: "Small" },
  { name: "Bhosari Sheet Metal Stampings", industry: "Automotive parts", location: "Pune, Maharashtra", size: "Micro" },
  { name: "GIDC Machined Fasteners", industry: "Machine components", location: "Rajkot, Gujarat", size: "Micro" },
];
const SAVED_KEY = "ls03.savedOpps";

function termsCheck(days: number) {
  return days > 45
    ? { tone: "amber" as const, icon: <CircleAlert size={12} aria-hidden />, label: `${days}-day terms: above the 45-day legal limit`, note: `For micro and small suppliers, an agreed period can't exceed 45 days from acceptance (MSMED Act s.15). Payment after 45 days still carries interest at 3× the Bank Rate. Negotiate terms of 45 days or less in writing.` }
    : { tone: "green" as const, icon: <CircleCheck size={12} aria-hidden />, label: `${days}-day terms: within the legal limit`, note: "Within the 45-day limit for micro and small suppliers. Get the terms in writing on the purchase order." };
}

export default function MarketplacePage() {
  const [tab, setTab] = useState<"opps" | "suppliers" | "saved">("opps");
  const [q, setQ] = useState("");
  const [industry, setIndustry] = useState("all");
  const [sort, setSort] = useState("closing");
  const [sel, setSel] = useState<string | null>("o1");
  const [saved, setSaved] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { try { setSaved(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]")); } catch { setSaved([]); } }, []);
  const toggleSave = (id: string) => {
    const next = saved.includes(id) ? saved.filter((x) => x !== id) : [...saved, id];
    setSaved(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setToast(saved.includes(id) ? "Removed from saved" : "Saved in this browser");
  };
  const today = todayISO();
  const closeDate = (n: number) => new Date(Date.parse(today) + n * 864e5).toISOString().slice(0, 10);
  const industries = [...new Set(OPPS.map((o) => o.industry))];
  const list = useMemo(() => OPPS
    .filter((o) => tab !== "saved" || saved.includes(o.id))
    .filter((o) => industry === "all" || o.industry === industry)
    .filter((o) => { const s = q.trim().toLowerCase(); return !s || `${o.title} ${o.buyer} ${o.industry} ${o.location}`.toLowerCase().includes(s); })
    .sort((a, b) => (sort === "value" ? b.value - a.value : a.closesInDays - b.closesInDays)), [tab, saved, industry, q, sort]);
  const opp = OPPS.find((o) => o.id === sel) ?? null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><Store size={28} className="text-brand-600" aria-hidden /> Supplier and buyer marketplace</h1>
        <p className="mt-1 text-slate-600">Find new orders, and check payment terms before you accept them.</p>
      </div>
      <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
        Preview: the marketplace is not live. Every listing below is a fictional sample, and nothing you do here is sent to anyone.
      </p>

      <div role="tablist" aria-label="Marketplace sections" className="flex flex-wrap gap-1 border-b border-slate-200">
        {([["opps", "Buyer opportunities"], ["suppliers", "Supplier directory"], ["saved", `Saved (${saved.length})`]] as const).map(([k, l]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx("-mb-px border-b-2 px-4 py-2.5 text-sm font-medium", tab === k ? "border-brand-600 text-brand-600" : "border-transparent text-slate-600")}>{l}</button>))}
      </div>

      {tab === "suppliers" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {SUPPLIERS.map((s) => (
            <Card key={s.name}>
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-blue-50 p-3 text-brand-600"><Factory size={22} aria-hidden /></span>
                <div><p className="font-semibold">{s.name}</p><p className="text-sm text-slate-600">{s.industry}</p>
                  <p className="mt-1 flex items-center gap-1 text-sm text-slate-600"><MapPin size={14} aria-hidden /> {s.location}</p>
                  <Badge tone="slate">{s.size} enterprise · sample</Badge></div>
              </div>
            </Card>))}
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card>
            <div className="mb-4 flex flex-wrap gap-3">
              <div className="relative min-w-56 flex-1">
                <label htmlFor="m-q" className="sr-only">Search opportunities</label>
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input id="m-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product, buyer or location" className={`${inputClass} pl-9`} />
              </div>
              <label htmlFor="m-ind" className="sr-only">Industry</label>
              <select id="m-ind" value={industry} onChange={(e) => setIndustry(e.target.value)} className={`${inputClass} w-48!`}>
                <option value="all">All industries</option>{industries.map((i) => <option key={i}>{i}</option>)}
              </select>
              <label htmlFor="m-sort" className="sr-only">Sort</label>
              <select id="m-sort" value={sort} onChange={(e) => setSort(e.target.value)} className={`${inputClass} w-44!`}>
                <option value="closing">Closing soonest</option><option value="value">Highest value</option>
              </select>
            </div>
            <p className="mb-3 text-sm font-semibold" aria-live="polite">{list.length} opportunit{list.length === 1 ? "y" : "ies"}</p>
            {list.length === 0 ? <EmptyState title={tab === "saved" ? "Nothing saved yet" : "No matches"} body={tab === "saved" ? "Save an opportunity to see it here." : "Try another search or industry."} /> : (
              <ul className="space-y-3">{list.map((o) => {
                const t = termsCheck(o.paymentDays);
                return (
                  <li key={o.id}>
                    <div className={cx("flex flex-wrap items-start gap-4 rounded-xl border p-4", sel === o.id ? "border-brand-600 bg-blue-50/40" : "border-slate-200")}>
                      <span className="rounded-xl bg-slate-100 p-3 text-slate-600"><Building2 size={22} aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-500">{o.buyer} · sample listing</p>
                        <p className="font-semibold">{o.title}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                          <Badge>{o.industry}</Badge><span className="flex items-center gap-1"><MapPin size={12} aria-hidden /> {o.location}</span>
                          <span className="flex items-center gap-1"><CalendarDays size={12} aria-hidden /> Open till {formatDate(closeDate(o.closesInDays))}</span>
                        </p>
                        <p className="mt-2 text-sm text-slate-700">{o.summary}</p>
                        <div className="mt-2"><Badge tone={t.tone} icon={t.icon}>{t.label}</Badge></div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">Estimated value</p><p className="text-lg font-bold text-brand-600">{formatINR(o.value)}</p>
                        <p className="text-xs text-slate-600">{o.orderType}</p>
                        <div className="mt-2 flex justify-end gap-2">
                          <Button className="py-1.5" aria-label={saved.includes(o.id) ? `Unsave ${o.title}` : `Save ${o.title}`} onClick={() => toggleSave(o.id)}>
                            {saved.includes(o.id) ? <BookmarkCheck size={16} className="text-brand-600" /> : <Bookmark size={16} />}
                          </Button>
                          <Button className="py-1.5" onClick={() => setSel(o.id)}>View details</Button>
                        </div>
                      </div>
                    </div>
                  </li>);
              })}</ul>
            )}
          </Card>

          {opp && (
            <Card>
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-xs text-slate-500">{opp.buyer} · sample listing</p><h2 className="text-xl font-bold">{opp.title}</h2><p className="text-sm text-slate-600">{opp.summary}</p></div>
                <button type="button" aria-label="Close details" onClick={() => setSel(null)} className="rounded p-1 hover:bg-slate-100"><X size={18} /></button>
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="primary" className="flex-1" onClick={() => setToast("Preview only: no interest was sent")}><Send size={16} aria-hidden /> Express interest</Button>
                <Button onClick={() => toggleSave(opp.id)}>{saved.includes(opp.id) ? "Saved" : "Save"}</Button>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-4 text-sm">
                <div><dt className="text-slate-500">Estimated value</dt><dd className="text-lg font-bold text-brand-600">{formatINR(opp.value)}</dd></div>
                <div><dt className="text-slate-500">Order type</dt><dd className="font-medium">{opp.orderType}</dd></div>
                <div><dt className="text-slate-500">Location</dt><dd className="font-medium">{opp.location}</dd></div>
                <div><dt className="text-slate-500">Open till</dt><dd className="font-medium">{formatDate(closeDate(opp.closesInDays))} <span className="text-red-600">({opp.closesInDays} days left)</span></dd></div>
              </dl>
              <h3 className="mt-5 font-bold">Requirements</h3>
              <dl className="mt-2 divide-y divide-slate-100 text-sm">{opp.requirements.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[130px_1fr] py-2"><dt className="text-slate-500">{k}</dt><dd>{v}</dd></div>))}
              </dl>
              <div className={cx("mt-5 rounded-xl border p-4 text-sm", termsCheck(opp.paymentDays).tone === "amber" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50")}>
                <p className="font-semibold">Payment terms check</p>
                <p className="mt-1">{termsCheck(opp.paymentDays).note}</p>
              </div>
            </Card>
          )}
        </div>
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

