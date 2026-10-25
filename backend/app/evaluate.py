"""Runs recovery_engine over a stored case and returns the API-contract JSON.

Every number comes from the engine. This module only loads rows, maps engine
results/exceptions to per-invoice statuses, sums totals, and picks a bucket.
"""
from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from enum import Enum
from typing import Any

from recovery_engine import (
    AcceptanceStatus, Payment, RateUnavailable, Verdict,
    check_eligibility, compute_due_date, compute_interest,
)

from copilot import Followup, promise_statuses, recommend, reconcile

from .store import Row, Store

ENGINE_VERSION = "0.1.0"
ZERO = Decimal("0.00")

BUCKET_ORDER = ["not_due", "due_soon", "overdue", "overdue_interest_accruing"]


def _d(v: Any) -> date | None:
    return date.fromisoformat(v) if isinstance(v, str) else v


def _money(v: Any) -> Decimal:
    return Decimal(str(v)).quantize(Decimal("0.01"))


def _jsonable(obj: Any) -> Any:
    """Dataclasses/Decimal/date/Enum -> JSON-friendly (money as strings)."""
    if is_dataclass(obj):
        obj = asdict(obj)
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, date):
        return obj.isoformat()
    return obj


def _bucket(last_day: date | None, as_of: date, interest_running: bool) -> str:
    if last_day is None:
        return "not_due"
    if as_of <= last_day:
        return "due_soon" if (last_day - as_of) <= timedelta(days=7) else "not_due"
    return "overdue_interest_accruing" if interest_running else "overdue"


def _eligibility(store: Store, case: Row, invoices: list[Row]):
    business = store.get("businesses", case["business_id"]) or {}
    return check_eligibility(
        size=business.get("size"),
        activity=business.get("activity"),
        udyam_registered=business.get("udyam_registered"),
        udyam_registration_date=_d(business.get("udyam_reg_date")),
        contract_date=_d(case.get("contract_date"))
        or min(_d(i["invoice_date"]) for i in invoices),
    )


def invoice_outstanding(store: Store, invoice: Row, on: date) -> Decimal:
    """Everything owed on one invoice at the start of day `on` (before any new payment
    that day): principal plus statutory interest where the engine can compute it,
    otherwise principal only. Used to reject payments larger than what is owed."""
    case = store.get("cases", invoice["case_id"])
    amount = _money(invoice["amount"])
    pays = [Payment(_d(p["paid_on"]), _money(p["amount"]))
            for p in store.select("payments", invoice_id=invoice["id"])
            if _d(p["paid_on"]) <= on]
    simple = max(amount - sum((p.amount for p in pays), ZERO), ZERO)
    if not invoice.get("delivery_date"):
        return simple
    case_invoices = store.select("invoices", case_id=invoice["case_id"])
    if _eligibility(store, case, case_invoices).verdict != Verdict.ELIGIBLE:
        return simple
    due = compute_due_date(_d(invoice["delivery_date"]), _d(invoice.get("agreed_due_date")),
                           _d(invoice.get("objection_date")),
                           _d(invoice.get("objection_removed_date")))
    if due.interest_start is None or on <= due.interest_start:
        return simple
    try:
        res = compute_interest(amount, due.interest_start, on, pays,
                               allocation=case.get("allocation") or "interest_first")
    except RateUnavailable:
        return simple
    return res.total_outstanding


