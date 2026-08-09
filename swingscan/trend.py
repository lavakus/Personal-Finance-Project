"""Stock trend structure (spec section 6).

Hard gate: EMA stack + rising EMAs + not catastrophically extended.
Score rewards clean structure (higher highs / higher lows), rising slopes,
and a healthy—not excessive—distance from the moving averages.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import indicators as ind


@dataclass
class TrendResult:
    passed: bool
    score: float
    reasons: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    extended: bool = False
    details: dict = field(default_factory=dict)


def evaluate_trend(df: pd.DataFrame, cfg) -> TrendResult:
    """df: indicator panel truncated to the as-of date (last row = today)."""
    row = df.iloc[-1]
    c, e20, e50, e200 = row["Close"], row["ema20"], row["ema50"], row["ema200"]
    atr = row["atr"]
    reasons, flags = [], []

    stack_ok = (c > e20) and (e20 > e50) and (e50 > e200)
    slopes_ok = row["ema20_slope"] > 0 and row["ema50_slope"] > 0

    ext_atr = (c - e20) / atr if atr > 0 else np.inf
    extended = ext_atr > cfg.trend.max_extension_atr

    # Higher-high / higher-low structure from confirmed swing pivots
    k = cfg.trend.swing_pivot_strength
    lows = ind.confirmed_swing_lows(df["Low"].iloc[-(cfg.trend.swing_lookback + k):], k).dropna()
    highs = ind.confirmed_swing_highs(df["High"].iloc[-(cfg.trend.swing_lookback + k):], k).dropna()
    hh = len(highs) >= 2 and highs.iloc[-1] > highs.iloc[-2]
    hl = len(lows) >= 2 and lows.iloc[-1] > lows.iloc[-2]

    passed = stack_ok and slopes_ok and not extended
    if stack_ok:
        reasons.append("Close > EMA20 > EMA50 > EMA200")
    if slopes_ok:
        reasons.append(f"EMA20/50 rising ({row['ema20_slope']:.1f}% / {row['ema50_slope']:.1f}% per {cfg.trend.slope_window}d)")
    if hh and hl:
        reasons.append("higher-high / higher-low structure")
    if extended:
        flags.append(f"too extended: {ext_atr:.1f} ATR above EMA20 (max {cfg.trend.max_extension_atr})")

    # Score: stack 40, slopes 20, structure 20, extension shape 20.
    # Extension component peaks when price is 0.5-2 ATR above EMA20 —
    # deliberately NOT monotonic in distance (spec: don't reward extension).
    score = 0.0
    score += 40.0 if stack_ok else 0.0
    score += 10.0 * min(1.0, max(0.0, row["ema20_slope"] / 2.0))
    score += 10.0 * min(1.0, max(0.0, row["ema50_slope"] / 2.0))
    score += (10.0 if hh else 0.0) + (10.0 if hl else 0.0)
    if 0.0 <= ext_atr <= 2.0:
        score += 20.0 * (1.0 - abs(ext_atr - 1.0))  # peak at ~1 ATR
    elif 2.0 < ext_atr <= cfg.trend.max_extension_atr:
        score += max(0.0, 10.0 * (cfg.trend.max_extension_atr - ext_atr) / (cfg.trend.max_extension_atr - 2.0))

    return TrendResult(
        passed=passed, score=float(np.clip(score, 0, 100)),
        reasons=reasons, flags=flags, extended=extended,
        details={
            "ext_atr": float(ext_atr), "hh": hh, "hl": hl,
            "dist_ema20_pct": float((c / e20 - 1) * 100),
            "dist_ema50_pct": float((c / e50 - 1) * 100),
            "dist_ema200_pct": float((c / e200 - 1) * 100),
            "last_swing_low": float(lows.iloc[-1]) if len(lows) else None,
        },
    )
