"""Who can use MSMED Act Chapter V (ss.15-24) delayed-payment rights."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Literal


class Verdict(str, Enum):
    ELIGIBLE = "eligible"
    NOT_ELIGIBLE = "not_eligible"
    UNCERTAIN = "uncertain"   # law unsettled or facts missing: say so, never guess


@dataclass
class EligibilityResult:
    verdict: Verdict
    reasons: list[str]
    rule_ids: list[str] = field(default_factory=list)
    still_available: list[str] = field(default_factory=list)


ALWAYS_AVAILABLE = [
    "Friendly and firm payment reminders",
    "Evidence checklist and invoice record",
    "Ordinary civil recovery or the contract's own dispute clause (consult a professional)",
]


def check_eligibility(
    size: Literal["micro", "small", "medium"] | None,
    activity: Literal["manufacturing", "services", "trader"] | None,
    udyam_registered: bool | None,
    udyam_registration_date: date | None,
    contract_date: date | None,
) -> EligibilityResult:
    """contract_date: date of the purchase order / contract (or invoice date if none)."""
    if size == "medium":
        return EligibilityResult(
            Verdict.NOT_ELIGIBLE,
            ["Chapter V protects only micro and small enterprises; medium enterprises "
             "fall outside the definition of 'supplier' in s.2(n)."],
            ["MSMED-2n-supplier"], ALWAYS_AVAILABLE,
        )
    if activity == "trader":
        return EligibilityResult(
            Verdict.NOT_ELIGIBLE,
            ["Retail and wholesale traders were added to Udyam for priority sector lending "
             "only (Ministry of MSME OM dated 2 July 2021); the delayed-payment provisions "
             "do not extend to them."],
            ["MSME-OM-2021-07-02-traders"], ALWAYS_AVAILABLE,
        )
    if udyam_registered is False:
        return EligibilityResult(
            Verdict.NOT_ELIGIBLE,
            ["A 'supplier' under s.2(n) must have filed a memorandum under s.8, which today "
             "means Udyam Registration. Registering now helps with future invoices."],
            ["MSMED-2n-supplier", "MSMED-8-registration"], ALWAYS_AVAILABLE,
        )

    missing = [name for name, val in [("enterprise size", size), ("activity", activity),
                                       ("Udyam registration status", udyam_registered),
                                       ("Udyam registration date", udyam_registration_date),
                                       ("contract or invoice date", contract_date)]
               if val is None]
    if missing:
        return EligibilityResult(
            Verdict.UNCERTAIN,
            [f"Missing: {', '.join(missing)}. Eligibility cannot be confirmed yet."],
            [], ALWAYS_AVAILABLE,
        )

    if udyam_registration_date > contract_date:  # type: ignore[operator]
        return EligibilityResult(
            Verdict.UNCERTAIN,
            ["Udyam registration came after the contract date. The Supreme Court held in "
             "Silpi Industries (2021) and Mahakali Foods (2022) that the enterprise must be "
             "a supplier on the contract date, but in NBCC v. State of West Bengal (Jan 2025) "
             "the question was referred to a larger Bench. This point is legally unsettled; "
             "consult a professional before relying on Chapter V for this invoice."],
            ["SC-Silpi-2021", "SC-Mahakali-2022", "SC-NBCC-2025-reference"],
            ALWAYS_AVAILABLE,
        )

    return EligibilityResult(
        Verdict.ELIGIBLE,
        [f"{size.capitalize()} enterprise in {activity}, Udyam-registered before the "  # type: ignore[union-attr]
         "contract date."],
        ["MSMED-2n-supplier", "MSMED-8-registration"],
        ALWAYS_AVAILABLE + ["Statutory interest under s.16", "Reference to the MSE Facilitation "
                            "Council via the MSME ODR portal (odr.msme.gov.in)"],
    )
