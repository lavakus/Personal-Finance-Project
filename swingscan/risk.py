"""Targets, risk/reward validation and position sizing (spec sections 12-14, 26).

Targets start from R-multiples but are capped at real overhead resistance:
if a prior swing high sits before the raw 1.8R target, the target moves just
under it — and if that makes the reward unacceptable, the trade is rejected
("major resistance before T1").
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .indicators import confirmed_swing_highs


@dataclass
class RiskPlan:
    valid: bool
    entry: float = 0.0                 # mid of the entry zone, used for R math
    stop: float = 0.0
    risk_per_share: float = 0.0
    t1: float = 0.0
    t2: float = 0.0
    rr1: float = 0.0
    rr2: float = 0.0
    score: float = 0.0                 # 0-100 risk/reward quality
    resistance_note: str | None = None
    reject_reason: str | None = None
    reasons: list[str] = field(default_factory=list)


def _overhead_resistance(df: pd.DataFrame, entry: float, cfg) -> float | None:
    """Nearest confirmed swing high above entry within the lookback (ignoring
    levels within 1% of entry — those are the level being broken)."""
    look = df.iloc[-cfg.risk.resistance_lookback:]
    highs = confirmed_swing_highs(look["High"], cfg.trend.swing_pivot_strength).dropna()
    above = sorted(h for h in highs.tolist() if h > entry * 1.01)
    return above[0] if above else None


def build_risk_plan(df: pd.DataFrame, entry_low: float, entry_high: float,
                    stop: float, cfg) -> RiskPlan:
    r = cfg.risk
    entry = (entry_low + entry_high) / 2.0
    risk = entry - stop
    if risk <= 0:
        return RiskPlan(False, reject_reason="stop above entry (invalid geometry)")

    t1 = entry + r.t1_r_multiple * risk
    t2 = entry + r.t2_r_multiple * risk
    reasons = []
    resistance_note = None

    res = _overhead_resistance(df, entry, cfg)
    if res is not None:
        capped = res * r.resistance_buffer
        if capped < t1:
            t1 = capped
            resistance_note = f"T1 capped just under prior swing high ₹{res:,.2f}"
        if capped < t2:
            t2 = max(capped, t1)
        if res > t2:
            reasons.append(f"no major resistance before T2 (next level ₹{res:,.2f})")
        elif res > t1:
            reasons.append(f"no major resistance before T1 (next level ₹{res:,.2f})")
    else:
        reasons.append("no overhead resistance in lookback (at/near highs)")

    rr1 = (t1 - entry) / risk
    rr2 = (t2 - entry) / risk
    if rr1 < r.min_rr_t1:
        return RiskPlan(False, entry=entry, stop=stop, risk_per_share=risk,
                        t1=t1, t2=t2, rr1=rr1, rr2=rr2,
                        reject_reason=f"R:R to T1 {rr1:.2f} < {r.min_rr_t1} "
                                      + ("(major resistance before T1)" if resistance_note else ""))
    if rr2 < r.min_rr_t2:
        return RiskPlan(False, entry=entry, stop=stop, risk_per_share=risk,
                        t1=t1, t2=t2, rr1=rr1, rr2=rr2,
                        reject_reason=f"R:R to T2 {rr2:.2f} < {r.min_rr_t2}")

    # Score: rr1 at threshold -> ~55; each +0.5R adds ~15, capped
    score = float(np.clip(40.0 + (rr1 - 1.0) * 30.0 + (rr2 - 2.0) * 7.0, 0.0, 100.0))
    return RiskPlan(True, entry=entry, stop=stop, risk_per_share=risk,
                    t1=round(t1, 2), t2=round(t2, 2), rr1=rr1, rr2=rr2,
                    score=score, resistance_note=resistance_note, reasons=reasons)


@dataclass
class PositionSize:
    shares: int
    notional: float
    risk_amount: float
    capped_by_notional: bool


def position_size(entry: float, stop: float, cfg) -> PositionSize:
    """Kept separate from ranking (spec section 26)."""
    r = cfg.risk
    max_risk = r.account_capital * r.risk_per_trade_pct / 100.0
    per_share = entry - stop
    if per_share <= 0:
        return PositionSize(0, 0.0, 0.0, False)
    shares = math.floor(max_risk / per_share)
    max_notional = r.account_capital * r.max_position_pct / 100.0
    capped = shares * entry > max_notional
    if capped:
        shares = math.floor(max_notional / entry)
    return PositionSize(shares, round(shares * entry, 2),
                        round(shares * per_share, 2), capped)
