"""Compound interest with monthly rests at 3x RBI Bank Rate (MSMED Act s.16).

Method (each item is a disclosed ASSUMPTION, shown to the user in the report):
  A3  Interest accrues daily at (3 x Bank Rate in force that day) / 365.
      A mid-month Bank Rate change applies from its effective date.
  A4  Monthly rests fall on the same day-of-month as the interest start date
      (clamped to month end). At each rest, accrued interest is added to the
      balance, so later interest is charged on it too.
  A5  A payment made on day P stops interest on the paid amount from day P.
  A6  Payments are applied according to `allocation`:
      "interest_first" (default) or "principal_first". The Act does not say
      which; the user picks, and the report states the choice.
  A7  Interest is rounded to paise (half-up) at each monthly rest and at the
      valuation date.
  A8  Unpaid interest keeps compounding after the principal is fully paid.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from .rates import BankRate, s16_annual_rate

PAISE = Decimal("0.01")
DAYS_IN_YEAR = Decimal(365)


def _r(x: Decimal) -> Decimal:
    return x.quantize(PAISE, rounding=ROUND_HALF_UP)


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


@dataclass
class Payment:
    paid_on: date
    amount: Decimal


@dataclass
class PeriodRow:
    period_start: date
    period_end: date          # exclusive
    opening_balance: Decimal  # principal + capitalised interest at period start
    interest: Decimal
    payments: Decimal
    closing_principal: Decimal
    closing_interest: Decimal
    rates_pct: list[str]      # e.g. ["16.50% (17 days)", "17.25% (13 days)"]


@dataclass
class InterestResult:
    as_of: date
    principal_outstanding: Decimal
    interest_outstanding: Decimal
    total_outstanding: Decimal
    interest_accrued_total: Decimal
    schedule: list[PeriodRow]
    allocation: str
    assumptions: list[str]
    warnings: list[str] = field(default_factory=list)


ASSUMPTIONS = [
    "A3 Daily accrual at 3x the RBI Bank Rate in force on each day, divided by 365.",
    "A4 Monthly rests on the same day-of-month as the interest start date.",
    "A5 Interest stops on any paid amount from the payment date.",
    "A7 Interest rounded to paise at each monthly rest.",
    "A8 Unpaid interest continues to compound after the principal is paid.",
]


def compute_interest(
    principal: Decimal,
    interest_start: date,
    as_of: date,
    payments: list[Payment] | None = None,
    allocation: Literal["interest_first", "principal_first"] = "interest_first",
    rate_table: list[BankRate] | None = None,
) -> InterestResult:
    principal = Decimal(principal)
    if principal <= 0:
        raise ValueError("principal must be positive")
    if allocation not in ("interest_first", "principal_first"):
        raise ValueError("allocation must be 'interest_first' or 'principal_first'")
    payments = sorted(payments or [], key=lambda p: p.paid_on)
    for p in payments:
        if Decimal(p.amount) <= 0:
            raise ValueError("payment amounts must be positive")
        if p.paid_on > as_of:
            raise ValueError(f"payment dated {p.paid_on} is after the valuation date {as_of}")

    warnings: list[str] = []
    prin = principal
    cap_int = Decimal(0)     # interest already capitalised at a rest (compounds)
    accrued = Decimal(0)     # interest accrued since the last rest (not yet compounding)
    total_accrued = Decimal(0)

    def apply_payment(amount: Decimal) -> None:
        nonlocal prin, cap_int, accrued
        remaining = Decimal(amount)
        order = (["accrued", "cap", "prin"] if allocation == "interest_first"
                 else ["prin", "cap", "accrued"])
        for bucket in order:
            cur = {"accrued": accrued, "cap": cap_int, "prin": prin}[bucket]
            take = min(cur, remaining)
            remaining -= take
            if bucket == "accrued":
                accrued -= take
            elif bucket == "cap":
                cap_int -= take
            else:
                prin -= take
        if remaining > 0:
            warnings.append(f"Overpayment of Rs {_r(remaining)} beyond everything owed; ignored.")

    # Payments before interest starts only reduce principal (no interest yet).
    pay_idx = 0
    while pay_idx < len(payments) and payments[pay_idx].paid_on < interest_start:
        apply_payment(payments[pay_idx].amount)
        pay_idx += 1

    schedule: list[PeriodRow] = []
    if as_of <= interest_start or prin + cap_int + accrued == 0:
        if pay_idx < len(payments):
            for p in payments[pay_idx:]:
                apply_payment(p.amount)
        return InterestResult(as_of, _r(prin), Decimal("0.00"), _r(prin), Decimal("0.00"),
                              schedule, allocation, ASSUMPTIONS + [_alloc_text(allocation)],
                              warnings)

    n = 1
    period_start = interest_start
    while period_start < as_of:
        period_end = min(add_months(interest_start, n), as_of)
        opening = prin + cap_int
        period_interest = Decimal(0)
        period_payments = Decimal(0)
        rate_days: dict[Decimal, int] = {}

        day = period_start
        while day < period_end:
            # Payments dated today are applied before today's accrual (A5).
            while pay_idx < len(payments) and payments[pay_idx].paid_on == day:
                accrued = _r(accrued)
                apply_payment(payments[pay_idx].amount)
                period_payments += Decimal(payments[pay_idx].amount)
                pay_idx += 1
            rate = s16_annual_rate(day, rate_table)
            rate_days[rate] = rate_days.get(rate, 0) + 1
            daily = (prin + cap_int) * rate / DAYS_IN_YEAR
            accrued += daily
            period_interest += daily
            day += timedelta(days=1)

        # Monthly rest (or valuation date): capitalise what accrued this period.
        accrued = _r(accrued)
        period_interest = _r(period_interest)
        total_accrued += period_interest
        cap_int += accrued
        accrued = Decimal(0)

        schedule.append(PeriodRow(
            period_start, period_end, _r(opening), period_interest, _r(period_payments),
            _r(prin), _r(cap_int),
            [f"{(r * 100).quantize(PAISE)}% ({d} days)" for r, d in rate_days.items()],
        ))
        period_start = period_end
        n += 1

    # A payment dated exactly on the valuation date settles against the final balance.
    while pay_idx < len(payments):
        apply_payment(payments[pay_idx].amount)
        pay_idx += 1

    interest_out = _r(cap_int + accrued)
    return InterestResult(
        as_of=as_of,
        principal_outstanding=_r(prin),
        interest_outstanding=interest_out,
        total_outstanding=_r(prin) + interest_out,
        interest_accrued_total=_r(total_accrued),
        schedule=schedule,
        allocation=allocation,
        assumptions=ASSUMPTIONS + [_alloc_text(allocation)],
        warnings=warnings,
    )


def _alloc_text(allocation: str) -> str:
    if allocation == "interest_first":
        return ("A6 Payments applied to interest first, then principal (user's choice; the Act "
                "is silent). Choosing principal-first can give a slightly lower total when a "
                "payment falls between monthly rests.")
    return ("A6 Payments applied to principal first, then interest (user's choice; the Act "
            "is silent). Choosing interest-first can give a slightly higher total when a "
            "payment falls between monthly rests.")
