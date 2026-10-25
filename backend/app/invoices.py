"""Invoice-level views across a business, and a stateless what-if calculator.
All figures come from recovery_engine via evaluate_case; nothing is re-derived here
except simple sums of recorded payments."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from recovery_engine import (
    AcceptanceStatus, BANK_RATES, Payment, RateUnavailable, compute_due_date, compute_interest,
)
from recovery_engine.rates import STATUTORY_MULTIPLIER

from .evaluate import _d, _jsonable, _money, evaluate_case, load_business_bundle
from .store import Store

ZERO = Decimal("0.00")


def invoice_status(amount: Decimal, paid: Decimal, entry: dict, as_of: date) -> dict:
    """Plain payment status of one invoice (separate from statutory interest)."""
    due = entry.get("due") or {}
    last = _d(due.get("last_day_to_pay"))
    unpaid = max(amount - paid, ZERO)
    days_overdue = (as_of - last).days if last and as_of > last else 0
    days_left = (last - as_of).days if last and as_of <= last else None
    if unpaid == 0:
        status = "paid"
    elif entry.get("status") == "disputed":
        status = "disputed"
    elif last is None:
        status = "missing_dates"
    elif as_of > last:
        status = "overdue"
    elif days_left is not None and days_left <= 7:
        status = "due_soon"
    else:
        status = "not_due"
    partial = status != "paid" and paid > 0
    return {"status": status, "partially_paid": partial, "unpaid": str(unpaid),
            "days_overdue": days_overdue if unpaid > 0 else 0, "days_left": days_left}


def list_invoices(store: Store, business_id: str, as_of: date | None = None,
                  bundle: dict | None = None) -> list[dict]:
    as_of = as_of or date.today()
    bundle = bundle or load_business_bundle(store, business_id)
    out: list[dict] = []
    for case in bundle["cases"]:
        rows = bundle["invoices_by_case"].get(case["id"], [])
        if not rows:
            continue
        buyer = bundle["buyers"].get(case["buyer_id"], {})
        ev = evaluate_case(store, case["id"], as_of, bundle=bundle)
        by_id = {e["invoice_id"]: e for e in ev["invoices"]}
        for inv in rows:
            pays = sorted(bundle["payments_by_inv"].get(inv["id"], []), key=lambda p: p["paid_on"])
            paid = sum((_money(p["amount"]) for p in pays if _d(p["paid_on"]) <= as_of), ZERO)
            amount = _money(inv["amount"])
            entry = by_id[inv["id"]]
            st = invoice_status(amount, paid, entry, as_of)
            interest = entry.get("interest") or {}
            out.append({
                "id": inv["id"], "number": inv["number"], "case_id": case["id"],
                "buyer_id": case["buyer_id"], "buyer_name": buyer.get("name"),
                "invoice_date": inv["invoice_date"], "amount": str(amount), "paid": str(paid),
                "delivery_date": inv.get("delivery_date"),
                "agreed_due_date": inv.get("agreed_due_date"),
                "last_day_to_pay": (entry.get("due") or {}).get("last_day_to_pay"),
                "engine_status": entry["status"],
                "estimated_interest": interest.get("interest_outstanding"),
                "statutory_total": interest.get("total_outstanding"),
                "payments": pays,
                **st,
            })
    return sorted(out, key=lambda r: r["invoice_date"], reverse=True)


def what_if(amount: Decimal, delivery_date: date, agreed_due_date: date | None,
            objection_date: date | None, objection_removed_date: date | None,
            payments: list[Payment], as_of: date, allocation: str) -> dict:
    """Stateless calculator for the legal assistant. Same engine as cases; does not
    check eligibility (the page says so)."""
    due = compute_due_date(delivery_date, agreed_due_date, objection_date, objection_removed_date)
    result: dict = {"due": _jsonable(due), "interest": None, "status": "computed", "message": None}
    if due.acceptance_status == AcceptanceStatus.DISPUTED:
        result.update(status="disputed", message="The buyer objected within 15 days and the "
                      "objection is unresolved, so no due date or interest applies yet.")
        return result
    try:
        res = compute_interest(amount, due.interest_start, as_of, payments, allocation=allocation)
    except RateUnavailable as e:
        result.update(status="rate_unavailable", message=str(e))
        return result
    result["interest"] = _jsonable(res)
    return result


def rate_table() -> list[dict]:
    return [{"effective_from": r.effective_from.isoformat(), "bank_rate_pct": str(r.rate_pct),
             "statutory_rate_pct": str(r.rate_pct * STATUTORY_MULTIPLIER),
             "source": r.source, "note": r.note} for r in BANK_RATES]
