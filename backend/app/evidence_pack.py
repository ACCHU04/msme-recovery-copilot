"""Evidence pack: one PDF per recovery case for an adviser, the buyer's management or the
MSME Facilitation Council (ODR portal). Every figure comes from the calculation engine.
Labelled 'Draft for review': it organises the supplier's own records, it is not legal advice.

Uses ReportLab's built-in fonts so it works on any server; amounts are written 'Rs'.
"""
from __future__ import annotations

import io
from datetime import date
from decimal import Decimal
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle)
from xml.sax.saxutils import escape

from recovery_engine.due_date import human

from .drafts import _inr
from .schemas import EVIDENCE_KINDS

NAVY = colors.HexColor("#0b2a5b")
LINE = colors.HexColor("#dbe2ec")
SOFT = colors.HexColor("#f3f6fb")

EVIDENCE_LABEL = {
    "po": "Purchase order", "invoice": "Invoice copies", "delivery_proof": "Delivery proof (challan / e-way bill)",
    "acceptance_reply": "Buyer's written acceptance", "ledger": "Ledger extract",
    "communications": "Emails and chats", "udyam_cert": "Udyam certificate",
}
EVIDENCE_STATUS = {"have": "On file", "missing": "Missing", "unknown": "Not sure"}
BLOCKER_REASON = {
    "po_missing": "PO number missing", "grn_not_entered": "Goods receipt not entered",
    "amount_mismatch": "Amount or GST mismatch", "quality_dispute": "Quality dispute",
    "waiting_approval": "Waiting for approval", "other": "Other",
}
SOURCE = {"buyer_said": "buyer said", "documented": "documented", "not_verified": "not verified"}


def _styles():
    ss = getSampleStyleSheet()
    base = ParagraphStyle("b", parent=ss["Normal"], fontName="Helvetica", fontSize=9, leading=12)
    return {
        "title": ParagraphStyle("t", parent=base, fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=NAVY),
        "h": ParagraphStyle("h", parent=base, fontName="Helvetica-Bold", fontSize=12.5, leading=16,
                            textColor=NAVY, spaceBefore=10, spaceAfter=4),
        "b": base,
        "small": ParagraphStyle("s", parent=base, fontSize=7.5, leading=10, textColor=colors.HexColor("#5b6678")),
        "cell": ParagraphStyle("c", parent=base, fontSize=8, leading=10),
        "num": ParagraphStyle("n", parent=base, fontSize=8, leading=10, alignment=TA_RIGHT),
        "mono": ParagraphStyle("m", parent=base, fontName="Courier", fontSize=6.5, leading=8),
        "banner": ParagraphStyle("bn", parent=base, fontName="Helvetica-Bold", fontSize=9, textColor=colors.HexColor("#9a5b00")),
    }


def _d(v: Any) -> str:
    if not v:
        return "—"
    try:
        return human(v if isinstance(v, date) else date.fromisoformat(str(v)[:10]))
    except ValueError:
        return str(v)


