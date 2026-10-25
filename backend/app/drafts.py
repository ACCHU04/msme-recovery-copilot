"""Follow-up drafts from fixed templates. Every number, date and section reference is
filled in by code from the calculation snapshot; nothing is written by AI here.
P3 can add an LLM rewording step later, keeping these as the fallback.
The owner edits and sends the message themselves. The app never sends it.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

KINDS = ("acceptance_confirm", "nudge", "firm", "demand")


def _inr(x) -> str:
    """Indian digit grouping: 246072.61 -> Rs 2,46,072.61"""
    d = Decimal(str(x)).quantize(Decimal("0.01"))
    whole, frac = f"{d:.2f}".split(".")
    neg = whole.startswith("-")
    whole = whole.lstrip("-")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{'-' if neg else ''}Rs {whole}.{frac}"


def _d(s: str) -> str:
    return date.fromisoformat(s).strftime("%d %b %Y").lstrip("0")


def build_draft(kind: str, outputs: dict, business_name: str, buyer_name: str,
                unpaid_simple: Decimal) -> dict:
    """unpaid_simple: invoice amounts minus payments received (what the buyer sees as unpaid)."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    as_of = date.fromisoformat(outputs["as_of"])
    pay_by = (as_of + timedelta(days=15)).isoformat()
    invs = outputs["invoices"]
    numbers = " and ".join(i["number"] for i in invs) if len(invs) <= 2 else \
        ", ".join(i["number"] for i in invs)
    interest = Decimal(outputs["totals"]["interest"])
    total = Decimal(outputs["totals"]["total"])
    eligible = outputs["eligibility"]["verdict"] == "eligible"
    broken = [p for p in outputs.get("promises", []) if p["status"] in ("broken", "part_kept")]
    facts = {"invoices": numbers, "unpaid_invoice_value": str(unpaid_simple),
             "interest": str(interest), "total": str(total), "as_of": outputs["as_of"],
             "pay_by": pay_by, "calculation_as_of": outputs["as_of"]}
    caution = None

    if kind == "acceptance_confirm":
        body = (f"Hello {buyer_name} team,\n\nThis is to confirm the delivery against "
                f"{numbers}. Could you please reply to confirm that the goods were received "
                f"in good condition? It helps us keep both our records in order.\n\n"
                f"Thank you,\n{business_name}")
    elif kind == "nudge":
        body = (f"Hello {buyer_name} team, hope all is well.\n\nA quick reminder that "
                f"{numbers} still have {_inr(unpaid_simple)} unpaid. Could you let us know "
                f"when we can expect the payment?\n\nThanks,\n{business_name}")
    elif kind == "firm":
        promise_line = ""
        if broken:
            p = broken[-1]
            promise_line = (f" We had noted your commitment to pay {_inr(p['amount'])} by "
                            f"{_d(p['due_date'])}, which we have not yet received.")
        interest_line = (f" Under the MSMED Act, 2006, interest of {_inr(interest)} has "
                         f"accrued as of {_d(outputs['as_of'])}." if eligible and interest > 0
                         else "")
        tax_line = (" Timely payment also protects your tax deduction under Section 43B(h) of the Income-tax Act, 1961 "
                    "(Section 37(2)(g) of the Income-tax Act, 2025)." if eligible else "")
        amount = total if eligible else unpaid_simple
        body = (f"Hello {buyer_name} team,\n\n{numbers} are past their due dates."
                f"{promise_line}{interest_line}{tax_line}\n\nPlease arrange payment of {_inr(amount)} "
                f"by {_d(pay_by)}. If there is any issue with the invoices, please tell us so "
                f"we can resolve it.\n\nRegards,\n{business_name}")
    else:  # demand
        if not eligible:
            raise ValueError("A formal demand under the MSMED Act is not drafted because "
                             "eligibility is not confirmed. Use a firm reminder and consult "
                             "a professional.")
        lines = "\n".join(
            f"- {i['number']}: due by {_d(i['due']['last_day_to_pay'])}, outstanding "
            f"{_inr(i['interest']['total_outstanding'])}" for i in invs
            if i["status"] == "computed")
        body = (f"Dear Sir/Madam,\n\nRe: payment due under Sections 15 and 16 of the Micro, "
                f"Small and Medium Enterprises Development Act, 2006\n\nThe following "
                f"invoices from {business_name} remain unpaid beyond the period allowed "
                f"under Section 15:\n{lines}\n\nAs of {_d(outputs['as_of'])}, the amount due "
                f"is {_inr(total)}, including compound interest of {_inr(interest)} under "
                f"Section 16. A month-by-month statement is attached.\n\nWe request payment "
                f"by {_d(pay_by)}. We value our business relationship and would prefer to "
                f"settle this directly.\n\nYours faithfully,\n{business_name}")
        caution = "Review with a professional before sending a formal demand."

    return {"kind": kind, "lang": "en", "body": body, "facts_used": facts,
            "generated_by": "template", "caution": caution}
