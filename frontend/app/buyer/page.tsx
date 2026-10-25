"use client";

import { BookOpenText, Calculator, Landmark, CalendarClock, FileWarning, Percent, ShoppingBag, Store } from "lucide-react";
import Link from "next/link";
import { Card, EmptyState, Notice } from "@/components/ui";
import { useViewer } from "@/lib/auth/viewer";

const DUTIES = [
  { icon: CalendarClock, title: "Pay on time (s.15)", body: "Pay a micro or small supplier by the date agreed in writing, never more than 45 days after you accept the goods or services. With no written agreement, the limit is 15 days." },
  { icon: Percent, title: "Interest if late (s.16)", body: "Late payments carry compound interest with monthly rests at three times the RBI Bank Rate, whatever the contract says." },
  { icon: FileWarning, title: "Disclose unpaid amounts (s.22)", body: "If you must have your accounts audited, show the principal and interest still unpaid to these suppliers in your annual accounts." },
  { icon: BookOpenText, title: "No tax deduction for that interest (s.23)", body: "Interest you pay under the Act cannot be deducted when working out your taxable income." },
  { icon: Landmark, title: "Late payment delays your expense deduction (Income-tax s.43B(h), now s.37(2)(g))", wide: true,
    body: "An amount you owe a micro or small supplier and pay after the Section 15 limit can be claimed as an expense only in the year you actually pay it. Section 43B(h) of the Income-tax Act, 1961 applies up to tax year 2025-26; from tax year 2026-27 the same rule is Section 37(2)(g) of the Income-tax Act, 2025. An unpaid bill at your year end can raise that year's taxable income." },
];

export default function BuyerDashboard() {
  const viewer = useViewer();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold"><ShoppingBag className="text-brand-600" aria-hidden /> Buyer dashboard</h1>
        <p className="text-slate-600">
          Welcome{viewer?.name ? `, ${viewer.name.split(" ")[0]}` : ""}{viewer?.businessName ? ` · ${viewer.businessName}` : ""}. Stay on the right side of the MSMED Act when you buy from micro and small suppliers.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {DUTIES.map(({ icon: Icon, title, body, wide }) => (
          <div key={title} className={`flex gap-4 rounded-xl border p-5 ${wide ? "border-amber-200 bg-amber-50 md:col-span-2" : "border-slate-200 bg-white"}`}>
            <span className="h-fit rounded-xl bg-blue-50 p-3 text-brand-600" aria-hidden><Icon size={22} /></span>
            <div><h2 className="font-bold">{title}</h2><p className="mt-1 text-sm text-slate-700">{body}</p></div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Invoices from your suppliers">
          <EmptyState title="Nothing linked to your account yet"
            body="Suppliers' invoices are not linked to buyer accounts yet, so nothing can be listed here. Once linking is built, invoices raised to your business will appear here with their due dates." />
        </Card>
        <Card title="Useful now">
          <div className="space-y-2">
            <Link href="/legal" className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <Calculator size={20} className="text-brand-600" aria-hidden />
              <span><span className="block font-semibold">Check an interest claim</span><span className="text-sm text-slate-600">Use the same calculator suppliers use</span></span>
            </Link>
            <Link href="/marketplace" className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <Store size={20} className="text-brand-600" aria-hidden />
              <span><span className="block font-semibold">Marketplace</span><span className="text-sm text-slate-600">Preview with sample listings</span></span>
            </Link>
          </div>
        </Card>
      </div>
      <Notice>A summary of the MSMED Act, 2006 and the related income-tax rule for guidance, not legal advice. The Act protects only micro and small enterprises registered on Udyam.</Notice>
    </div>
  );
}
