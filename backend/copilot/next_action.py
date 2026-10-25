"""Next-action engine: one recommended step, with reasons, the facts it used, and the
alternatives. Ordered rules; the first rule that applies wins. No AI.

The owner always chooses. The engine never sends anything.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from .promises import PromiseStatus
from .reconcile import EVIDENCE_LABELS, Finding, Readiness

LADDER = {
    1: ("nudge", "Send a friendly nudge"),
    2: ("firm", "Send a firm reminder"),
    3: ("demand", "Send a formal demand"),
    4: ("odr", "Prepare the ODR filing pack"),
}


@dataclass
class Alternative:
    action: str
    label: str
    tradeoff: str


@dataclass
class NextAction:
    action: str                 # stable id for the frontend
    label: str
    ladder_step: int | None     # 1-4 when the action is a ladder step
    draft_kind: str | None      # nudge | firm | demand | acceptance_confirm | None
    reasons: list[str]
    based_on: list[str]         # fact/evidence references, same format as findings
    alternatives: list[Alternative] = field(default_factory=list)
    caution: str | None = None
    rule: str = ""              # which rule fired, for tests and the "why" panel


@dataclass
class Followup:
    step: int                   # 1 nudge, 2 firm, 3 demand
    sent_on: date
    reply_received: bool = False


def _alternatives(level: int, allowed_max: int) -> list[Alternative]:
    trade = {
        1: "Gentlest; keeps goodwill but may be ignored again.",
        2: "States the due date and interest; still polite.",
        3: "Cites ss.15 and 16 with an interest statement; signals you are ready to file.",
        4: "Files with the Facilitation Council; the relationship may not survive it.",
    }
    return [Alternative(LADDER[s][0], LADDER[s][1], trade[s])
            for s in range(1, allowed_max + 1) if s != level]


def recommend(
    as_of: date,
    eligibility_verdict: str,
    findings: list[Finding],
    readiness: Readiness,
    invoices: list[dict],            # evaluate output: number, status, due.last_day_to_pay, principal_outstanding
    total_outstanding: Decimal,
    promises: list[PromiseStatus],
    followups: list[Followup],
    importance: str | None,          # low | medium | high
) -> NextAction:
    ids = {f.id: f for f in findings}

    if total_outstanding <= 0:
        return NextAction("close_case", "Mark the case settled", None, None,
                          ["Nothing is outstanding on any invoice."], [], rule="R0-nothing-owed")

    # R1: a dispute comes before any payment request
    for fid in ("buyer_dispute", "objection_unresolved"):
        if fid in ids:
            return NextAction(
                "resolve_dispute", "Resolve the buyer's dispute first", None, None,
                [ids[fid].message, "Asking for payment now would harden the dispute and "
                 "the buyer can raise it later as a counter-claim."],
                ids[fid].sources, caution=ids[fid].fix, rule="R1-dispute")

    # R2: facts missing for the calculation
    if "delivery_date_missing" in ids:
        f = ids["delivery_date_missing"]
        return NextAction("complete_facts", "Add the missing delivery date", None, None,
                          [f.message], f.sources, caution=f.fix, rule="R2-missing-facts")

    # Days overdue across invoices that still have money owed
    overdue_days = 0
    for inv in invoices:
        last = (inv.get("due") or {}).get("last_day_to_pay")
        if last and Decimal(str(inv.get("principal_outstanding", "0"))) > 0:
            overdue_days = max(overdue_days, (as_of - date.fromisoformat(last)).days)

    # R3a: every invoice is paid, but late: only the s.16 interest is still owed
    principal_left = sum((Decimal(str(i.get("principal_outstanding", "0"))) for i in invoices),
                         Decimal("0"))
    if principal_left <= 0 and total_outstanding > 0:
        return NextAction(
            "claim_interest", "Ask for the statutory interest", 2, "firm",
            [f"Every invoice has been paid, but after its due date: interest of "
             f"Rs {total_outstanding:,.2f} under Section 16 is still owed.",
             "Many suppliers waive this to keep the customer. You can claim it, or use it "
             "as a bargaining point (see the settlement options)."],
            [], alternatives=_alternatives(2, 3), rule="R3a-interest-only")

    # R3: nothing overdue yet
    if overdue_days <= 0:
        nearest = min((date.fromisoformat(i["due"]["last_day_to_pay"]) for i in invoices
                       if i.get("due") and i["due"].get("last_day_to_pay")), default=None)
        reasons = ["No invoice is past its due date yet."]
        if nearest:
            reasons.append(f"Earliest due date is {nearest:%d %b %Y}; a courtesy reminder "
                           f"around {nearest - timedelta(days=3):%d %b} is enough.")
        return NextAction("wait_until_due", "Wait until the due date", None, None, reasons,
                          [], rule="R3-not-due")

    broken = [p for p in promises if p.status in ("broken", "part_kept")]
    pending = [p for p in promises if p.status == "pending"]

    # R4: an open promise is still in time
    if pending and not broken:
        p = min(pending, key=lambda x: x.due_date)
        return NextAction(
            "await_promise", f"Wait for the promised payment due {p.due_date:%d %b %Y}", None,
            None,
            [f"The buyer promised Rs {p.amount:,.2f} by {p.due_date:%d %b %Y}, which has not "
             "passed yet.",
             f"A short reminder on {p.due_date - timedelta(days=1):%d %b} keeps the promise "
             "visible without pressure."],
            [f"promise:{p.promise_id}"], rule="R4-promise-pending")

    # R5: the paperwork disagrees with itself
    if "po_amount_exceeded" in ids:
        f = ids["po_amount_exceeded"]
        return NextAction("fix_mismatch", "Sort out the PO and invoice mismatch first", None,
                          None, [f.message, "A buyer can use the mismatch to delay payment."],
                          f.sources, caution=f.fix, rule="R5-mismatch")

    # R6: no proof of delivery and nothing sent yet: build evidence gently
    if "delivery_proof_missing" in ids and not followups:
        f = ids["delivery_proof_missing"]
        return NextAction(
            "confirm_receipt", "Ask the buyer to confirm receipt", None, "acceptance_confirm",
            [f.message, "A friendly confirmation request doubles as a first reminder and "
             "creates written evidence of delivery."],
            f.sources, alternatives=_alternatives(0, 2), rule="R6-confirm-receipt")

    # Escalation level from history, promises and relationship
    reasons: list[str] = []
    based_on: list[str] = []
    level = 1
    if importance in ("low", "medium") and overdue_days > 30:
        level = 2
        reasons.append(f"Overdue {overdue_days} days and the customer is not marked "
                       "high-importance.")
    elif importance == "high":
        reasons.append("Customer marked high-importance, so the gentlest effective step "
                       "is preferred.")
    last = max(followups, key=lambda x: x.sent_on) if followups else None
    unanswered = [x for x in followups if not x.reply_received]
    if last:
        nxt = min(last.step if last.reply_received else last.step + 1, 3)  # 4 only via R-15d
        if nxt > level:
            level = nxt
        reasons.append(f"Last follow-up: {LADDER[last.step][1].lower().replace('send a ', '')} "
                       f"on {last.sent_on:%d %b %Y}, "
                       f"{'buyer replied' if last.reply_received else 'no reply'}.")
        based_on.append(f"followup:{last.sent_on.isoformat()}")
    if broken:
        level = max(level, 3 if len(broken) >= 2 else 2)
        p = broken[-1]
        reasons.append(f"{len(broken)} payment promise{'s' if len(broken) > 1 else ''} "
                       f"broken; latest was Rs {p.amount:,.2f} due {p.due_date:%d %b %Y} "
                       f"(received Rs {p.received:,.2f}).")
        based_on += [f"promise:{b.promise_id}" for b in broken]
    if len(unanswered) >= 2:
        level = max(level, 3)
        reasons.append(f"{len(unanswered)} follow-ups have had no reply.")
    if last and last.step >= 3 and not last.reply_received and (as_of - last.sent_on).days >= 15:
        level = 4
        reasons.append("A formal demand has gone unanswered for 15 days or more.")
    reasons.insert(0, f"Payment is {overdue_days} days overdue.")

    # Caps: legal steps only when the Act clearly applies and the file is ready
    caution = None
    allowed_max = 4
    if eligibility_verdict != "eligible":
        allowed_max = 2
        if level > 2:
            caution = ("A formal demand under the MSMED Act is not recommended: eligibility is "
                       + ("legally unsettled" if eligibility_verdict == "uncertain"
                          else "not met") + ". Consult a professional before legal steps.")
        level = min(level, 2)
    if level == 4 and not readiness.odr_ready:
        missing = ", ".join(EVIDENCE_LABELS[k].lower() for k in readiness.missing) or \
            "fix the blocking findings"
        return NextAction(
            "collect_evidence", "Collect the documents ODR needs before filing", None, None,
            reasons + [f"Missing: {missing}."],
            based_on + [f"evidence:{k}" for k in readiness.missing],
            alternatives=_alternatives(3, 3), rule="R7-escalate-not-ready")

    kind, label = LADDER[level]
    return NextAction(
        kind if level < 4 else "prepare_odr", label, level,
        kind if level < 4 else None, reasons, based_on,
        alternatives=_alternatives(level, allowed_max), caution=caution,
        rule=f"R8-ladder-{level}")
