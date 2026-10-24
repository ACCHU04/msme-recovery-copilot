"""Expected values below were worked out by hand with plain arithmetic,
not by running the engine. Bank Rate 5.50% -> s.16 rate 16.5%;
5.75% (from 7 Oct 2026) -> 17.25%.
"""
from datetime import date
from decimal import Decimal as D

import pytest

from recovery_engine import (
    AcceptanceStatus, Payment, RateUnavailable, Verdict,
    check_eligibility, compute_due_date, compute_interest, settlement_options,
)

P = D("100000")


# ---------------------------------------------------------------- due dates
class TestDueDate:
    def test_no_credit_period_uses_appointed_day(self):
        r = compute_due_date(delivery_date=date(2026, 1, 1))
        assert r.acceptance_status == AcceptanceStatus.DEEMED
        assert r.acceptance_date == date(2026, 1, 1)
        assert r.last_day_to_pay == date(2026, 1, 16)    # X + 15
        assert r.interest_start == date(2026, 1, 17)     # appointed day X + 16

    def test_agreed_30_days_within_cap(self):
        r = compute_due_date(date(2026, 1, 1), agreed_due_date=date(2026, 1, 31))
        assert r.last_day_to_pay == date(2026, 1, 31)
        assert r.interest_start == date(2026, 2, 1)

    def test_agreed_60_days_capped_at_45(self):
        r = compute_due_date(date(2026, 1, 1), agreed_due_date=date(2026, 3, 2))
        assert r.last_day_to_pay == date(2026, 2, 15)    # X + 45
        assert r.interest_start == date(2026, 2, 16)
        assert "MSMED-15-45day-cap" in r.rule_ids

    def test_objection_within_15_days_removed(self):
        r = compute_due_date(date(2026, 1, 1), objection_date=date(2026, 1, 10),
                             objection_removed_date=date(2026, 1, 20))
        assert r.acceptance_status == AcceptanceStatus.OBJECTION_REMOVED
        assert r.acceptance_date == date(2026, 1, 20)
        assert r.interest_start == date(2026, 2, 5)

    def test_objection_not_removed_blocks_interest(self):
        r = compute_due_date(date(2026, 1, 1), objection_date=date(2026, 1, 10))
        assert r.acceptance_status == AcceptanceStatus.DISPUTED
        assert r.interest_start is None

    def test_objection_on_day_15_still_counts(self):
        r = compute_due_date(date(2026, 1, 1), objection_date=date(2026, 1, 16))
        assert r.acceptance_status == AcceptanceStatus.DISPUTED

    def test_late_objection_ignored_with_warning(self):
        r = compute_due_date(date(2026, 1, 1), objection_date=date(2026, 1, 17))
        assert r.acceptance_status == AcceptanceStatus.DEEMED
        assert r.warnings

    def test_objection_before_delivery_rejected(self):
        with pytest.raises(ValueError):
            compute_due_date(date(2026, 1, 10), objection_date=date(2026, 1, 5))


