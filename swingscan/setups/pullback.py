"""SETUP A — Pullback continuation (spec section 9).

Strong trend -> controlled pullback toward EMA20/EMA50 support with volume
contraction -> bullish reversal bar -> entry on break of the short-term
swing high. Preferred setup when conditions are strong.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..indicators import close_location_value, last_confirmed_swing_low
from .base import SetupResult


def detect_pullback(df: pd.DataFrame, cfg) -> SetupResult:
    """df: indicator panel truncated to as-of date. Assumes trend gate passed."""
    p = cfg.pullback
    row = df.iloc[-1]
    atr = float(row["atr"])
    close = float(row["Close"])
    if not np.isfinite(atr) or atr <= 0:
        return SetupResult(False, "PULLBACK", reject_reason="no ATR")

    win = df.iloc[-(p.max_days_since_high + 5):]
    hi_pos = int(np.argmax(win["High"].to_numpy()))
    days_since_high = len(win) - 1 - hi_pos
    swing_high = float(win["High"].iloc[hi_pos])

    if not (p.min_days_since_high <= days_since_high <= p.max_days_since_high):
        return SetupResult(False, "PULLBACK",
                           reject_reason=f"no recent pullback (peak {days_since_high}d ago)")

    pull = win.iloc[hi_pos:]                       # bars from peak to today
    pull_low = float(pull["Low"].min())
    depth_atr = (swing_high - pull_low) / atr
    depth_pct = (swing_high - pull_low) / swing_high

    if depth_atr < p.min_depth_atr:
        return SetupResult(False, "PULLBACK", reject_reason="pullback too shallow")
    if depth_atr > p.max_depth_atr or depth_pct > p.max_depth_pct:
        return SetupResult(False, "PULLBACK",
                           reject_reason=f"pullback too deep ({depth_atr:.1f} ATR / {depth_pct:.1%}) — structural breakdown risk")

    # Structure intact: pullback must hold above EMA50 and the prior swing low
    if close < row["ema50"]:
        return SetupResult(False, "PULLBACK", reject_reason="closed below EMA50 — structure broken")
    prior_low = last_confirmed_swing_low(df["Low"].iloc[:-days_since_high] if days_since_high else df["Low"],
                                         cfg.trend.swing_pivot_strength, cfg.trend.swing_lookback)
    if prior_low is not None and pull_low < prior_low * 0.995:
        return SetupResult(False, "PULLBACK", reject_reason="pullback undercut prior swing low")

    # Support proximity: pullback low near EMA20 or EMA50
    dist_e20 = abs(pull_low - row["ema20"]) / atr
    dist_e50 = abs(pull_low - row["ema50"]) / atr
    near_support = min(dist_e20, dist_e50) <= p.ema_proximity_atr
    if not near_support:
        return SetupResult(False, "PULLBACK", reject_reason="pullback did not reach EMA20/EMA50 support zone")

    # Volume contraction during the pullback (excluding today's potential reversal bar)
    pull_ex_today = pull.iloc[:-1] if len(pull) > 1 else pull
    pull_vol = float(pull_ex_today["Volume"].mean())
    contraction = pull_vol <= float(row["vol_avg20"]) * cfg.volume.contraction_ratio

    # Bullish reversal bar today
    prev = df.iloc[-2]
    clv = close_location_value(row)
    reversal = (close > float(prev["High"]) and clv >= 0.5) or \
               (close > float(prev["Close"]) and clv >= 0.6 and row["vol_ratio"] >= 1.0)
    if not reversal:
        return SetupResult(False, "PULLBACK", reject_reason="no bullish reversal confirmation yet (watchlist)")

    # Entry: break of the recent short-term swing high
    trigger = float(df["High"].iloc[-p.trigger_lookback:].max())
    entry_low, entry_high = trigger, trigger + p.entry_zone_atr * atr
    if close > entry_high + 0.5 * atr:
        return SetupResult(False, "PULLBACK", reject_reason="ENTRY INVALID — TOO EXTENDED past trigger")

    # Stop: below structural low with ATR buffer
    stop = pull_low - p.stop_atr_mult * atr
    if prior_low is not None:
        stop = min(stop, prior_low - 0.25 * atr) if abs(prior_low - pull_low) / atr < 1.0 else stop

    # Gap check: today's open gapping far above trigger = chase risk
    gap_flag = float(row["Open"]) > trigger + 0.75 * atr

    reasons = [
        f"controlled pullback: {depth_atr:.1f} ATR / {depth_pct:.1%} over {days_since_high}d",
        f"pullback low within {min(dist_e20, dist_e50):.1f} ATR of EMA{'20' if dist_e20 <= dist_e50 else '50'}",
        "bullish reversal bar (close above prior high)" if close > prev["High"] else "bullish reversal bar",
    ]
    flags = []
    if contraction:
        reasons.append(f"volume contracted during pullback ({pull_vol / float(row['vol_avg20']):.2f}x 20d avg)")
    else:
        flags.append("volume did NOT contract during pullback")
    if row["vol_ratio"] >= 1.2:
        reasons.append(f"reversal volume {row['vol_ratio']:.1f}x 20d avg")
    if gap_flag:
        flags.append("opened well above trigger — watch for gap-and-fade")

    # Setup quality score
    score = 0.0
    score += 25.0 * (1.0 - abs(depth_atr - 2.0) / 2.0)           # ideal depth ~2 ATR
    score += 20.0 * max(0.0, 1.0 - min(dist_e20, dist_e50))      # tighter to support = better
    score += 15.0 if contraction else 0.0
    score += 15.0 * min(1.0, max(0.0, (clv - 0.4) / 0.6))        # strong close
    score += 15.0 * min(1.0, float(row["vol_ratio"]))            # participation on reversal
    score += 10.0 if close > prev["High"] else 5.0

    return SetupResult(
        True, "PULLBACK", score=float(np.clip(score, 0, 100)),
        entry_low=round(entry_low, 2), entry_high=round(entry_high, 2),
        stop=round(stop, 2), key_level=round(trigger, 2),
        structure_low=round(pull_low, 2),
        reasons=reasons, flags=flags,
        do_not_chase_above=round(entry_high + 0.5 * atr, 2),
        details={"depth_atr": depth_atr, "depth_pct": depth_pct,
                 "days_since_high": days_since_high, "swing_high": swing_high,
                 "contraction": contraction, "clv": clv},
    )
