"""Data-quality gate (spec section 28): reject symbols with unreliable data
BEFORE any analysis. A trade plan from bad data is worse than no trade plan.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class QualityReport:
    ok: bool
    problems: list[str] = field(default_factory=list)


def check_quality(df: pd.DataFrame, as_of: pd.Timestamp, cfg) -> QualityReport:
    problems: list[str] = []
    if df is None or df.empty:
        return QualityReport(False, ["no data"])

    df = df.loc[:as_of]
    if len(df) < cfg.data.min_history_bars:
        problems.append(f"insufficient history ({len(df)} bars < {cfg.data.min_history_bars})")
        return QualityReport(False, problems)

    # Stale data: last bar too far behind the scan date
    staleness = (as_of - df.index[-1]).days
    if staleness > cfg.data.max_staleness_days:
        problems.append(f"stale data (last bar {staleness} days old)")

    recent = df.tail(60)
    if recent[["Open", "High", "Low", "Close"]].isna().any().any():
        problems.append("missing OHLC values in recent history")
    if (recent["Close"] <= 0).any() or (recent["Low"] <= 0).any():
        problems.append("non-positive prices")
    if (recent["High"] < recent["Low"]).any():
        problems.append("high < low (corrupt bars)")
    if (recent["Volume"].fillna(0) == 0).sum() > 5:
        problems.append("frequent zero-volume sessions")

    # Unadjusted split / bad tick heuristic: absurd single-day move
    rets = recent["Close"].pct_change().abs()
    if (rets > 0.40).any():
        problems.append("suspect >40% single-day move (possible unadjusted corporate action)")

    # Missing-candle heuristic: large calendar gaps inside recent history
    gaps = pd.Series(recent.index).diff().dt.days.dropna()
    if (gaps > 10).any():
        problems.append("large gap in recent candles")

    return QualityReport(len(problems) == 0, problems)