# ---------------------------------------------------------------- interest
class TestInterest:
    def test_one_full_month(self):
        r = compute_interest(P, date(2026, 2, 1), as_of=date(2026, 3, 1))
        assert r.interest_outstanding == D("1265.75")    # 100000 x 16.5% x 28/365
        assert r.total_outstanding == D("101265.75")

    def test_monthly_compounding(self):
        r = compute_interest(P, date(2026, 2, 1), as_of=date(2026, 4, 1))
        assert [row.interest for row in r.schedule] == [D("1265.75"), D("1419.11")]
        assert r.interest_outstanding == D("2684.86")    # month 2 charged on 101265.75

    def test_bank_rate_change_mid_period(self):
        r = compute_interest(P, date(2026, 9, 20), as_of=date(2026, 10, 20))
        assert r.interest_outstanding == D("1382.88")    # 17 days @16.5% + 13 days @17.25%
        assert len(r.schedule[0].rates_pct) == 2

    def test_paid_in_full_before_due(self):
        r = compute_interest(P, date(2026, 2, 1), date(2026, 5, 1),
                             [Payment(date(2026, 1, 20), P)])
        assert r.total_outstanding == D("0.00")

    def test_partial_payment_before_due_reduces_principal(self):
        r = compute_interest(P, date(2026, 2, 1), date(2026, 3, 1),
                             [Payment(date(2026, 1, 20), D("40000"))])
        assert r.principal_outstanding == D("60000.00")
        assert r.interest_outstanding == D("759.45")     # 60000 x 16.5% x 28/365

    def test_late_full_principal_leaves_interest(self):
        r = compute_interest(P, date(2026, 2, 1), date(2026, 3, 1),
                             [Payment(date(2026, 2, 15), P)],
                             allocation="principal_first")
        assert r.principal_outstanding == D("0.00")
        assert r.interest_outstanding == D("632.88")     # 14 days on 100000

    def test_allocation_choice_changes_result(self):
        pays = [Payment(date(2026, 3, 1), D("50000"))]
        a = compute_interest(P, date(2026, 2, 1), date(2026, 4, 1), pays, "interest_first")
        b = compute_interest(P, date(2026, 2, 1), date(2026, 4, 1), pays, "principal_first")
        # Payment ON a monthly rest date: nothing is accrued-but-uncapitalised, and
        # capitalised interest compounds like principal (A8), so only the split changes.
        assert a.principal_outstanding > b.principal_outstanding
        assert a.interest_outstanding < b.interest_outstanding
        assert a.total_outstanding == b.total_outstanding

    def test_allocation_mid_period_changes_total_slightly(self):
        # Payment BETWEEN rests: interest accrued since the last rest is not yet
        # interest-bearing. Principal-first removes interest-bearing money sooner,
        # so its total is a little lower. Demo invoice INV-114 values.
        pays = [Payment(date(2026, 6, 1), D("50000"))]
        a = compute_interest(D("180000"), date(2026, 3, 26), date(2026, 10, 25), pays,
                             "interest_first")
        b = compute_interest(D("180000"), date(2026, 3, 26), date(2026, 10, 25), pays,
                             "principal_first")
        assert a.total_outstanding == D("144734.20")
        assert b.total_outstanding == D("144728.22")

    def test_valuation_before_interest_start(self):
        r = compute_interest(P, date(2026, 2, 1), as_of=date(2026, 1, 25))
        assert r.interest_outstanding == D("0.00")
        assert r.principal_outstanding == P

    def test_month_end_rest_dates(self):
        r = compute_interest(P, date(2026, 1, 31), as_of=date(2026, 4, 30))
        assert [row.period_end for row in r.schedule] == [
            date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]

    def test_no_verified_rate_raises(self):
        with pytest.raises(RateUnavailable):
            compute_interest(P, date(2025, 6, 1), as_of=date(2025, 7, 1))

    @pytest.mark.parametrize("kwargs", [
        dict(principal=D("0")),
        dict(principal=D("-5")),
        dict(allocation="random"),
    ])
    def test_bad_inputs(self, kwargs):
        args = dict(principal=P, interest_start=date(2026, 2, 1), as_of=date(2026, 3, 1))
        args.update(kwargs)
        with pytest.raises(ValueError):
            compute_interest(**args)

    def test_negative_or_future_payment_rejected(self):
        with pytest.raises(ValueError):
            compute_interest(P, date(2026, 2, 1), date(2026, 3, 1),
                             [Payment(date(2026, 2, 10), D("-1"))])
        with pytest.raises(ValueError):
            compute_interest(P, date(2026, 2, 1), date(2026, 3, 1),
                             [Payment(date(2026, 3, 5), D("100"))])

    def test_overpayment_warns(self):
        r = compute_interest(P, date(2026, 2, 1), date(2026, 3, 1),
                             [Payment(date(2026, 1, 10), D("150000"))])
        assert r.total_outstanding == D("0.00")
        assert any("Overpayment" in w for w in r.warnings)

    def test_assumptions_always_listed(self):
        r = compute_interest(P, date(2026, 2, 1), date(2026, 3, 1))
        assert any(a.startswith("A6") for a in r.assumptions)


# ---------------------------------------------------------------- eligibility
class TestEligibility:
    def ok(self, **over):
        args = dict(size="micro", activity="manufacturing", udyam_registered=True,
                    udyam_registration_date=date(2023, 5, 1), contract_date=date(2026, 1, 1))
        args.update(over)
        return check_eligibility(**args)

    def test_eligible(self):
        assert self.ok().verdict == Verdict.ELIGIBLE

    def test_medium_not_eligible(self):
        assert self.ok(size="medium").verdict == Verdict.NOT_ELIGIBLE

    def test_trader_not_eligible(self):
        assert self.ok(activity="trader").verdict == Verdict.NOT_ELIGIBLE

    def test_unregistered_not_eligible(self):
        assert self.ok(udyam_registered=False).verdict == Verdict.NOT_ELIGIBLE

    def test_registered_after_contract_is_uncertain(self):
        r = self.ok(udyam_registration_date=date(2026, 3, 1))
        assert r.verdict == Verdict.UNCERTAIN
        assert "SC-NBCC-2025-reference" in r.rule_ids

    def test_missing_facts_uncertain(self):
        assert self.ok(udyam_registration_date=None).verdict == Verdict.UNCERTAIN

    def test_reminders_always_available(self):
        assert any("reminders" in s for s in self.ok(activity="trader").still_available)


# ---------------------------------------------------------------- settlement
def test_settlement_options():
    r = compute_interest(P, date(2026, 2, 1), date(2026, 3, 1))
    full, half, none = settlement_options(r)
    assert full.amount_requested == D("101265.75")
    assert half.amount_forgone == D("632.88")            # half of 1265.75, rounded
    assert none.amount_requested == D("100000.00")
