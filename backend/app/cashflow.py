"""Cash-flow view: what is owed now, what falls due or is promised soon, and what to chase
first. Uses only facts already in the app (legal due dates, the buyer's own promises,
amounts owed). It does not predict when a buyer will pay."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from .drafts import _inr
from .evaluate import evaluate_case, load_business_bundle
from .invoices import list_invoices
from .store import Store

ZERO = Decimal("0")
AGE_BANDS = [(1, 30, "1–30 days"), (31, 90, "31–90 days"), (91, 180, "91–180 days"), (181, 10**6, "Over 180 days")]
QUIET_ACTIONS = {"close_case", "wait_until_due"}


def _m(v: Any) -> Decimal:
    return Decimal(str(v)) if v not in (None, "") else ZERO


def cash_flow(store: Store, business_id: str, as_of: date | None = None, weeks: int = 8) -> dict:
    as_of = as_of or date.today()
    bundle = load_business_bundle(store, business_id)
    invoices = list_invoices(store, business_id, as_of, bundle=bundle)
    week0 = as_of - timedelta(days=as_of.weekday())          # Monday of this week
    week_rows = [{"week_start": (week0 + timedelta(weeks=i)).isoformat(), "due": ZERO, "promised": ZERO}
                 for i in range(weeks)]
    horizon = week0 + timedelta(weeks=weeks)

    def week_of(d: date) -> dict | None:
        if as_of <= d < horizon:
            return week_rows[(d - week0).days // 7]
        return None

    ages = [{"label": label, "amount": ZERO, "count": 0} for *_, label in AGE_BANDS]
    owed_now = interest = due_30 = ZERO
    overdue_count = 0
    for inv in invoices:
        unpaid = _m(inv.get("unpaid"))
        if unpaid <= 0:
            continue
        owed = _m(inv.get("statutory_total")) or unpaid
        if inv.get("status") == "overdue":
            overdue_count += 1
            owed_now += owed
            interest += _m(inv.get("estimated_interest"))
            for band, (lo, hi, _) in zip(ages, AGE_BANDS):
                if (lo <= (inv.get("days_overdue") or 0) <= hi) or (lo == 1 and (inv.get("days_overdue") or 0) == 0):
                    band["amount"] += owed
                    band["count"] += 1
        elif inv.get("last_day_to_pay"):
            last = date.fromisoformat(str(inv["last_day_to_pay"])[:10])
            if last <= as_of + timedelta(days=30):
                due_30 += unpaid
            if (w := week_of(last)) is not None:
                w["due"] += unpaid

    promised_30 = ZERO
    chase: list[dict] = []
    for case in bundle["cases"]:
        if case.get("status") in ("settled", "archived") or not bundle["invoices_by_case"].get(case["id"]):
            continue
        try:
            ev = evaluate_case(store, case["id"], as_of, bundle=bundle)
        except ValueError:
            continue
        for p in ev.get("promises", []):
            if p.get("status") == "pending":
                d = date.fromisoformat(str(p["due_date"])[:10])
                amt = _m(p.get("amount"))
                if d <= as_of + timedelta(days=30):
                    promised_30 += amt
                if (w := week_of(d)) is not None:
                    w["promised"] += amt
        total = _m(ev["totals"]["total"])
        na = ev.get("next_action") or {}
        if total <= 0 or na.get("action") in QUIET_ACTIONS:
            continue
        case_invs = [i for i in invoices if i["case_id"] == case["id"]]
        days = max((i.get("days_overdue") or 0 for i in case_invs), default=0)
        broken = [p for p in ev.get("promises", []) if p.get("status") in ("broken", "part_kept")]
        reasons = []
        if days:
            reasons.append(f"{days} days overdue")
        if broken:
            reasons.append(f"{len(broken)} broken promise{'s' if len(broken) > 1 else ''}")
        if _m(ev["totals"]["interest"]) > 0:
            reasons.append(f"{_inr(_m(ev['totals']['interest']))} interest so far")
        if na.get("action") == "await_promise":
            reasons.append("a promise is still in time")
        if any(i.get("status") == "disputed" for i in case_invs) or na.get("action") == "resolve_dispute":
            reasons.append("dispute to resolve first")
        # Bigger, older and broken-promise cases first; cases waiting on a live promise later.
        score = total * (Decimal(1) + Decimal(days) / 90) * (Decimal("1.5") if broken else Decimal(1))
        if na.get("action") == "await_promise":
            score /= 3
        buyer = bundle["buyers"].get(case["buyer_id"], {})
        chase.append({"case_id": case["id"], "buyer_name": buyer.get("name"), "amount": str(total),
                      "days_overdue": days, "reasons": reasons, "next_action": na.get("label"),
                      "next_action_id": na.get("action"), "score": score})
    chase.sort(key=lambda c: c["score"], reverse=True)
    for c in chase:
        c.pop("score")

    s = lambda x: str(x.quantize(Decimal("0.01")))   # noqa: E731
    return {
        "as_of": as_of.isoformat(),
        "totals": {"owed_now": s(owed_now), "overdue_invoices": overdue_count,
                   "interest_so_far": s(interest), "due_next_30_days": s(due_30),
                   "promised_next_30_days": s(promised_30)},
        "weeks": [{**w, "due": s(w["due"]), "promised": s(w["promised"])} for w in week_rows],
        "overdue_by_age": [{**a, "amount": s(a["amount"])} for a in ages],
        "chase_first": chase[:5],
        "note": "Based on legal due dates and the buyer's own promises, not a forecast of when buyers will pay.",
    }
