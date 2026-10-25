// Types mirror the FastAPI responses exactly. Money is always a string ("180000.00").

export type Money = string;
export type ISODate = string;

export type Bucket = "not_due" | "due_soon" | "overdue" | "overdue_interest_accruing";
export type Verdict = "eligible" | "not_eligible" | "uncertain";
export type EvidenceKind =
  | "po" | "invoice" | "delivery_proof" | "acceptance_reply"
  | "ledger" | "communications" | "udyam_cert";
export type EvidenceStatus = "have" | "missing" | "unknown";
export type DraftKind =
  | "acceptance_confirm"
  | "nudge"
  | "firm"
  | "demand"
  | "fix_blocker_po"
  | "fix_blocker_grn"
  | "fix_blocker_amount"
  | "resolve_dispute"
  | "fix_blocker";

export type BlockerReason =
  | "po_missing"
  | "grn_not_entered"
  | "amount_mismatch"
  | "quality_dispute"
  | "waiting_approval"
  | "other";

export type BlockerSource = "buyer_said" | "documented" | "not_verified";

export interface PaymentBlocker {
  id: string;
  case_id: string;
  invoice_id: string | null;
  reason: BlockerReason;
  source: BlockerSource;
  disputed_amount: Money | null;
  note: string | null;
  reported_on: ISODate;
  resolved_on: ISODate | null;
  created_at?: string;
}

export interface Totals { principal: Money; interest: Money; total: Money }

export interface CaseSummary {
  id: string;
  business_id: string;
  buyer_id: string;
  buyer_name: string | null;
  contract_date: ISODate | null;
  status: "draft" | "active" | "settled" | "archived";
  ladder_step: number;
  allocation: "interest_first" | "principal_first";
  po_amount: Money | null;
  dispute_reason: "none" | "quality" | "quantity" | "other";
  totals: Totals | null;
  bucket: Bucket | null;
  eligibility: Verdict | null;
  next_action?: NextAction | null;
}

export interface Buyer {
  id: string;
  name: string;
  gstin: string | null;
  is_cpse: boolean;
  relationship_importance: "low" | "medium" | "high" | null;
}

export interface Payment { id: string; invoice_id: string; paid_on: ISODate; amount: Money }

export interface Invoice {
  id: string;
  case_id: string;
  number: string;
  invoice_date: ISODate;
  amount: Money;
  delivery_date: ISODate | null;
  agreed_due_date: ISODate | null;
  objection_date: ISODate | null;
  objection_removed_date: ISODate | null;
  /** Part of the invoice the buyer objected to in writing; null = whole invoice (if objected). */
  disputed_amount?: Money | null;
  payments: Payment[];
}

export interface EvidenceItem { id: string; case_id: string; kind: EvidenceKind; status: EvidenceStatus }

export interface CaseDetail extends Omit<CaseSummary, "buyer_name" | "totals" | "bucket" | "eligibility" | "next_action"> {
  buyer: Buyer;
  invoices: Invoice[];
  evidence: EvidenceItem[];
}

export interface ScheduleRow {
  period_start: ISODate;
  period_end: ISODate;
  opening_balance: Money;
  interest: Money;
  payments: Money;
  closing_principal: Money;
  closing_interest: Money;
  rates_pct: string[];
}

export interface DueResult {
  acceptance_status: "deemed" | "objection_removed" | "disputed";
  acceptance_date: ISODate | null;
  last_day_to_pay: ISODate | null;
  interest_start: ISODate | null;
  basis: string;
  rule_ids: string[];
  warnings: string[];
}

export interface InterestResult {
  as_of: ISODate;
  principal_outstanding: Money;
  interest_outstanding: Money;
  total_outstanding: Money;
  interest_accrued_total: Money;
  schedule: ScheduleRow[];
  allocation: string;
  assumptions: string[];
  warnings: string[];
}

export type InvoiceStatus =
  | "computed" | "disputed" | "partly_disputed" | "missing_inputs" | "rate_unavailable"
  | "not_eligible" | "eligibility_uncertain";

export interface EvaluatedInvoice {
  invoice_id: string;
  number: string;
  amount: Money;
  status: InvoiceStatus;
  principal_outstanding: Money;
  due: DueResult | null;
  interest: InterestResult | null;
  message?: string;
  /** Only when status is "partly_disputed". */
  disputed_amount?: Money;
  disputed_outstanding?: Money;
  undisputed_outstanding?: Money;
}

export interface Finding {
  id: string;
  severity: "blocking" | "warning" | "info";
  message: string;
  fix: string;
  sources: string[];
}

export interface Readiness { odr_ready: boolean; have: EvidenceKind[]; missing: EvidenceKind[]; score: string }

export interface PromiseStatus {
  promise_id: string;
  made_on: ISODate;
  due_date: ISODate;
  amount: Money;
  received: Money;
  status: "kept" | "kept_late" | "part_kept" | "broken" | "pending";
  settled_on: ISODate | null;
  source_text: string | null;
}

export interface Followup {
  id: string;
  case_id: string;
  step: 1 | 2 | 3;
  sent_on: ISODate;
  reply_received: boolean;
  note: string | null;
}

export interface NextAction {
  action: string;
  label: string;
  ladder_step: number | null;
  draft_kind: DraftKind | null;
  reasons: string[];
  based_on: string[];
  alternatives: { action: string; label: string; tradeoff: string }[];
  caution: string | null;
  rule: string;
}

