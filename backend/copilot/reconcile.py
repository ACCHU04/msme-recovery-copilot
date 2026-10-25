"""Case reconciliation: deterministic checks of the facts against each other and the
evidence list. Every finding says what is wrong, which facts/documents it rests on,
and how to fix it. No AI.

Severity:
  blocking  - the case cannot be relied on (or filed) until this is fixed
  warning   - weakens the case; fix before escalating
  info      - worth knowing; no action needed now
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

ODR_REQUIRED = ("invoice", "po", "delivery_proof", "ledger", "udyam_cert")
EVIDENCE_LABELS = {
    "po": "Purchase order", "invoice": "Invoice copies", "delivery_proof": "Delivery proof",
    "acceptance_reply": "Buyer's acceptance reply", "ledger": "Ledger extract",
    "communications": "Emails and chats", "udyam_cert": "Udyam certificate",
}


@dataclass
class Finding:
    id: str
    severity: str
    message: str
    fix: str
    sources: list[str] = field(default_factory=list)   # "invoice:INV-114.amount", "evidence:po"


@dataclass
class Readiness:
    odr_ready: bool
    have: list[str]
    missing: list[str]
    score: str          # "4 of 5 documents ODR needs"


def _d(v):
    return date.fromisoformat(v) if isinstance(v, str) else v


def reconcile(case: dict, business: dict, invoices: list[dict], evidence: dict[str, str],
              eligibility_verdict: str) -> tuple[list[Finding], Readiness]:
    """case: contract_date, po_amount, dispute_reason. invoices: number, invoice_date,
    amount, delivery_date, objection_date, objection_removed_date.
    evidence: kind -> have/missing/unknown."""
    f: list[Finding] = []
    po_date = _d(case.get("contract_date"))
    po_amount = Decimal(str(case["po_amount"])) if case.get("po_amount") is not None else None

    # PO vs invoices
    total = sum((Decimal(str(i["amount"])) for i in invoices), Decimal(0))
    if po_amount is not None and total > po_amount:
        f.append(Finding(
            "po_amount_exceeded", "warning",
            f"Invoices total Rs {total:,.2f} but the purchase order is for Rs {po_amount:,.2f}.",
            "Check for a revised PO or written approval of the extra quantity, and upload it. "
            "The buyer may dispute the excess.",
            ["case.po_amount"] + [f"invoice:{i['number']}.amount" for i in invoices]))
    for i in invoices:
        inv_d = _d(i["invoice_date"])
        if po_date and inv_d < po_date:
            f.append(Finding(
                "invoice_before_po", "warning",
                f"{i['number']} is dated {inv_d:%d %b %Y}, before the purchase order "
                f"({po_date:%d %b %Y}).",
                "Confirm which order this invoice belongs to, or correct the PO date.",
                [f"invoice:{i['number']}.invoice_date", "case.contract_date"]))
        if not i.get("delivery_date"):
            f.append(Finding(
                "delivery_date_missing", "blocking",
                f"{i['number']} has no delivery date, so its due date and interest cannot "
                "be worked out.",
                "Add the delivery date from the delivery challan or courier record.",
                [f"invoice:{i['number']}.delivery_date"]))
        elif _d(i["delivery_date"]) < inv_d:
            f.append(Finding(
                "delivery_before_invoice", "info",
                f"{i['number']} was delivered before it was invoiced. That is normal, but "
                "the clock runs from delivery, not the invoice date.",
                "No action needed.", [f"invoice:{i['number']}.delivery_date"]))
        if i.get("objection_date") and not i.get("objection_removed_date"):
            f.append(Finding(
                "objection_unresolved", "blocking",
                f"The buyer objected to {i['number']} in writing on "
                f"{_d(i['objection_date']):%d %b %Y} and it is not marked resolved.",
                "Resolve the objection (replacement, credit note or written acceptance) "
                "and record the date it was removed.",
                [f"invoice:{i['number']}.objection_date", "evidence:communications"]))

    # Eligibility-related facts
    reg = _d(business.get("udyam_reg_date"))
    if reg and po_date and reg > po_date:
        f.append(Finding(
            "udyam_after_po", "warning",
            f"Udyam registration ({reg:%d %b %Y}) is after the purchase order "
            f"({po_date:%d %b %Y}). Whether the Act's interest applies is legally unsettled.",
            "Get professional advice before a formal demand or ODR filing.",
            ["business.udyam_reg_date", "case.contract_date"]))
    if eligibility_verdict == "not_eligible":
        f.append(Finding(
            "not_eligible", "info",
            "MSMED Act delayed-payment rights do not apply, so no statutory interest or ODR "
            "filing. Reminders and an ordinary civil claim remain open.",
            "Use reminders; consult a professional for a civil claim.",
            ["business.size", "business.activity"]))

    # Evidence
    if evidence.get("delivery_proof") in ("missing", "unknown") and any(
            i.get("delivery_date") for i in invoices):
        f.append(Finding(
            "delivery_proof_missing", "warning",
            "Deemed acceptance depends on the delivery date, but there is no delivery proof "
            "on file.",
            "Collect the signed challan, e-way bill or courier record. If none exists, ask the "
            "buyer to confirm receipt in writing.",
            ["evidence:delivery_proof"] + [f"invoice:{i['number']}.delivery_date"
                                           for i in invoices if i.get("delivery_date")]))
    if evidence.get("acceptance_reply") != "have" and not any(
            i.get("objection_date") for i in invoices):
        f.append(Finding(
            "acceptance_by_deeming", "info",
            "No written acceptance from the buyer, so acceptance rests on the 15-day deemed "
            "acceptance rule. That is valid, but a written confirmation is stronger.",
            "Optional: send the acceptance-confirmation message.",
            ["evidence:acceptance_reply"]))
    if case.get("dispute_reason") in ("quality", "quantity"):
        f.append(Finding(
            "buyer_dispute", "blocking",
            f"The buyer has raised a {case['dispute_reason']} dispute.",
            "Answer it with evidence (test report, delivery count, photos) before asking for "
            "payment. The buyer can bring it as a counter-claim later.",
            ["case.dispute_reason", "evidence:communications"]))

    have = [k for k in ODR_REQUIRED if evidence.get(k) == "have"]
    missing = [k for k in ODR_REQUIRED if evidence.get(k) != "have"]
    for k in missing:
        f.append(Finding(
            f"odr_doc_missing:{k}", "warning",
            f"{EVIDENCE_LABELS[k]} is not on file; the ODR filing needs it.",
            f"Find and upload the {EVIDENCE_LABELS[k].lower()}.", [f"evidence:{k}"]))
    readiness = Readiness(
        odr_ready=not missing and not any(x.severity == "blocking" for x in f),
        have=have, missing=missing, score=f"{len(have)} of {len(ODR_REQUIRED)} documents ODR needs")

    order = {"blocking": 0, "warning": 1, "info": 2}
    return sorted(f, key=lambda x: order[x.severity]), readiness