def evaluate_case(store: Store, case_id: str, as_of: date | None = None) -> dict:
    as_of = as_of or date.today()
    case = store.get("cases", case_id)
    if case is None:
        raise LookupError("case not found")
    invoices = store.select("invoices", case_id=case_id)
    if not invoices:
        raise ValueError("case has no invoices")

    elig = _eligibility(store, case, invoices)
    interest_allowed = elig.verdict == Verdict.ELIGIBLE

    out_invoices = []
    tot_p, tot_i = ZERO, ZERO
    buckets = []
    for inv in sorted(invoices, key=lambda r: r["invoice_date"]):
        amount = _money(inv["amount"])
        pays = [Payment(_d(p["paid_on"]), _money(p["amount"]))
                for p in store.select("payments", invoice_id=inv["id"])]
        paid = sum((p.amount for p in pays if p.paid_on <= as_of), ZERO)
        simple_principal = max(amount - paid, ZERO)
        entry: dict[str, Any] = {"invoice_id": inv["id"], "number": inv["number"],
                                 "amount": str(amount), "due": None, "interest": None}

        if not inv.get("delivery_date"):
            entry.update(status="missing_inputs", principal_outstanding=str(simple_principal),
                         message="Add the delivery date to work out the due date.")
            tot_p += simple_principal
            buckets.append("not_due")
            out_invoices.append(entry)
            continue

        due = compute_due_date(
            delivery_date=_d(inv["delivery_date"]),
            agreed_due_date=_d(inv.get("agreed_due_date")),
            objection_date=_d(inv.get("objection_date")),
            objection_removed_date=_d(inv.get("objection_removed_date")),
        )
        entry["due"] = _jsonable(due)

        if due.acceptance_status == AcceptanceStatus.DISPUTED:
            entry.update(status="disputed", principal_outstanding=str(simple_principal),
                         message="The buyer's objection is unresolved, so no due date or "
                                 "interest is shown.")
            tot_p += simple_principal
            buckets.append("overdue" if simple_principal > 0 else "not_due")
        elif not interest_allowed:
            entry.update(status="not_eligible" if elig.verdict == Verdict.NOT_ELIGIBLE
                         else "eligibility_uncertain",
                         principal_outstanding=str(simple_principal),
                         message="Statutory interest is not shown: see the eligibility result.")
            tot_p += simple_principal
            buckets.append(_bucket(due.last_day_to_pay, as_of, False)
                           if simple_principal > 0 else "not_due")
        else:
            try:
                res = compute_interest(
                    amount, due.interest_start, as_of,
                    [p for p in pays if p.paid_on <= as_of],
                    allocation=case.get("allocation") or "interest_first",
                )
            except RateUnavailable as e:
                entry.update(status="rate_unavailable",
                             principal_outstanding=str(simple_principal), message=str(e))
                tot_p += simple_principal
                buckets.append("overdue")
            else:
                entry.update(status="computed", interest=_jsonable(res),
                             principal_outstanding=str(res.principal_outstanding))
                tot_p += res.principal_outstanding
                tot_i += res.interest_outstanding
                running = res.total_outstanding > 0 and as_of > due.interest_start
                buckets.append(_bucket(due.last_day_to_pay, as_of, running)
                               if res.total_outstanding > 0 else "not_due")
        out_invoices.append(entry)

    copilot = run_copilot(store, case, invoices, out_invoices, elig.verdict.value,
                          tot_p + tot_i, as_of)
    return {
        "case_id": case_id,
        "as_of": as_of.isoformat(),
        "next_action": copilot["next_action"],
        "findings": copilot["findings"],
        "readiness": copilot["readiness"],
        "promises": copilot["promises"],
        "followups": copilot["followups"],
        "engine_version": ENGINE_VERSION,
        "eligibility": _jsonable(elig),
        "invoices": out_invoices,
        "totals": {"principal": str(tot_p), "interest": str(tot_i), "total": str(tot_p + tot_i)},
        "bucket": max(buckets, key=BUCKET_ORDER.index) if buckets else "not_due",
        "allocation": case.get("allocation") or "interest_first",
    }


def run_copilot(store: Store, case: Row, invoices: list[Row], evaluated: list[dict],
                verdict: str, total: Decimal, as_of: date) -> dict:
    business = store.get("businesses", case["business_id"]) or {}
    buyer = store.get("buyers", case["buyer_id"]) or {}
    evidence = {e["kind"]: e["status"] for e in store.select("evidence_items",
                                                             case_id=case["id"])}
    findings, readiness = reconcile(case, business, invoices, evidence, verdict)

    promise_rows = store.select("promises", case_id=case["id"])
    payments = [{"paid_on": _d(p["paid_on"]), "amount": _money(p["amount"])}
                for inv in invoices for p in store.select("payments", invoice_id=inv["id"])]
    statuses = promise_statuses(
        [{"id": p["id"], "made_on": _d(p["made_on"]), "due_date": _d(p["due_date"]),
          "amount": _money(p["amount"])} for p in promise_rows], payments, as_of)
    texts = {p["id"]: p.get("source_text") for p in promise_rows}

    fu_rows = sorted(store.select("followups", case_id=case["id"]),
                     key=lambda f: f["sent_on"])
    followups = [Followup(int(f["step"]), _d(f["sent_on"]), bool(f.get("reply_received")))
                 for f in fu_rows if _d(f["sent_on"]) <= as_of]

    action = recommend(as_of, verdict, findings, readiness, evaluated, total, statuses,
                       followups, buyer.get("relationship_importance"))
    return {
        "next_action": _jsonable(action),
        "findings": _jsonable(findings),
        "readiness": _jsonable(readiness),
        "promises": [{**_jsonable(s), "source_text": texts.get(s.promise_id)}
                     for s in statuses],
        "followups": fu_rows,
    }


def settlement_from_totals(totals: dict, waiver_levels=(0, 50, 100)) -> list[dict]:
    """Settlement options on case totals (owner's commercial choice, not legal advice)."""
    principal = Decimal(totals["principal"])
    interest = Decimal(totals["interest"])
    full = principal + interest
    labels = {0: "Full claim (principal + all interest)",
              100: "Principal only (waive all interest)"}
    out = []
    for pct in waiver_levels:
        waived = (interest * pct / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        requested = full - waived
        out.append({
            "label": labels.get(pct, f"Principal + {100 - pct}% of interest"),
            "interest_waived_pct": pct,
            "amount_requested": str(requested),
            "amount_forgone": str(waived),
            "pct_of_full_claim": str((requested / full * 100).quantize(Decimal("0.1")))
            if full else "0.0",
        })
    return out
