"""Acceptance date, payment deadline and interest start under MSMED Act ss.2(b), 15, 16.

Day-count convention (ASSUMPTION A1): "N days from day X" excludes day X
(General Clauses Act, 1897, s.9), so the period ends on X + N.

  * No written credit period: buyer must pay BEFORE the appointed day.
    Appointed day = day after 15 days from acceptance = X + 16.
    Last day to pay = X + 15. Interest runs from X + 16.
  * Written credit period / agreed date D: pay on or before D, but never
    later than X + 45 (s.15 proviso). Interest runs from D + 1 (capped D).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from enum import Enum


class AcceptanceStatus(str, Enum):
    DEEMED = "deemed"              # no written objection within 15 days of delivery
    OBJECTION_REMOVED = "objection_removed"
    DISPUTED = "disputed"          # written objection within 15 days, not yet removed


@dataclass
class DueDateResult:
    acceptance_status: AcceptanceStatus
    acceptance_date: date | None
    last_day_to_pay: date | None
    interest_start: date | None
    basis: str
    rule_ids: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def compute_due_date(
    delivery_date: date,
    agreed_due_date: date | None = None,
    objection_date: date | None = None,
    objection_removed_date: date | None = None,
) -> DueDateResult:
    """delivery_date is the day goods were delivered or services rendered."""
    warnings: list[str] = []
    rules: list[str] = []

    # --- Step 1: day of acceptance / deemed acceptance (s.2(b) and Explanation)
    objection_window_end = delivery_date + timedelta(days=15)
    if objection_date and objection_date < delivery_date:
        raise ValueError("objection_date cannot be before delivery_date")

    if objection_date and objection_date <= objection_window_end:
        if objection_removed_date is None:
            return DueDateResult(
                acceptance_status=AcceptanceStatus.DISPUTED,
                acceptance_date=None,
                last_day_to_pay=None,
                interest_start=None,
                basis="Buyer objected in writing within 15 days of delivery and the "
                "objection has not been removed, so the day of acceptance is not yet fixed.",
                rule_ids=["MSMED-2b-objection"],
                warnings=["No statutory due date or interest until the objection is resolved."],
            )
        if objection_removed_date < objection_date:
            raise ValueError("objection_removed_date cannot be before objection_date")
        acceptance = objection_removed_date
        status = AcceptanceStatus.OBJECTION_REMOVED
        rules.append("MSMED-2b-objection-removed")
    else:
        acceptance = delivery_date
        status = AcceptanceStatus.DEEMED
        rules.append("MSMED-2b-deemed-acceptance")
        if objection_date:
            warnings.append(
                "The buyer's objection came more than 15 days after delivery, so it does "
                "not change the deemed acceptance date here. The buyer may still raise "
                "quality issues as a counter-claim."
            )

    # --- Step 2: payment deadline (s.15) and interest start (s.16)
    statutory_cap = acceptance + timedelta(days=45)
    if agreed_due_date is not None:
        if agreed_due_date < acceptance:
            warnings.append("Agreed due date is before the acceptance date; check the dates.")
        if agreed_due_date > statutory_cap:
            last_day = statutory_cap
            basis = (f"Agreed date {agreed_due_date.isoformat()} is more than 45 days after "
                     f"acceptance, so it is capped at {statutory_cap.isoformat()} (s.15 proviso).")
            rules.append("MSMED-15-45day-cap")
            warnings.append("ASSUMPTION A2: interest runs from the day after the 45-day cap "
                            "where the agreed period exceeded 45 days.")
        else:
            last_day = agreed_due_date
            basis = f"Agreed in writing to pay by {agreed_due_date.isoformat()} (s.15)."
            rules.append("MSMED-15-agreed-date")
        interest_start = last_day + timedelta(days=1)
        rules.append("MSMED-16-from-day-after-agreed")
    else:
        appointed_day = acceptance + timedelta(days=16)
        last_day = appointed_day - timedelta(days=1)
        interest_start = appointed_day
        basis = ("No credit period agreed in writing, so payment was due before the "
                 f"appointed day {appointed_day.isoformat()} (s.2(b) and s.15).")
        rules += ["MSMED-2b-appointed-day", "MSMED-16-from-appointed-day"]

    return DueDateResult(status, acceptance, last_day, interest_start, basis, rules, warnings)
