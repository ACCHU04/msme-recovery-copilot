"""Copilot logic tests: promise parsing, promise status, reconciliation, next action."""
from datetime import date
from decimal import Decimal as D

import pytest

from copilot import Followup, parse_promise, promise_statuses, recommend, reconcile
from copilot.reconcile import Readiness

FRI = date(2026, 10, 23)   # a Friday


# ---------------------------------------------------------------- parse_promise
@pytest.mark.parametrize("text,amount,due", [
    ("Will pay 50k on Friday", "50000.00", date(2026, 10, 30)),
    ("sir ₹25,000 tomorrow pakka", "25000.00", date(2026, 10, 24)),
    ("We'll clear Rs. 1.5 lakh by 5/11", "150000.00", date(2026, 11, 5)),
    ("payment of 95000 by 15 Nov", "95000.00", date(2026, 11, 15)),
    ("will transfer 40,000 in 3 days", "40000.00", date(2026, 10, 26)),
    ("balance by month end", None, date(2026, 10, 31)),
    ("Sorry for the delay, accounts is checking", None, None),
])
def test_parse_promise(text, amount, due):
    c = parse_promise(text, FRI)
    assert (str(c.amount) if c.amount else None) == amount
    assert c.due_date == due
    assert c.needs_confirmation


def test_small_numbers_are_not_amounts():
    assert parse_promise("will pay in 2 days", FRI).amount is None


# ---------------------------------------------------------------- promise_statuses
def P(id, made, due, amt):
    return {"id": id, "made_on": made, "due_date": due, "amount": D(amt)}


def test_promise_kept_late_broken_pending():
    promises = [P("a", date(2026, 7, 1), date(2026, 7, 10), "20000"),
                P("b", date(2026, 7, 15), date(2026, 7, 31), "30000"),
                P("c", date(2026, 10, 1), date(2026, 10, 30), "10000")]
    payments = [{"paid_on": date(2026, 7, 9), "amount": D("20000")},
                {"paid_on": date(2026, 8, 5), "amount": D("10000")}]
    st = {s.promise_id: s for s in promise_statuses(promises, payments, date(2026, 10, 25))}
    assert st["a"].status == "kept"
    assert st["b"].status == "part_kept" and st["b"].received == D("10000")
    assert st["c"].status == "pending"


def test_payment_before_promise_does_not_count():
    st = promise_statuses([P("a", date(2026, 7, 1), date(2026, 7, 10), "5000")],
                          [{"paid_on": date(2026, 6, 1), "amount": D("5000")}],
                          date(2026, 8, 1))
    assert st[0].status == "broken"


def test_kept_late():
    st = promise_statuses([P("a", date(2026, 7, 1), date(2026, 7, 10), "5000")],
                          [{"paid_on": date(2026, 7, 20), "amount": D("5000")}],
                          date(2026, 8, 1))
    assert st[0].status == "kept_late"


# ---------------------------------------------------------------- reconcile
BIZ = {"udyam_reg_date": "2023-05-12"}
INV = [{"number": "INV-1", "invoice_date": "2026-03-08", "amount": "180000",
        "delivery_date": "2026-03-10"}]
ALL_EVIDENCE = {k: "have" for k in ("po", "invoice", "delivery_proof", "acceptance_reply",
                                    "ledger", "communications", "udyam_cert")}


def ids(findings):
    return {f.id for f in findings}


def test_clean_case_is_odr_ready():
    f, r = reconcile({"contract_date": "2026-02-20"}, BIZ, INV, ALL_EVIDENCE, "eligible")
    assert not [x for x in f if x.severity != "info"]
    assert r.odr_ready and r.score == "5 of 5 documents ODR needs"


def test_po_mismatch_and_invoice_before_po():
    f, _ = reconcile({"contract_date": "2026-03-20", "po_amount": "150000"}, BIZ, INV,
                     ALL_EVIDENCE, "eligible")
    assert {"po_amount_exceeded", "invoice_before_po"} <= ids(f)
    assert any("case.po_amount" in x.sources for x in f)


def test_missing_delivery_and_objection_block():
    inv = [{"number": "A", "invoice_date": "2026-03-08", "amount": "1000"},
           {"number": "B", "invoice_date": "2026-03-08", "amount": "1000",
            "delivery_date": "2026-03-09", "objection_date": "2026-03-12"}]
    f, r = reconcile({}, BIZ, inv, ALL_EVIDENCE, "eligible")
    blocking = {x.id for x in f if x.severity == "blocking"}
    assert blocking == {"delivery_date_missing", "objection_unresolved"}
    assert not r.odr_ready
    assert f[0].severity == "blocking"            # sorted blocking first


