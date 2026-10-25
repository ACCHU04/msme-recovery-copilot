"""C1: reminders. A daily list of things that need the owner's attention, worked out from facts
already in the app: invoices about to fall due or just overdue, buyer promises due soon or
broken, and follow-ups with no reply. Nothing here predicts behaviour.

Each reminder has a stable key so the owner can dismiss it; a dismissed key stays hidden.
Email is optional: it is sent only when an email service key is set on the server."""
from __future__ import annotations

import os
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import httpx

from recovery_engine.due_date import human

from .drafts import _inr
from .evaluate import evaluate_case, load_business_bundle
from .invoices import list_invoices
from .store import Store

DUE_SOON_DAYS = 7          # last day to pay within the next week
JUST_OVERDUE_DAYS = 7      # became overdue in the last week
PROMISE_SOON_DAYS = 3      # buyer's promised date within 3 days
BROKEN_LOOKBACK_DAYS = 30  # broken promises from the last month
NO_REPLY_DAYS = 7          # follow-up sent this long ago with no reply

SEVERITY_ORDER = {"high": 0, "warn": 1, "info": 2}


def _m(v: Any) -> Decimal:
    return Decimal(str(v)) if v not in (None, "") else Decimal("0")


def _d(v: Any) -> date:
    return v if isinstance(v, date) else date.fromisoformat(str(v)[:10])


def build_reminders(store: Store, business_id: str, as_of: date | None = None,
                    dismissed: set[str] | None = None) -> list[dict]:
    as_of = as_of or date.today()
    dismissed = dismissed or set()
    bundle = load_business_bundle(store, business_id)
    out: list[dict] = []

    def add(key: str, kind: str, severity: str, title: str, detail: str, *, when: date,
            case_id: str, invoice_id: str | None = None):
        if key in dismissed:
            return
        link = f"/invoices/{invoice_id}" if invoice_id else f"/cases/{case_id}"
        out.append({"key": key, "kind": kind, "severity": severity, "title": title, "detail": detail,
                    "date": when.isoformat(), "case_id": case_id, "invoice_id": invoice_id, "link": link})

    for inv in list_invoices(store, business_id, as_of, bundle=bundle):
        unpaid = _m(inv.get("unpaid"))
        if unpaid <= 0 or not inv.get("last_day_to_pay") or inv.get("status") in ("disputed", "partly_disputed"):
            continue
        last = _d(inv["last_day_to_pay"])
        who = inv.get("buyer_name") or "Buyer"
        if as_of <= last <= as_of + timedelta(days=DUE_SOON_DAYS):
            days = (last - as_of).days
            add(f"due_soon:{inv['id']}:{last}", "due_soon", "info",
                f"{inv['number']} falls due {'today' if days == 0 else f'in {days} day' + ('s' if days > 1 else '')}",
                f"{who} must pay {_inr(unpaid)} by {human(last)}. A gentle reminder now often avoids a delay.",
                when=last, case_id=inv["case_id"], invoice_id=inv["id"])
        elif as_of - timedelta(days=JUST_OVERDUE_DAYS) <= last < as_of:
            add(f"overdue:{inv['id']}:{last}", "became_overdue", "warn",
                f"{inv['number']} is now overdue",
                f"{who} missed the last day to pay ({human(last)}). {_inr(unpaid)} is unpaid and "
                "interest under s.16 runs from the day after.",
                when=last + timedelta(days=1), case_id=inv["case_id"], invoice_id=inv["id"])

    for case in bundle["cases"]:
        if case.get("status") in ("settled", "archived") or not bundle["invoices_by_case"].get(case["id"]):
            continue
        who = bundle["buyers"].get(case["buyer_id"], {}).get("name") or "Buyer"
        try:
            ev = evaluate_case(store, case["id"], as_of, bundle=bundle)
        except ValueError:
            continue
        for p in ev.get("promises", []):
            due = _d(p["due_date"])
            amt = _inr(_m(p.get("amount")))
            if p.get("status") == "pending" and as_of <= due <= as_of + timedelta(days=PROMISE_SOON_DAYS):
                add(f"promise_due:{p['promise_id']}", "promise_due", "info",
                    f"{who} promised {amt} by {human(due)}",
                    "Check your bank on that day. If it has not arrived, the next step will be suggested.",
                    when=due, case_id=case["id"])
            elif p.get("status") in ("broken", "part_kept") and as_of - due <= timedelta(days=BROKEN_LOOKBACK_DAYS):
                got = _m(p.get("received"))
                detail = (f"Only {_inr(got)} of {amt} arrived by {human(due)}." if got > 0
                          else f"Nothing arrived by {human(due)}.")
                add(f"promise_broken:{p['promise_id']}", "promise_broken", "high",
                    f"{who} broke a payment promise", detail + " Record it and send the next follow-up.",
                    when=due + timedelta(days=1), case_id=case["id"])
        if _m(ev["totals"]["total"]) <= 0:
            continue
        fus = bundle["followups_by_case"].get(case["id"], [])
        if fus:
            last = max(fus, key=lambda f: str(f.get("sent_on")))
            sent = _d(last["sent_on"])
            if not last.get("reply_received") and (as_of - sent).days >= NO_REPLY_DAYS:
                add(f"no_reply:{last['id']}", "no_reply", "warn",
                    f"No reply from {who} for {(as_of - sent).days} days",
                    f"Your follow-up on {human(sent)} has had no reply. Open the case for the next step.",
                    when=sent + timedelta(days=NO_REPLY_DAYS), case_id=case["id"])

    out.sort(key=lambda r: (SEVERITY_ORDER[r["severity"]], r["date"]))
    return out


# ---------------------------------------------------------------- optional email
def email_configured() -> bool:
    return bool(os.getenv("RESEND_API_KEY") and os.getenv("REMINDER_FROM_EMAIL"))


def digest_text(business_name: str, items: list[dict], as_of: date) -> str:
    lines = [f"Settle45 reminders for {business_name}, {human(as_of)}", ""]
    for r in items:
        lines += [f"- {r['title']}", f"  {r['detail']}", ""]
    lines.append("Open Settle45 to act on these. This is an automatic reminder, not legal advice.")
    return "\n".join(lines)


def send_digest(to: str, business_name: str, items: list[dict], as_of: date) -> None:
    """Sends one plain-text email through Resend. Raises RuntimeError on failure."""
    r = httpx.post("https://api.resend.com/emails", timeout=10,
                   headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}"},
                   json={"from": os.environ["REMINDER_FROM_EMAIL"], "to": [to],
                         "subject": f"Settle45: {len(items)} payment reminder{'s' if len(items) != 1 else ''}",
                         "text": digest_text(business_name, items, as_of)})
    if r.status_code >= 300:
        raise RuntimeError(f"Email service returned {r.status_code}")