export interface Evaluation {
  calculation_id: string;
  case_id: string;
  as_of: ISODate;
  engine_version: string;
  eligibility: { verdict: Verdict; reasons: string[]; rule_ids: string[]; still_available: string[] };
  invoices: EvaluatedInvoice[];
  totals: Totals;
  bucket: Bucket;
  allocation: "interest_first" | "principal_first";
  next_action: NextAction;
  findings: Finding[];
  readiness: Readiness;
  promises: PromiseStatus[];
  followups: Followup[];
  blockers?: PaymentBlocker[];
}

export interface SettlementOption {
  label: string;
  interest_waived_pct: number;
  amount_requested: Money;
  amount_forgone: Money;
  pct_of_full_claim: string;
}

export interface PromiseCandidate {
  amount: Money | null;
  due_date: ISODate | null;
  amount_text: string | null;
  date_text: string | null;
  made_on: ISODate;
  source_text: string;
  missing: ("amount" | "due_date")[];
  extractor: string;
}

export interface Draft {
  id: string;
  kind: DraftKind;
  lang: string;
  body: string;
  caution: string | null;
  generated_by: string;
  calculation_id: string;
}

export interface Business {
  id: string;
  name: string;
  phone: string | null;
  udyam_no: string | null;
  size: "micro" | "small" | "medium" | null;
  activity: "manufacturing" | "services" | "trader" | null;
  udyam_registered: boolean | null;
  udyam_reg_date: ISODate | null;
  description?: string | null;
  email?: string | null;
  address?: string | null;
  website?: string | null;
  gstin?: string | null;
  pan?: string | null;
  established_year?: number | null;
  products?: string[];
  team?: TeamMember[];
  documents?: Partial<Record<BusinessDocKind, "have" | "missing" | "unknown">>;
}

/** Listed on the profile for reference only; listing someone gives them no access. */
export interface TeamMember { name: string; role: string; email?: string | null }
export type BusinessDocKind = "udyam_certificate" | "gst_certificate" | "pan_card" | "address_proof" | "bank_details";

export interface Milestone {
  id: string;
  case_id: string;
  title: string;
  due_date: ISODate;
  amount: Money;
  invoice_id: string | null;
}

export interface InvoiceNote { id: string; invoice_id: string; body: string; created_at: string }

export type PayStatus = "paid" | "overdue" | "due_soon" | "not_due" | "disputed" | "missing_dates";

export interface InvoiceRow {
  id: string;
  number: string;
  case_id: string;
  buyer_id: string;
  buyer_name: string | null;
  invoice_date: ISODate;
  amount: Money;
  paid: Money;
  unpaid: Money;
  delivery_date: ISODate | null;
  agreed_due_date: ISODate | null;
  last_day_to_pay: ISODate | null;
  engine_status: InvoiceStatus;
  estimated_interest: Money | null;
  statutory_total: Money | null;
  payments: Payment[];
  status: PayStatus;
  partially_paid: boolean;
  days_overdue: number;
  days_left: number | null;
}

export interface InvoiceDetail extends Invoice {
  buyer: Buyer;
  case: { id: string; contract_date: ISODate | null; po_amount: Money | null; status: string; dispute_reason: string };
}

export interface CalcResult {
  due: DueResult;
  interest: InterestResult | null;
  status: "computed" | "disputed" | "rate_unavailable";
  message: string | null;
}

export interface RateRow {
  effective_from: ISODate;
  bank_rate_pct: string;
  statutory_rate_pct: string;
  source: string;
  note: string;
}

/** AI legal Q&A. "unavailable": no key, a failed check or an error; use the prepared answers. */
export interface LegalAnswer {
  source: "ai" | "out_of_scope" | "unavailable";
  answer: string;
  citations: { id: string; label: string; title: string }[];
  model: string | null;
}

export interface DocumentCheck {
  source: "ai" | "unavailable";
  document_type: string | null;
  document_label: string | null;
  fields: { name: string; value: string; source_text: string }[];
  dropped: string[];
  findings: { check: string; status: "match" | "mismatch" | "not_on_document" | "not_comparable" | "warning"; detail: string }[];
  verdict: "looks_right" | "check_this" | "wrong_document" | "unreadable" | null;
  evidence_kind: EvidenceKind | null;
  notes: string;
  case_id: string | null;
}


export interface BuyerInvoice {
  id: string;
  number: string;
  case_id: string;
  supplier_name: string;
  supplier_id: string;
  invoice_date: ISODate;
  amount: Money;
  paid: Money;
  unpaid: Money;
  delivery_date: ISODate | null;
  agreed_due_date: ISODate | null;
  last_day_to_pay: ISODate | null;
  days_overdue: number;
  estimated_interest: Money;
  statutory_total: Money;
  status: "paid" | "overdue" | "due_soon" | "not_due";
  section_43bh_deadline: ISODate | null;
  tax_deduction_risk: boolean;
}

export interface AdviserProfile {
  id: string;
  full_name: string;
  email: string;
  professional_role: string;
  qualifications: string;
}

export interface CaseShare {
  id: string;
  case_id: string;
  adviser_id: string;
  adviser_name: string;
  adviser_email: string;
  shared_at?: string;
}

export interface AdviserCase {
  case_id: string;
  contract_date: ISODate | null;
  supplier_name: string;
  buyer_name: string;
  unpaid: Money;
  estimated_interest: Money;
  total_outstanding: Money;
  max_days_overdue: number;
  eligibility: Verdict;
  next_action: NextAction;
  readiness: Readiness;
  findings: Finding[];
  status: string;
}
