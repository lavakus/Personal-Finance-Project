"""SETUP B — Breakout continuation (spec section 10).

Strong trend -> 5-15 day tight consolidation (ATR compression, volume
contraction) -> breakout above resistance on expanded volume with a strong
close and no exhaustion gap. Large gaps are never chased.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..indicators import close_location_value
from .base import SetupResult


def _find_consolidation(df: pd.DataFrame, cfg) -> tuple[int, float, float] | None:
    """Longest window (ending yesterday) in [min,max] bars that is tight enough.

    Returns (length, resistance, consolidation_low) or None.
    """
    b = cfg.breakout
    atr = float(df["atr"].iloc[-1])
    best = None
    for w in range(b.max_consolidation, b.min_consolidation - 1, -1):
        win = df.iloc[-(w + 1):-1]                 # exclude today (the breakout bar)
        if len(win) < w:
            continue
        hi, lo = float(win["High"].max()), float(win["Low"].min())
        if (hi - lo) <= b.tightness_atr_mult * atr:
            best = (w, hi, lo)
            break                                   # prefer the longest qualifying base
    return best


def detect_breakout(df: pd.DataFrame, cfg) -> SetupResult:
    """df: indicator panel truncated to as-of date. Assumes trend gate passed."""
    b = cfg.breakout
    row = df.iloc[-1]
    atr = float(row["atr"])
    close = float(row["Close"])
    open_ = float(row["Open"])
    if not np.isfinite(atr) or atr <= 0:
        return SetupResult(False, "BREAKOUT", reject_reason="no ATR")

    found = _find_consolidation(df, cfg)
    if not found:
        return SetupResult(False, "BREAKOUT", reject_reason="no tight 5-15 day consolidation")
    length, resistance, consol_low = found

    if close <= resistance:
        return SetupResult(False, "BREAKOUT", reject_reason="no breakout above consolidation resistance")

    # ATR compression before the break
    compression = float(df["atr10"].iloc[-2] / df["atr50"].iloc[-2]) if df["atr50"].iloc[-2] > 0 else 9.9
    if compression > b.atr_compression_max:
        return SetupResult(False, "BREAKOUT",
                           reject_reason=f"no volatility compression (ATR10/ATR50 {compression:.2f})")

    # Volume: expansion on the breakout bar is MANDATORY
    vol_ratio = float(row["vol_ratio"])
    if not np.isfinite(vol_ratio) or vol_ratio < cfg.volume.breakout_vol_mult:
        return SetupResult(False, "BREAKOUT",
                           reject_reason=f"breakout volume {vol_ratio:.2f}x < required {cfg.volume.breakout_vol_mult}x")

    # Close strength
    clv = close_location_value(row)
    if clv < b.min_close_location:
        return SetupResult(False, "BREAKOUT", reject_reason=f"weak breakout close (CLV {clv:.2f})")

    # Exhaustion gap: open too far above resistance
    gap_atr = (open_ - resistance) / atr
    if gap_atr > b.max_gap_atr:
        return SetupResult(False, "BREAKOUT",
                           reject_reason=f"gap {gap_atr:.1f} ATR above resistance — DO NOT CHASE, wait for pullback/re-entry")

    # Extension: close already too far beyond the level
    ext_atr = (close - resistance) / atr
    if ext_atr > b.max_extension_atr:
        return SetupResult(False, "BREAKOUT",
                           reject_reason=f"ENTRY INVALID — TOO EXTENDED ({ext_atr:.1f} ATR past breakout level); wait for pullback")

    entry_low = resistance
    entry_high = resistance + b.entry_zone_atr * atr
    stop = consol_low - b.stop_atr_mult * atr
    entry_mid = (entry_low + entry_high) / 2.0
    if (entry_mid - stop) / atr > b.max_risk_atr:
        return SetupResult(False, "BREAKOUT",
                           reject_reason=f"stop too wide ({(entry_mid - stop) / atr:.1f} ATR)")

    # Volume contraction inside the base (quality, not a hard gate)
    base = df.iloc[-(length + 1):-1]
    base_vol_ratio = float(base["Volume"].mean() / row["vol_avg20"]) if row["vol_avg20"] > 0 else 1.0
    contraction = base_vol_ratio < 1.0

    tightness_atr = (float(df.iloc[-(length + 1):-1]["High"].max()) - consol_low) / atr

    reasons = [
        f"{length}-day consolidation, range {tightness_atr:.1f} ATR",
        f"breakout close above ₹{resistance:,.2f} resistance",
        f"breakout volume {vol_ratio:.1f}x 20d avg",
        f"strong close (CLV {clv:.2f})",
        f"volatility compression before break (ATR10/ATR50 {compression:.2f})",
    ]
    flags = []
    if contraction:
        reasons.append(f"volume dried up inside base ({base_vol_ratio:.2f}x avg)")
    if gap_atr > 0.25:
        flags.append(f"opened {gap_atr:.1f} ATR above resistance")

    # Setup quality score
    score = 0.0
    score += 20.0 * min(1.0, length / 10.0)                        # longer base
    score += 20.0 * max(0.0, 1.0 - max(0.0, tightness_atr - 1.5) / 2.0)   # tighter base
    score += 20.0 * min(1.0, (vol_ratio - 1.0) / 1.5)              # bigger volume thrust
    score += 15.0 * min(1.0, max(0.0, (clv - 0.5) / 0.5))
    score += 15.0 if contraction else 0.0
    score += 10.0 * max(0.0, 1.0 - compression)                    # deeper compression

    return SetupResult(
        True, "BREAKOUT", score=float(np.clip(score, 0, 100)),
        entry_low=round(entry_low, 2), entry_high=round(entry_high, 2),
        stop=round(stop, 2), key_level=round(resistance, 2),
        structure_low=round(consol_low, 2),
        reasons=reasons, flags=flags,
        do_not_chase_above=round(resistance + b.max_extension_atr * atr, 2),
        details={"length": length, "resistance": resistance, "consol_low": consol_low,
                 "vol_ratio": vol_ratio, "clv": clv, "gap_atr": gap_atr,
                 "compression": compression, "contraction": contraction},
    )
