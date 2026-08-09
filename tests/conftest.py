"""Shared fixtures: deterministic synthetic OHLCV series that trigger (or
deliberately fail) each setup, so detectors are testable without market data."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from swingscan.config import Config


@pytest.fixture
def cfg() -> Config:
    return Config()


def bdates(n: int, end: str = "2026-06-30") -> pd.DatetimeIndex:
    return pd.bdate_range(end=end, periods=n)


def make_uptrend(n: int = 320, start_price: float = 150.0, drift: float = 0.004,
                 daily_range: float = 0.02, volume: float = 1_000_000,
                 end: str = "2026-06-30") -> pd.DataFrame:
    """Smooth uptrend; H/L symmetric around close; O = previous close."""
    idx = bdates(n, end)
    close = start_price * (1 + drift) ** np.arange(n)
    high = close * (1 + daily_range / 2)
    low = close * (1 - daily_range / 2)
    open_ = np.concatenate([[close[0]], close[:-1]])
    return pd.DataFrame({"Open": open_, "High": high, "Low": low,
                         "Close": close, "Volume": volume}, index=idx)


def make_pullback_setup(n: int = 320, end: str = "2026-06-30") -> pd.DataFrame:
    """Uptrend -> 4-day controlled pullback INTO the actual EMA20 zone on
    falling volume -> bullish reversal bar on above-average volume (SETUP A).

    Pullback depth is derived from the real EMA20 so the 'support proximity'
    condition is genuinely met rather than hand-tuned."""
    df = make_uptrend(n, end=end)
    cols = {c: df.columns.get_loc(c) for c in df.columns}
    e20 = df["Close"].ewm(span=20, adjust=False).mean()
    peak_close = float(df["Close"].iloc[-6])
    depth = (peak_close - float(e20.iloc[-6])) / peak_close   # distance to EMA20 (~3-4%)
    for i, k in enumerate(range(-5, -1), 1):
        prev_c = peak_close * (1 - depth * (i - 1) / 4 * 0.98)
        c = peak_close * (1 - depth * i / 4 * 0.98)
        df.iloc[k, cols["Open"]] = prev_c
        df.iloc[k, cols["Close"]] = c
        df.iloc[k, cols["High"]] = prev_c * 1.004
        df.iloc[k, cols["Low"]] = c * 0.997
        df.iloc[k, cols["Volume"]] = 550_000
    # reversal bar: opens near prior close, closes above prior high, strong volume
    prev_close = float(df["Close"].iloc[-2])
    prev_high = float(df["High"].iloc[-2])
    df.iloc[-1, cols["Open"]] = prev_close * 1.001
    df.iloc[-1, cols["Close"]] = prev_high * 1.005
    df.iloc[-1, cols["High"]] = prev_high * 1.009
    df.iloc[-1, cols["Low"]] = prev_close * 0.998
    df.iloc[-1, cols["Volume"]] = 1_400_000
    return df


def make_breakout_setup(n: int = 320, end: str = "2026-06-30") -> pd.DataFrame:
    """Uptrend -> 12-day tight consolidation on shrinking volume ->
    breakout bar over the range high on 2x volume (valid SETUP B)."""
    df = make_uptrend(n, end=end)
    base = df["Close"].iloc[-14]
    rng = np.array([1.000, 0.996, 1.003, 0.998, 1.002, 0.997, 1.001, 0.999,
                    1.002, 0.996, 1.000, 0.998])
    for i, k in enumerate(range(-13, -1)):
        c = base * rng[i]
        df.iloc[k, df.columns.get_indexer(["Open"])[0]] = c * 0.999
        df.iloc[k, df.columns.get_indexer(["Close"])[0]] = c
        df.iloc[k, df.columns.get_indexer(["High"])[0]] = c * 1.004
        df.iloc[k, df.columns.get_indexer(["Low"])[0]] = c * 0.996
        df.iloc[k, df.columns.get_indexer(["Volume"])[0]] = 650_000
    resistance = float(df["High"].iloc[-13:-1].max())
    # breakout bar: small open gap, strong close just past the level, 2.3x volume
    df.iloc[-1, df.columns.get_indexer(["Open"])[0]] = resistance * 1.001
    df.iloc[-1, df.columns.get_indexer(["Low"])[0]] = resistance * 0.999
    df.iloc[-1, df.columns.get_indexer(["High"])[0]] = resistance * 1.014
    df.iloc[-1, df.columns.get_indexer(["Close"])[0]] = resistance * 1.012
    df.iloc[-1, df.columns.get_indexer(["Volume"])[0]] = 1_500_000
    return df
