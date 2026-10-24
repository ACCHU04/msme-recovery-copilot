import { api } from "@/lib/api";
import type { CaseSummary, InvoiceRow } from "@/types/api";

/** A contract here is a recovery case's purchase order: one buyer, one order, its invoices. */
export interface ContractRow {
  c: CaseSummary;
  ref: string;
  invoices: InvoiceRow[];
  invoiced: number;
  paid: number;
  unpaid: number;
  poValue: number | null;
  overdueCount: number;
  maxDaysOverdue: number;
}

export const contractRef = (c: { id: string; contract_date: string | null }) =>
  `PO-${(c.contract_date ?? "").slice(0, 4) || "XXXX"}-${c.id.slice(0, 4).toUpperCase()}`;

const cents = (s: string) => Math.round(Number(s) * 100);

export async function loadContracts(): Promise<ContractRow[]> {
  const [cases, invoices] = await Promise.all([api.listCases(), api.listInvoices()]);
  return cases.filter((c) => c.status !== "archived").map((c) => {
    const inv = invoices.filter((r) => r.case_id === c.id);
    return {
      c,
      ref: contractRef(c),
      invoices: inv,
      invoiced: inv.reduce((s, r) => s + cents(r.amount), 0) / 100,
      paid: inv.reduce((s, r) => s + cents(r.paid), 0) / 100,
      unpaid: inv.reduce((s, r) => s + cents(r.unpaid), 0) / 100,
      poValue: c.po_amount ? Number(c.po_amount) : null,
      overdueCount: inv.filter((r) => r.status === "overdue").length,
      maxDaysOverdue: Math.max(0, ...inv.map((r) => r.days_overdue)),
    };
  });
}

export function contractStatus(r: ContractRow): { label: string; tone: "green" | "red" | "amber" | "blue" | "slate" | "violet" } {
  if ((r.c.dispute_reason ?? "none") !== "none" || r.invoices.some((i) => i.status === "disputed")) return { label: "Disputed", tone: "violet" };
  if (r.invoices.length === 0) return { label: "No invoices", tone: "slate" };
  if (r.unpaid === 0) return { label: "Fully paid", tone: "green" };
  if (r.overdueCount > 0) return { label: "Payment overdue", tone: "red" };
  return { label: "Active", tone: "blue" };
}

export function paymentTerms(inv: InvoiceRow[]): string {
  const agreed = inv.filter((i) => i.agreed_due_date && i.delivery_date)
    .map((i) => Math.round((Date.parse(i.agreed_due_date!) - Date.parse(i.delivery_date!)) / 864e5));
  if (agreed.length === 0) return "None agreed in writing (15 days from acceptance)";
  const max = Math.max(...agreed);
  return `${max} days agreed in writing${max > 45 ? " (capped at 45 by law)" : ""}`;
}
