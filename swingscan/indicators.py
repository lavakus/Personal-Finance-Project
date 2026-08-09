"""Technical indicators.

Every function here is CAUSAL: the value at row i depends only on rows <= i.
This property is what makes precomputing indicator panels safe for
backtesting without look-ahead bias (verified by tests/test_no_lookahead.py).

Swing pivots are the one construct that inherently references future bars
(a pivot needs `strength` bars on both sides). They are handled by exposing
only *confirmed* pivots: a pivot at bar i becomes known at bar i+strength.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


# ---------------------------------------------------------------- smoothing

def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window).mean()


def _wilder(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(alpha=1.0 / period, adjust=False).mean()


# ---------------------------------------------------------------- momentum

def _wilder_seeded(vals: np.ndarray, period: int) -> np.ndarray:
    """Classic Wilder smoothing: SMA seed over the first `period` values,
    then recursive (prev*(n-1) + x)/n. vals[0] is expected to be NaN (diff)."""
    out = np.full(len(vals), np.nan)
    if len(vals) <= period:
        return out
    out[period] = np.nanmean(vals[1 : period + 1])
    for i in range(period + 1, len(vals)):
        v = vals[i] if np.isfinite(vals[i]) else 0.0
        out[i] = (out[i - 1] * (period - 1) + v) / period
    return out


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff().to_numpy(dtype=float)
    avg_gain = _wilder_seeded(np.clip(delta, 0.0, None), period)
    avg_loss = _wilder_seeded(np.clip(-delta, 0.0, None), period)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = avg_gain / avg_loss
        out = np.where(avg_loss == 0.0, 100.0, 100.0 - 100.0 / (1.0 + rs))
    out[~np.isfinite(avg_gain)] = np.nan
    return pd.Series(out, index=close.index)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    """Returns (macd_line, signal_line, histogram)."""
    line = ema(close, fast) - ema(close, slow)
    sig = line.ewm(span=signal, adjust=False).mean()
    return line, sig, line - sig


def roc(close: pd.Series, period: int) -> pd.Series:
    return close.pct_change(period) * 100.0


# ---------------------------------------------------------------- volatility

def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["Close"].shift(1)
    return pd.concat(
        [
            df["High"] - df["Low"],
            (df["High"] - prev_close).abs(),
            (df["Low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    return _wilder(true_range(df), period)


# ---------------------------------------------------------------- trend

def adx(df: pd.DataFrame, period: int = 14):
    """Returns (adx, plus_di, minus_di) with Wilder smoothing."""
    up = df["High"].diff()
    down = -df["Low"].diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=df.index)
    atr_ = _wilder(true_range(df), period)
    plus_di = 100.0 * _wilder(plus_dm, period) / atr_
    minus_di = 100.0 * _wilder(minus_dm, period) / atr_
    denom = (plus_di + minus_di).replace(0.0, np.nan)
    dx = 100.0 * (plus_di - minus_di).abs() / denom
    return _wilder(dx.fillna(0.0), period), plus_di, minus_di


def slope_pct(series: pd.Series, window: int) -> pd.Series:
    """Percent change of a (smoothed) series over `window` bars — cheap slope proxy."""
    return series.pct_change(window) * 100.0


# ---------------------------------------------------------------- structure

def confirmed_swing_lows(low: pd.Series, strength: int = 2) -> pd.Series:
    """Boolean series: True where bar i is a swing low, CONFIRMED (i.e. the
    flag is placed at bar i+strength, when it becomes knowable).

    Value at confirmation bar is the pivot low PRICE; NaN elsewhere.
    """
    n = len(low)
    vals = low.to_numpy(dtype=float)
    out = np.full(n, np.nan)
    for i in range(strength, n - strength):
        window = vals[i - strength : i + strength + 1]
        if vals[i] == window.min() and (window > vals[i]).sum() == 2 * strength:
            out[i + strength] = vals[i]  # knowable only `strength` bars later
    return pd.Series(out, index=low.index)


def confirmed_swing_highs(high: pd.Series, strength: int = 2) -> pd.Series:
    n = len(high)
    vals = high.to_numpy(dtype=float)
    out = np.full(n, np.nan)
    for i in range(strength, n - strength):
        window = vals[i - strength : i + strength + 1]
        if vals[i] == window.max() and (window < vals[i]).sum() == 2 * strength:
            out[i + strength] = vals[i]
    return pd.Series(out, index=high.index)


def last_confirmed_swing_low(low: pd.Series, strength: int = 2, lookback: int = 40) -> float | None:
    """Most recent confirmed swing-low price as of the final bar."""
    flags = confirmed_swing_lows(low.iloc[-(lookback + strength):], strength)
    valid = flags.dropna()
    return float(valid.iloc[-1]) if len(valid) else None


def close_location_value(row: pd.Series) -> float:
    """Where the close sits in the day's range: 0 = at low, 1 = at high."""
    rng = row["High"] - row["Low"]
    if rng <= 0:
        return 0.5
    return float((row["Close"] - row["Low"]) / rng)


# ---------------------------------------------------------------- panel

def compute_indicator_panel(df: pd.DataFrame, cfg) -> pd.DataFrame:
    """Attach every indicator column the pipeline needs to an OHLCV frame.

    All columns are causal; safe to precompute over full history.
    """
    out = df.copy()
    c = out["Close"]

    out["ema20"] = ema(c, cfg.trend.ema_fast)
    out["ema50"] = ema(c, cfg.trend.ema_mid)
    out["ema200"] = ema(c, cfg.trend.ema_slow)
    out["ema20_slope"] = slope_pct(out["ema20"], cfg.trend.slope_window)
    out["ema50_slope"] = slope_pct(out["ema50"], cfg.trend.slope_window)

    out["atr"] = atr(out, 14)
    out["atr10"] = atr(out, 10)
    out["atr50"] = atr(out, 50)
    out["atr_pct"] = out["atr"] / c * 100.0

    out["rsi"] = rsi(c, cfg.momentum.rsi_period)
    _, _, out["macd_hist"] = macd(c)
    out["adx"], out["plus_di"], out["minus_di"] = adx(out, cfg.momentum.adx_period)
    out["roc10"] = roc(c, cfg.momentum.roc_period)

    for w in cfg.rs.windows:
        out[f"ret{w}"] = c.pct_change(w) * 100.0

    out["vol_avg20"] = sma(out["Volume"], cfg.volume.avg_window)
    out["vol_avg50"] = sma(out["Volume"], cfg.volume.long_window)
    out["vol_ratio"] = out["Volume"] / out["vol_avg20"]
    out["traded_value20"] = sma(c * out["Volume"], cfg.liquidity.traded_value_window)

    # Up/down volume balance over accumulation window: +1 accumulation, -1 distribution
    direction = np.sign(c.diff()).fillna(0.0)
    signed_vol = out["Volume"] * direction
    win = cfg.volume.accumulation_window
    out["acc_dist"] = signed_vol.rolling(win).sum() / out["Volume"].rolling(win).sum()

    return out
