"""Promise-to-pay tracking.

1. parse_promise(): pull a candidate amount and date out of a buyer's message.
   Rule-based so it works offline and is testable; the LLM (P3) can sit in front of it
   with the same output shape. Either way the OWNER CONFIRMS before anything is saved.
2. promise_statuses(): mark each confirmed promise kept / kept_late / part_kept /
   broken / pending by matching recorded payments to promises in date order.
"""
from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}
MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_name) if m})

AMOUNT_RE = re.compile(
    r"(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*"
    r"(k|thousand|l|lac|lakh|lakhs)?\b", re.I)


@dataclass
class PromiseCandidate:
    amount: Decimal | None
    due_date: date | None
    amount_text: str | None
    date_text: str | None
    needs_confirmation: bool = True   # always: nothing is saved without the owner


def _parse_amount(text: str) -> tuple[Decimal | None, str | None]:
    best: tuple[Decimal, str] | None = None
    for m in AMOUNT_RE.finditer(text):
        raw, unit = m.group(1), (m.group(2) or "").lower()
        prefix = text[max(0, m.start() - 4):m.start() + 4].lower()
        has_currency = any(s in m.group(0).lower() or s in prefix for s in ("₹", "rs", "inr"))
        try:
            value = Decimal(raw.replace(",", ""))
        except InvalidOperation:
            continue
        if unit in ("k", "thousand"):
            value *= 1000
        elif unit in ("l", "lac", "lakh", "lakhs"):
            value *= 100000
        # Ignore bare small numbers (dates, "2 days") unless marked as money.
        if not (has_currency or unit or "," in raw or value >= 1000):
            continue
        if best is None or value > best[0]:
            best = (value.quantize(Decimal("0.01")), m.group(0).strip())
    return (best[0], best[1]) if best else (None, None)


def _parse_date(text: str, said_on: date) -> tuple[date | None, str | None]:
    t = text.lower()
    if m := re.search(r"\b(today|tonight|aaj)\b", t):
        return said_on, m.group(0)
    if m := re.search(r"\b(day after tomorrow)\b", t):
        return said_on + timedelta(days=2), m.group(0)
    if m := re.search(r"\b(tomorrow|tmrw|kal)\b", t):
        return said_on + timedelta(days=1), m.group(0)
    if m := re.search(r"\bin (\d{1,2}) days?\b", t):
        return said_on + timedelta(days=int(m.group(1))), m.group(0)
    if m := re.search(r"\bnext week\b", t):
        return said_on + timedelta(days=7), m.group(0)
    if m := re.search(r"\b(end of (the )?month|month[- ]end)\b", t):
        last = calendar.monthrange(said_on.year, said_on.month)[1]
        return said_on.replace(day=last), m.group(0)
    if m := re.search(r"\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b", t):   # DD/MM(/YYYY)
        d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
        year = (int(y) + 2000 if y and len(y) == 2 else int(y)) if y else said_on.year
        try:
            found = date(year, mo, d)
        except ValueError:
            found = None
        if found:
            if not y and found < said_on:
                found = found.replace(year=found.year + 1)
            return found, m.group(0)
    month_alt = "|".join(sorted(MONTHS, key=len, reverse=True))
    for pat, order in ((rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({month_alt})\b", "dm"),
                       (rf"\b({month_alt})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", "md")):
        if m := re.search(pat, t):
            d, mon = (m.group(1), m.group(2)) if order == "dm" else (m.group(2), m.group(1))
            try:
                found = date(said_on.year, MONTHS[mon], int(d))
            except ValueError:
                continue
            if found < said_on:
                found = found.replace(year=found.year + 1)
            return found, m.group(0)
    for i, name in enumerate(WEEKDAYS):
        if m := re.search(rf"\b(next\s+)?{name}\b", t):
            ahead = (i - said_on.weekday()) % 7 or 7
            if m.group(1):
                ahead += 7 if ahead < 7 else 0
            return said_on + timedelta(days=ahead), m.group(0)
    return None, None


def parse_promise(text: str, said_on: date) -> PromiseCandidate:
    amount, amount_text = _parse_amount(text)
    due, date_text = _parse_date(text, said_on)
    return PromiseCandidate(amount, due, amount_text, date_text)


# ---------------------------------------------------------------- statuses
@dataclass
class PromiseStatus:
    promise_id: str
    made_on: date
    due_date: date
    amount: Decimal
    received: Decimal
    status: str          # kept | kept_late | part_kept | broken | pending
    settled_on: date | None


def promise_statuses(promises: list[dict], payments: list[dict], as_of: date) -> list[PromiseStatus]:
    """promises: {id, made_on, due_date, amount}; payments: {paid_on, amount} (whole case).
    Each payment made on/after a promise was given counts towards the earliest unmet
    promise, in date order."""
    ps = sorted(promises, key=lambda p: (p["due_date"], p["made_on"]))
    received = {p["id"]: Decimal(0) for p in ps}
    settled: dict[str, date | None] = {p["id"]: None for p in ps}
    for pay in sorted(payments, key=lambda p: p["paid_on"]):
        if pay["paid_on"] > as_of:
            continue
        left = Decimal(pay["amount"])
        for p in ps:
            if left <= 0:
                break
            if p["made_on"] > pay["paid_on"]:
                continue
            gap = Decimal(p["amount"]) - received[p["id"]]
            if gap <= 0:
                continue
            take = min(gap, left)
            received[p["id"]] += take
            left -= take
            if received[p["id"]] >= Decimal(p["amount"]):
                settled[p["id"]] = pay["paid_on"]
    out = []
    for p in ps:
        amt, got = Decimal(p["amount"]), received[p["id"]]
        if got >= amt:
            status = "kept" if settled[p["id"]] <= p["due_date"] else "kept_late"
        elif p["due_date"] >= as_of:
            status = "pending"
        else:
            status = "part_kept" if got > 0 else "broken"
        out.append(PromiseStatus(p["id"], p["made_on"], p["due_date"], amt, got, status,
                                 settled[p["id"]]))
    return out
