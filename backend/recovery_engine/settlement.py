"""Settlement options: what the owner gives up under different commercial offers.

This is the owner's commercial choice, not legal advice. The calculator only
shows the trade-off between collecting everything and offering concessions.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from .interest import InterestResult


@dataclass
class SettlementOption:
    label: str
    interest_waived_pct: Decimal
    amount_requested: Decimal
    amount_forgone: Decimal
    pct_of_full_claim: Decimal


def settlement_options(
    result: InterestResult,
    waiver_levels: tuple[int, ...] = (0, 50, 100),
) -> list[SettlementOption]:
    full = result.total_outstanding
    options = []
    for pct in waiver_levels:
        if not 0 <= pct <= 100:
            raise ValueError("waiver percentage must be between 0 and 100")
        waived = (result.interest_outstanding * Decimal(pct) / 100).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP)
        requested = full - waived
        label = {0: "Full claim (principal + all interest)",
                 100: "Principal only (waive all interest)"}.get(
            pct, f"Principal + {100 - pct}% of interest")
        share = (requested / full * 100).quantize(Decimal("0.1")) if full else Decimal(0)
        options.append(SettlementOption(label, Decimal(pct), requested, waived, share))
    return options
