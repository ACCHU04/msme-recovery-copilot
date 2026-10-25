import type { Bucket, EvidenceKind, Verdict } from "@/types/api";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats a backend money string exactly. Never re-computes; NaN-safe. */
export function formatINR(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? inr.format(n) : "—";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-02-20" -> "20 Feb 2026". Parses the ISO string directly (no timezone shift). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  not_due: "Not yet due",
  due_soon: "Due within 7 days",
  overdue: "Overdue",
  overdue_interest_accruing: "Overdue, interest accruing",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  eligible: "Eligible",
  not_eligible: "Not eligible",
  uncertain: "Needs confirmation",
};

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  po: "Purchase order",
  invoice: "Invoice copies",
  delivery_proof: "Delivery proof",
  acceptance_reply: "Buyer's acceptance reply",
  ledger: "Ledger extract",
  communications: "Emails and chats",
  udyam_cert: "Udyam certificate",
};

export const EVIDENCE_WHY: Record<EvidenceKind, string> = {
  po: "Shows what was ordered, at what price and on what date.",
  invoice: "The claim is made invoice by invoice.",
  delivery_proof: "The payment clock runs from delivery, so this date must be provable.",
  acceptance_reply: "Optional: written acceptance is stronger than the 15-day deemed rule.",
  ledger: "Shows what has and has not been paid.",
  communications: "Shows reminders sent and any dispute raised.",
  udyam_cert: "Proves you are a micro or small enterprise, and from when.",
};

/** Turns a reference like "invoice:INV-114.amount" or "evidence:po" into words. */
export function describeSource(ref: string): string {
  const [kind, rest = ""] = ref.split(":");
  if (kind === "evidence") return EVIDENCE_LABEL[rest as EvidenceKind] ?? rest;
  if (kind === "invoice") {
    const [num, field] = rest.split(".");
    return `${num} ${(field ?? "").replace(/_/g, " ")}`.trim();
  }
  if (kind === "case") return `Case ${rest.replace(/_/g, " ")}`.replace("contract date", "PO date").replace("po amount", "PO amount");
  if (kind === "business") return `Business ${rest.replace(/_/g, " ")}`;
  if (kind === "promise") return "Buyer's payment promise";
  if (kind === "followup") return `Follow-up sent ${formatDate(rest)}`;
  return ref;
}

/** Flags when total != principal + interest instead of silently fixing it. */
export function totalsConsistent(t: { principal: string; interest: string; total: string }): boolean {
  const cents = (s: string) => Math.round(Number(s) * 100);
  return cents(t.principal) + cents(t.interest) === cents(t.total);
}