def test_missing_odr_documents_and_udyam_after_po():
    ev = {**ALL_EVIDENCE, "delivery_proof": "unknown", "udyam_cert": "missing"}
    f, r = reconcile({"contract_date": "2026-02-20"}, {"udyam_reg_date": "2026-03-01"}, INV,
                     ev, "uncertain")
    assert {"udyam_after_po", "delivery_proof_missing", "odr_doc_missing:udyam_cert"} <= ids(f)
    assert r.missing == ["delivery_proof", "udyam_cert"] and not r.odr_ready


# ---------------------------------------------------------------- recommend
AS_OF = date(2026, 10, 25)
EVAL_INV = [{"number": "INV-1", "status": "computed", "principal_outstanding": "130000",
             "due": {"last_day_to_pay": "2026-03-25"}}]
READY = Readiness(True, [], [], "5 of 5")


def rec(**kw):
    args = dict(as_of=AS_OF, eligibility_verdict="eligible", findings=[], readiness=READY,
                invoices=EVAL_INV, total_outstanding=D("144734.20"), promises=[],
                followups=[], importance="high")
    args.update(kw)
    return recommend(**args)


def st(id, due, amt, status, received="0"):
    from copilot import PromiseStatus
    return PromiseStatus(id, date(2026, 9, 1), due, D(amt), D(received), status, None)


def test_first_step_for_valued_customer_is_nudge():
    a = rec()
    assert a.action == "nudge" and a.ladder_step == 1 and a.draft_kind == "nudge"
    assert "214 days overdue" in a.reasons[0]
    assert {x.action for x in a.alternatives} == {"firm", "demand", "odr"}


def test_less_important_long_overdue_starts_firm():
    assert rec(importance="medium").action == "firm"


def test_pending_promise_means_wait():
    a = rec(promises=[st("p1", date(2026, 10, 30), "50000", "pending")])
    assert a.action == "await_promise" and "promise:p1" in a.based_on


def test_broken_promise_escalates_to_firm_and_cites_it():
    a = rec(promises=[st("p1", date(2026, 10, 23), "50000", "broken")])
    assert a.action == "firm" and any("broken" in r for r in a.reasons)


def test_two_broken_promises_formal_demand():
    a = rec(promises=[st("p1", date(2026, 9, 10), "20000", "broken"),
                      st("p2", date(2026, 10, 23), "50000", "part_kept", "10000")])
    assert a.action == "demand"


def test_unanswered_demand_after_15_days_goes_to_odr():
    a = rec(followups=[Followup(1, date(2026, 8, 1)), Followup(2, date(2026, 9, 1)),
                       Followup(3, date(2026, 10, 1))])
    assert a.action == "prepare_odr" and a.ladder_step == 4


def test_odr_blocked_when_documents_missing():
    a = rec(followups=[Followup(3, date(2026, 10, 1))],
            readiness=Readiness(False, [], ["udyam_cert"], "4 of 5"))
    assert a.action == "collect_evidence" and "evidence:udyam_cert" in a.based_on


def test_uncertain_eligibility_caps_at_firm_with_caution():
    a = rec(eligibility_verdict="uncertain",
            promises=[st("p1", date(2026, 9, 10), "1", "broken"),
                      st("p2", date(2026, 10, 1), "1", "broken")])
    assert a.action == "firm" and "legally unsettled" in a.caution
    assert {x.action for x in a.alternatives} == {"nudge"}


def test_dispute_beats_everything():
    f, r = reconcile({"dispute_reason": "quality"}, BIZ, INV, ALL_EVIDENCE, "eligible")
    a = rec(findings=f, readiness=r,
            promises=[st("p1", date(2026, 9, 10), "1", "broken")])
    assert a.action == "resolve_dispute" and a.rule == "R1-dispute"


def test_mismatch_before_follow_up():
    f, r = reconcile({"po_amount": "100000"}, BIZ, INV, ALL_EVIDENCE, "eligible")
    assert rec(findings=f, readiness=r).action == "fix_mismatch"


def test_no_delivery_proof_and_no_follow_ups_confirm_receipt():
    f, r = reconcile({}, BIZ, INV, {**ALL_EVIDENCE, "delivery_proof": "unknown"}, "eligible")
    a = rec(findings=f, readiness=r)
    assert a.action == "confirm_receipt" and a.draft_kind == "acceptance_confirm"


def test_not_yet_due_and_nothing_owed():
    not_due = [{**EVAL_INV[0], "due": {"last_day_to_pay": "2026-11-05"}}]
    assert rec(invoices=not_due).action == "wait_until_due"
    assert rec(total_outstanding=D("0")).action == "close_case"


def test_reply_received_holds_level():
    a = rec(followups=[Followup(2, date(2026, 10, 10), reply_received=True)])
    assert a.action == "firm"


def test_paid_late_interest_only_claim_interest():
    inv = [{**EVAL_INV[0], "principal_outstanding": "0.00", "due": {"last_day_to_pay": "2026-06-01"}}]
    a = rec(invoices=inv, total_outstanding=D("12500.00"))
    assert a.action == "claim_interest"
    assert a.rule == "R3-interest-only"
    assert "Ask for the statutory interest" in a.label
