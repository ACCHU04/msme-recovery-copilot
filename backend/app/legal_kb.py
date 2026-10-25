"""The only material the AI legal assistant may answer from.

Each entry was written and reviewed by the team from the MSMED Act, 2006 and related rules.
The model is told to answer only from these texts and to cite entry ids; app/legal_ai.py
rejects any answer that cites something else or uses a number not found in what it cites.
Keep entries short, plain and dated where facts can change.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Entry:
    id: str
    label: str        # shown as the citation chip
    title: str
    text: str
    kind: str         # "law" (statute) or "guidance" (practical, team-written)


KB: tuple[Entry, ...] = (
    Entry("s2b", "MSMED Act s.2(b)", "Appointed day and deemed acceptance",
          "The appointed day is the day after 15 days from the day the buyer accepts the goods or "
          "services, or is deemed to accept them. If the buyer raises no written objection within 15 "
          "days of delivery, the goods or services are deemed accepted on the day of delivery. A "
          "written objection within those 15 days means acceptance happens only when the objection "
          "is removed.", "law"),
    Entry("s15", "MSMED Act s.15", "When the buyer must pay",
          "The buyer must pay on or before the date agreed in writing. If nothing is agreed in writing, "
          "the buyer must pay before the appointed day. An agreed period can never be more than 45 days "
          "from the day of acceptance or deemed acceptance. A contract saying 60 or 90 days does not "
          "extend the 45-day limit.", "law"),
    Entry("s16", "MSMED Act s.16", "Interest on late payment",
          "If the buyer does not pay within the Section 15 time, it owes compound interest with monthly "
          "rests at three times the Bank Rate notified by the Reserve Bank of India, from the appointed "
          "day or the day after the agreed date. This applies notwithstanding anything in any agreement "
          "between the buyer and the supplier.", "law"),
    Entry("s17", "MSMED Act s.17", "Buyer's liability",
          "A buyer who has not paid is liable to pay the amount with interest as provided under "
          "Section 16.", "law"),
    Entry("s18", "MSMED Act s.18", "Reference to the Facilitation Council",
          "Either party may refer a dispute about any amount due under Section 17 to the Micro and Small "
          "Enterprises Facilitation Council. The Council first conducts conciliation and, if that fails, "
          "takes up the dispute for arbitration. The Council of the State where the supplier is located "
          "has jurisdiction, even if the buyer is elsewhere.", "law"),
    Entry("s2n8", "MSMED Act s.2(n), s.8", "Who is protected",
          "Only a micro or small enterprise that has registered (today, Udyam Registration) counts as a "
          "supplier. Medium enterprises are not covered. Retail and wholesale traders were added to "
          "Udyam for priority-sector lending only (Ministry of MSME office memorandum, 2 July 2021), not "
          "for these payment rights. The buyer can be any business, including another MSME. Whether a "
          "supplier that registered after the contract date can claim is legally unsettled and was "
          "referred to a larger Supreme Court bench in 2025.", "law"),
    Entry("s22", "MSMED Act s.22", "Buyer must disclose unpaid amounts",
          "A buyer whose annual accounts must be audited has to show in those accounts the principal and "
          "interest remaining unpaid to micro and small suppliers at the end of the year.", "law"),
    Entry("s23", "MSMED Act s.23", "Interest is not tax-deductible",
          "Interest the buyer pays or owes under Section 16 cannot be deducted when computing its income "
          "under the income-tax law.", "law"),
    Entry("s24", "MSMED Act s.24", "Overriding effect",
          "Sections 15 to 23 apply notwithstanding anything inconsistent in any other law.", "law"),
    Entry("it43bh", "Income-tax Act 1961 s.43B(h); Income-tax Act 2025 s.37(2)(g)",
          "Buyer's tax deduction for late payment",
          "An amount owed to a micro or small enterprise that is paid after the Section 15 time limit "
          "can be deducted by the buyer only in the year it is actually paid. This was Section 43B(h) "
          "of the Income-tax Act, 1961 from the 2023-24 year, and is Section 37(2)(g) of the Income-tax "
          "Act, 2025 from the 2026-27 tax year. Details depend on the buyer's facts; a tax professional "
          "should confirm them.", "law"),
    Entry("rates", "RBI Bank Rate (team table)", "Bank Rate used for interest",
          "The RBI Bank Rate was 5.50% from 5 December 2025 and 5.75% from 7 October 2026, so the "
          "Section 16 rate is 16.5% or 17.25% a year depending on the period. Each period of delay uses "
          "the Bank Rate in force then. The app's calculator works out exact month-by-month figures.",
          "guidance"),
    Entry("odr", "MSME ODR portal (guidance)", "How to file",
          "New delayed-payment references are filed on the MSME ODR portal (odr.msme.gov.in), the route "
          "for new references since 15 October 2025. MSME Samadhaan now covers only older cases. "
          "Speak to a professional before filing.", "guidance"),
    Entry("amend2026", "MSMED (Amendment) Act, 2026", "2026 amendment status",
          "The MSMED (Amendment) Act, 2026 adds Council timelines, recovery of awards as arrears of land "
          "revenue, and TReDS settlement for central public sector buyers. Only some parts are in force: "
          "notification S.O. 5575(E) brought several sections into force from 15 October 2026 and one "
          "from 15 December 2026, not the main dispute-timeline sections. Sections 15 and 16 are "
          "unchanged.", "guidance"),
    Entry("docs", "Evidence checklist (guidance)", "Documents for a case",
          "Useful documents: the purchase order, the invoices, proof of delivery (signed challan, e-way "
          "bill or courier record), a ledger extract of payments received, the Udyam certificate, and "
          "emails or chats about payment or disputes. A written acceptance from the buyer helps but is "
          "not required.", "guidance"),
    Entry("relationship", "Recovery approach (guidance)", "Asking for payment without losing the customer",
          "Start with the gentlest step likely to work: a friendly reminder, then a firm one mentioning "
          "the due date and interest, and only then a formal demand or a Council reference. Waiving part "
          "of the interest for prompt payment is the supplier's commercial choice. Mentioning politely "
          "that paying on time protects the buyer's own tax deduction can help.", "guidance"),
)

BY_ID = {e.id: e for e in KB}


def sources_block() -> str:
    """The sources as they are given to the model."""
    return "\n\n".join(f"[{e.id}] {e.label}: {e.title}\n{e.text}" for e in KB)
