"""RBI Bank Rate history used for MSMED Act s.16 interest (3x Bank Rate).

Only rows whose start date has been checked against a source are listed.
Dates BEFORE the earliest row raise RateUnavailable instead of guessing.
Person 4 (legal/QA): extend this table backwards from RBI press releases
before demoing invoices older than December 2025, and keep a source URL on
every row.
"""
from __future__ import annotations

from .due_date import human

from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class BankRate:
    effective_from: date
    rate_pct: Decimal  # e.g. Decimal("5.50") means 5.50% p.a.
    source: str
    note: str = ""


BANK_RATES: list[BankRate] = [
    BankRate(
        effective_from=date(2025, 12, 5),
        rate_pct=Decimal("5.50"),
        source="https://www.business-standard.com/finance/news/rbi-mpc-december-policy-review-what-changed-what-remained-same-125120500349_1.html",
        note="MPC 5 Dec 2025: MSF and Bank Rate reduced from 5.75% to 5.50%. "
        "Confirm exact effective date in the RBI press release.",
    ),
    BankRate(
        effective_from=date(2026, 10, 7),
        rate_pct=Decimal("5.75"),
        source="https://taxguru.in/?p=1087539",
        note="RBI circular RBI/2026-27/283 dated 7 Oct 2026: Bank Rate raised "
        "from 5.50% to 5.75% with immediate effect.",
    ),
]

STATUTORY_MULTIPLIER = Decimal("3")  # MSMED Act s.16: three times the Bank Rate


class RateUnavailable(Exception):
    """Raised when no verified Bank Rate covers the requested date."""


def bank_rate_on(day: date, table: list[BankRate] | None = None) -> BankRate:
    rows = sorted(table or BANK_RATES, key=lambda r: r.effective_from)
    applicable = [r for r in rows if r.effective_from <= day]
    if not applicable:
        raise RateUnavailable(
            f"No verified RBI Bank Rate on file for {human(day)}. "
            f"Earliest verified rate starts {human(rows[0].effective_from)}."
        )
    return applicable[-1]


def s16_annual_rate(day: date, table: list[BankRate] | None = None) -> Decimal:
    """Annual s.16 rate as a fraction, e.g. 0.165 for 16.5%."""
    return bank_rate_on(day, table).rate_pct * STATUTORY_MULTIPLIER / Decimal(100)
