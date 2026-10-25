"""Automated reminder scheduling & notification digests for MSME suppliers (C1).

Sends email alerts to the supplier via Resend for:
  - Invoices approaching their legal due date (<= 3 days)
  - Invoices newly overdue (s.16 compound interest accruing)
  - Buyer promises due today/tomorrow
  - Broken buyer promises needing escalation

The app never messages the buyer directly without supplier initiation.
"""
from __future__ import annotations

import os
from datetime import date
from decimal import Decimal
from typing import Any

import httpx

from .drafts import _inr
from .evaluate import evaluate_case, load_business_bundle
from .invoices import list_invoices
from .store import Store

RESEND_ENDPOINT = "https://api.resend.com/emails"
DEFAULT_SENDER = os.getenv("RESEND_FROM", "onboarding@resend.dev")


def send_resend_email(api_key: str, to: str, subject: str, html: str,
                      from_addr: str = DEFAULT_SENDER) -> dict[str, Any]:
    """Dispatch an email via Resend."""
    if not api_key:
        raise ValueError("RESEND_API_KEY is not configured.")
    resp = httpx.post(
        RESEND_ENDPOINT,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"from": from_addr, "to": [to], "subject": subject, "html": html},
        timeout=15.0,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Resend delivery failed ({resp.status_code}): {resp.text}")
    return resp.json()


def find_supplier_reminders(store: Store, business_id: str, as_of: date | None = None) -> list[dict[str, Any]]:
    """Scan active cases and invoices for reminders that need the supplier's attention today."""
    as_of = as_of or date.today()
    bundle = load_business_bundle(store, business_id)
    invoices = list_invoices(store, business_id, as_of, bundle=bundle)
    reminders: list[dict[str, Any]] = []

    # 1. Invoices approaching statutory due date (3 days or fewer)
    for inv in invoices:
        unpaid = Decimal(str(inv.get("unpaid") or "0"))
        if unpaid <= 0:
            continue
        if inv.get("status") in ("due_soon", "not_due") and inv.get("last_day_to_pay"):
            try:
                due_dt = date.fromisoformat(str(inv["last_day_to_pay"])[:10])
                days_left = (due_dt - as_of).days
                if 0 <= days_left <= 3:
                    reminders.append({
                        "kind": "approaching_due",
                        "title": f"Invoice {inv['number']} due in {days_left} day{'s' if days_left != 1 else ''}",
                        "detail": f"Amount ₹{_inr(unpaid)} from {inv.get('buyer_name') or 'Buyer'} is due on {due_dt.isoformat()}.",
                        "invoice_id": inv["id"],
                        "case_id": inv["case_id"],
                        "due_date": due_dt.isoformat(),
                        "tone": "amber",
                    })
            except Exception:
                pass

        # 2. Invoices overdue where interest is actively accruing
        if inv.get("status") == "overdue":
            days_over = inv.get("days_overdue") or 0
            if 1 <= days_over <= 14:
                interest_amt = Decimal(str(inv.get("estimated_interest") or "0"))
                reminders.append({
                    "kind": "newly_overdue",
                    "title": f"Invoice {inv['number']} is overdue ({days_over}d) — s.16 interest accruing",
                    "detail": f"Principal: ₹{_inr(unpaid)}. Accrued interest: ₹{_inr(interest_amt)}.",
                    "invoice_id": inv["id"],
                    "case_id": inv["case_id"],
                    "due_date": inv.get("last_day_to_pay"),
                    "tone": "red",
                })

    # 3. Buyer promises: due soon or broken
    for case in bundle.get("cases", []):
        cid = case["id"]
        try:
            ev = evaluate_case(store, cid, as_of, bundle=bundle)
        except Exception:
            continue
        buyer_name = bundle.get("buyers", {}).get(case["buyer_id"], {}).get("name") or "Buyer"
        for p in ev.get("promises", []):
            p_status = p.get("status")
            if p.get("due_date"):
                try:
                    p_date = date.fromisoformat(str(p["due_date"])[:10])
                    days_diff = (p_date - as_of).days
                    amt_str = f"₹{_inr(Decimal(str(p.get('amount') or '0')))}" if p.get("amount") else "agreed payment"
                    if p_status == "pending" and 0 <= days_diff <= 1:
                        reminders.append({
                            "kind": "promise_due_soon",
                            "title": f"Promise due {'today' if days_diff == 0 else 'tomorrow'} from {buyer_name}",
                            "detail": f"{buyer_name} promised {amt_str} on {p_date.isoformat()}.",
                            "case_id": cid,
                            "promise_id": p.get("id"),
                            "due_date": p_date.isoformat(),
                            "tone": "blue",
                        })
                    elif p_status in ("broken", "part_kept") or (p_status == "pending" and days_diff < 0):
                        reminders.append({
                            "kind": "promise_broken",
                            "title": f"Promise broken: {buyer_name}",
                            "detail": f"Promise of {amt_str} due on {p_date.isoformat()} was not kept. Copilot recommends immediate followup.",
                            "case_id": cid,
                            "promise_id": p.get("id"),
                            "due_date": p_date.isoformat(),
                            "tone": "red",
                        })
                except Exception:
                    pass

    return reminders


def build_digest_html(business_name: str, reminders: list[dict[str, Any]], as_of: date) -> str:
    """Render a clean, responsive HTML email digest for the supplier."""
    items_html = ""
    for r in reminders:
        color = "#b45309" if r["tone"] == "amber" else "#b91c1c" if r["tone"] == "red" else "#1d4ed8"
        bg = "#fffbeb" if r["tone"] == "amber" else "#fef2f2" if r["tone"] == "red" else "#eff6ff"
        items_html += f"""
        <div style="margin-bottom: 12px; padding: 12px 16px; border-left: 4px solid {color}; background-color: {bg}; border-radius: 6px;">
          <strong style="color: #1e293b; font-size: 14px;">{r['title']}</strong>
          <p style="margin: 4px 0 0 0; color: #475569; font-size: 13px; line-height: 1.4;">{r['detail']}</p>
        </div>
        """
    if not items_html:
        items_html = '<p style="color: #64748b; font-size: 14px;">All invoices and promises are currently on track. No action required today.</p>'

    return f"""
    <!DOCTYPE html>
    <html>
      <head><meta charset="utf-8"><title>Settle45 Recovery Reminders</title></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; padding: 24px; margin: 0;">
        <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: #1e293b; color: #ffffff; padding: 20px 24px;">
            <h2 style="margin: 0; font-size: 18px; font-weight: 600;">Settle45 · Daily Recovery Digest</h2>
            <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 13px;">{business_name} · {as_of.strftime('%d %B %Y')}</p>
          </div>
          <div style="padding: 24px;">
            <p style="margin: 0 0 16px 0; color: #334155; font-size: 14px;">
              Here is your daily payment timeline summary under the <strong>MSMED Act, 2006</strong>:
            </p>
            {items_html}
            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center;">
              <a href="http://localhost:3000" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 13px; padding: 10px 20px; border-radius: 6px;">
                Open Recovery Copilot
              </a>
            </div>
          </div>
          <div style="background: #f1f5f9; padding: 12px 24px; color: #64748b; font-size: 11px; text-align: center;">
            Estimates under Section 15 &amp; 16 of MSMED Act. Not legal advice.
          </div>
        </div>
      </body>
    </html>
    """

