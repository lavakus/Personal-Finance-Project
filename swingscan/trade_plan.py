"""Candidate container + human-readable trade plan text (spec sections 18-20, 27).

This engine produces PLANS only. It never places, modifies, or manages orders.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .ranking import ScoreBreakdown
from .risk import PositionSize, RiskPlan
from .setups.base import SetupResult


@dataclass
class Candidate:
    symbol: str
    name: str
    sector: str | None
    sector_rank: int | None
    price: float
    atr: float
    setup: SetupResult
    risk_plan: RiskPlan
    score: ScoreBreakdown
    sizing: PositionSize
    why: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    rs_excess_nifty_20d: float | None = None
    reject_reason: str | None = None
    rank: int = 0

    @property
    def expected_holding(self) -> str:
        return "3-10 trading days" if self.setup.setup_type == "BREAKOUT" else "4-12 trading days"


def entry_conditions(c: Candidate) -> list[str]:
    s = c.setup
    out = [f"Buy only inside the entry zone ₹{s.entry_low:,.2f}-₹{s.entry_high:,.2f}."]
    if s.setup_type == "PULLBACK":
        out.append(f"Trigger: price takes out the short-term swing high at ₹{s.key_level:,.2f}.")
        out.append("Prefer entry with intraday volume running at or above average.")
    else:
        out.append(f"Level: confirmed breakout above ₹{s.key_level:,.2f} on {'{:.1f}'.format(s.details.get('vol_ratio', 0))}x volume.")
        out.append("If price re-tests the breakout level and holds, that re-test is the highest-quality entry.")
    out.append("Entry order expires after 2 trading days if not filled — setups go stale.")
    return out


def exit_conditions(c: Candidate) -> list[str]:
    rp = c.risk_plan
    return [
        f"Stop-loss hit: ₹{rp.stop:,.2f} — exit in full, no averaging down.",
        f"Target 1 hit: ₹{rp.t1:,.2f} ({rp.rr1:.1f}R) — book half, move stop to entry (₹{rp.entry:,.2f}).",
        f"Target 2 hit: ₹{rp.t2:,.2f} ({rp.rr2:.1f}R) — exit remainder.",
        "Momentum failure: two consecutive closes below EMA20 (by >0.25 ATR) with MACD histogram negative — exit next open even if the stop is not hit.",
        "Thesis failure: close below the structure low "
        f"(₹{c.setup.structure_low:,.2f}) — exit; the setup is broken regardless of the stop.",
        "Relative strength collapse: 5-day return trails NIFTY by more than 3% — tighten stop to prior day low.",
        "Time stop: 15 trading days after entry — exit regardless (capital efficiency), earlier exits always take priority.",
        "A single red day is NOT an exit. Exit on structure/momentum failure, not noise.",
    ]


def invalidation_conditions(c: Candidate) -> list[str]:
    s = c.setup
    out = [f"Setup invalid before entry if price closes below ₹{s.structure_low:,.2f}."]
    if s.setup_type == "BREAKOUT":
        out.append(f"Failed breakout: close back below ₹{s.key_level:,.2f} within 2 days of the break — stand aside.")
    else:
        out.append(f"Reversal negated: close below the pullback low ₹{s.structure_low:,.2f} — stand aside.")
    out.append("Any exchange action (surveillance list, ban period) or corporate news gap — re-evaluate manually.")
    return out


def do_not_chase(c: Candidate) -> list[str]:
    s = c.setup
    out = [f"Price is above ₹{s.do_not_chase_above:,.2f} — R:R is gone; WAIT FOR PULLBACK / RE-ENTRY."]
    if s.setup_type == "BREAKOUT":
        out.append(f"Stock gaps open more than {c.atr * 0.75:,.2f} (0.75 ATR) above ₹{s.key_level:,.2f}.")
    else:
        out.append("Stock gaps open above the entry zone at the open — let it come back or skip.")
    return out