def _table(rows: list[list[Any]], widths: list[float], st: dict, header: bool = True, num_cols: tuple = ()) -> Table:
    data = []
    for r_i, row in enumerate(rows):
        cells = []
        for c_i, v in enumerate(row):
            style = st["num"] if (c_i in num_cols and (r_i > 0 or not header)) else st["cell"]
            text = escape(str(v)) if not isinstance(v, Paragraph) else v
            cells.append(text if isinstance(text, Paragraph) else Paragraph(
                f"<b>{text}</b>" if header and r_i == 0 else text, style))
        data.append(cells)
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if header else 0)
    cmds = [("GRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    if header:
        cmds += [("BACKGROUND", (0, 0), (-1, 0), SOFT)]
    t.setStyle(TableStyle(cmds))
    return t


def build_pack(case: dict, business: dict, buyer: dict, ev: dict, *, promises: list[dict],
               followups: list[dict], blockers: list[dict], notes: dict[str, list[dict]],
               confirmations: list[dict], files: list[dict] | None = None,
               generated_on: date | None = None) -> bytes:
    st = _styles()
    generated_on = generated_on or date.today()
    buf = io.BytesIO()
    title = f"Evidence pack: {buyer.get('name', 'Buyer')}"

    def frame(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#7a8597"))
        canvas.drawString(18 * mm, 10 * mm, f"Settle45 · {business.get('name', '')} · DRAFT FOR REVIEW, not legal advice")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=16 * mm, bottomMargin=18 * mm, title=title, author=business.get("name") or "")
    S: list[Any] = []
    P = lambda text, s="b": Paragraph(text, st[s])   # noqa: E731
    E = escape

    # ---- cover / summary
    S += [P(E(title), "title"), Spacer(1, 3 * mm),
          P(f"Prepared from the records of <b>{E(business.get('name') or '')}</b> on {_d(generated_on)}. "
            f"Figures as of {_d(ev['as_of'])}."),
          Spacer(1, 2 * mm),
          P("DRAFT FOR REVIEW: estimates depend on the dates and documents entered. Have a professional "
            "check it before relying on it.", "banner"), Spacer(1, 4 * mm)]
    totals = ev["totals"]
    elig = ev["eligibility"]
    S.append(_table([
        ["Supplier", f"{business.get('name') or '—'} ({(business.get('size') or '—').title()}, {business.get('activity') or '—'})"],
        ["Udyam number", business.get("udyam_no") or "—"],
        ["Supplier GSTIN", business.get("gstin") or "—"],
        ["Buyer", f"{buyer.get('name') or '—'}{' (central public sector)' if buyer.get('is_cpse') else ''}"],
        ["Buyer GSTIN", buyer.get("gstin") or "—"],
        ["Purchase order", f"dated {_d(case.get('contract_date'))}, value {_inr(case['po_amount']) if case.get('po_amount') else '—'}"],
        ["MSMED Act eligibility", f"{elig['verdict'].replace('_', ' ').capitalize()}. {' '.join(elig.get('reasons') or [])}".strip()],
        ["Principal outstanding", _inr(totals["principal"])],
        ["Interest (s.16, estimate)", _inr(totals["interest"])],
        ["Total claimed", _inr(totals["total"])],
        ["Recommended next step", (ev.get("next_action") or {}).get("label") or "—"],
    ], [48, 126], st, header=False))

    # ---- invoices
    S.append(P("Invoices", "h"))
    rows = [["Invoice", "Amount", "Delivered", "Pay by", "Status", "Owed now"]]
    for i in ev["invoices"]:
        due = i.get("due") or {}
        owed = (i.get("interest") or {}).get("total_outstanding") or i.get("principal_outstanding")
        status = i.get("status", "").replace("_", " ")
        if i.get("status") == "partly_disputed":
            status = f"partly disputed: {_inr(i.get('disputed_outstanding'))} on hold"
        rows.append([i["number"], _inr(i["amount"]), _d(due.get("acceptance_date")),
                     _d(due.get("last_day_to_pay")), status, _inr(owed) if owed else "—"])
    S.append(_table(rows, [26, 26, 24, 24, 46, 28], st, num_cols=(1, 5)))
    for i in ev["invoices"]:
        if (i.get("due") or {}).get("basis"):
            S.append(P(f"<b>{E(i['number'])}:</b> {E(i['due']['basis'])}", "small"))

    # ---- payments
    pay_rows = [["Invoice", "Paid on", "Amount"]]
    for inv in case.get("invoices", []):
        for p in inv.get("payments", []):
            pay_rows.append([inv["number"], _d(p["paid_on"]), _inr(p["amount"])])
    S.append(P("Payments received", "h"))
    S.append(_table(pay_rows, [50, 50, 74], st, num_cols=(2,)) if len(pay_rows) > 1 else P("None recorded."))

    # ---- interest schedules
    for i in ev["invoices"]:
        sched = (i.get("interest") or {}).get("schedule") or []
        if not sched:
            continue
        rows = [["From", "To", "Opening balance", "Interest", "Paid", "Rate (3 × Bank Rate)"]]
        for r in sched:
            rows.append([_d(r["period_start"]), _d(r["period_end"]), _inr(r["opening_balance"]),
                         _inr(r["interest"]), _inr(r["payments"]), ", ".join(r.get("rates_pct") or [])])
        S.append(KeepTogether([P(f"Interest schedule: {E(i['number'])} (compound, monthly rests)", "h"),
                               _table(rows, [22, 22, 30, 24, 22, 54], st, num_cols=(2, 3, 4))]))

    # ---- evidence
    S.append(P("Evidence", "h"))
    have = {e["kind"]: e["status"] for e in case.get("evidence", [])}
    S.append(_table([["Document", "Status"]] + [[EVIDENCE_LABEL[k], EVIDENCE_STATUS.get(have.get(k, "unknown"), "Not sure")]
                                                for k in EVIDENCE_KINDS], [120, 54], st))
    answered = [c for c in confirmations if c.get("used_at")]
    if answered:
        S.append(Spacer(1, 2 * mm))
        S.append(_table([["Buyer confirmation link", "Answer", "By", "Note"]] + [
            [_d(c.get("used_at")), "Received in good order" if c.get("response") == "received_ok" else "Problem raised",
             c.get("responder_name") or "—", c.get("note") or "—"] for c in answered], [32, 40, 40, 62], st))

    if files:
        S.append(KeepTogether([
            P("Files kept with this case", "h"),
            P("Each file's SHA-256 fingerprint was recorded when it was uploaded. Anyone holding a copy "
              "can recompute it to show the file is unchanged.", "small"), Spacer(1, 1.5 * mm),
            _table([["File", "What it is", "Uploaded", "Size", "SHA-256"]] + [
                [f["file_name"], EVIDENCE_LABEL.get(f.get("kind") or "", "Other"), _d(f.get("uploaded_at")),
                 f"{max(1, round(int(f['size_bytes']) / 1024))} KB",
                 Paragraph(" ".join(f["sha256"][i:i + 16] for i in range(0, 64, 16)), st["mono"])]
                for f in files], [44, 30, 22, 14, 64], st, num_cols=(3,))]))

    # ---- promises, follow-ups, blockers
    if promises:
        head = P("Payment promises by the buyer", "h")
        S.append(KeepTogether([head, _table([["Made on", "Due", "Amount", "Status", "Buyer's words"]] + [
            [_d(p.get("made_on")), _d(p.get("due_date")), _inr(p.get("amount")), (p.get("status") or "").replace("_", " "),
             p.get("source_text") or "—"] for p in promises], [22, 22, 26, 24, 80], st, num_cols=(2,))]))
    if followups:
        head = P("Messages sent to the buyer", "h")
        step = {1: "Friendly reminder", 2: "Firm reminder", 3: "Formal demand", 4: "Filing"}
        S.append(KeepTogether([head, _table([["Sent on", "Step", "Reply", "Note"]] + [
            [_d(f.get("sent_on")), step.get(f.get("step"), str(f.get("step"))), "Yes" if f.get("reply_received") else "No",
             f.get("note") or "—"] for f in followups], [24, 34, 16, 100], st)]))
    if blockers:
        head = P("Reasons the buyer gave for not paying", "h")
        S.append(KeepTogether([head, _table([["Reported", "Reason", "Source", "Resolved", "Note"]] + [
            [_d(b.get("reported_on")), BLOCKER_REASON.get(b.get("reason"), b.get("reason") or "—"),
             SOURCE.get(b.get("source"), b.get("source") or "—"), _d(b.get("resolved_on")) if b.get("resolved_on") else "Open",
             b.get("note") or "—"] for b in blockers], [22, 36, 22, 20, 74], st)]))
    all_notes = [(inv_no, n) for inv_no, ns in notes.items() for n in ns]
    if all_notes:
        head = P("Notes", "h")
        S.append(KeepTogether([head, _table([["Invoice", "Date", "Note"]] + [
            [no, _d(n.get("created_at")), n.get("body") or ""] for no, n in sorted(all_notes, key=lambda x: str(x[1].get("created_at")))],
            [24, 24, 126], st)]))

    # ---- checks and legal basis
    findings = ev.get("findings") or []
    if findings:
        S.append(P("Points to check before relying on this pack", "h"))
        for f in findings:
            S.append(P(f"• <b>{E(f['message'])}</b> {E(f.get('fix') or '')}", "cell"))
    S += [PageBreak(), P("Legal basis", "h")]
    for line in [
        "MSMED Act, 2006, s.2(b) and s.15: the buyer must pay by the date agreed in writing, never more than 45 days "
        "after acceptance; with no written agreement, within 15 days of acceptance. Goods are deemed accepted on "
        "delivery unless the buyer objects in writing within 15 days.",
        "s.16: if payment is late, compound interest with monthly rests at three times the RBI Bank Rate is payable "
        "from the day after the due date, whatever the contract says.",
        "s.17 and s.18: the amount with interest is recoverable; either party may refer the dispute to the Micro and "
        "Small Enterprises Facilitation Council (through the MSME ODR portal).",
        "s.22 and s.23: audited buyers must disclose unpaid amounts; the s.16 interest is not a deductible expense.",
        "Income-tax Act, 1961 s.43B(h), now s.37(2)(g) of the Income-tax Act, 2025: a late payment to a micro or small "
        "enterprise is deductible for the buyer only in the year it is actually paid.",
    ]:
        S.append(P("• " + E(line)))
    assumptions = sorted({a for i in ev["invoices"] for a in ((i.get("interest") or {}).get("assumptions") or [])}
                         | {w for i in ev["invoices"] for w in ((i.get("due") or {}).get("warnings") or []) if w.startswith(("A", "ASSUMPTION"))})
    if assumptions:
        S.append(P("Assumptions used in the calculation", "h"))
        for a in assumptions:
            S.append(P("• " + E(a), "small"))
    S += [Spacer(1, 6 * mm), P(
        "This pack organises the supplier's own records and applies the MSMED Act rules to them. It is a draft "
        "for review by the supplier and their adviser, not legal advice. GSTIN and Udyam numbers are format-checked "
        "only.", "small")]
    doc.build(S, onFirstPage=frame, onLaterPages=frame)
    return buf.getvalue()
