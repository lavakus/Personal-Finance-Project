import numpy as np
import pandas as pd
import pytest

from swingscan import indicators as ind
from tests.conftest import make_uptrend


def test_ema_matches_pandas():
    s = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0])
    expected = s.ewm(span=3, adjust=False).mean()
    pd.testing.assert_series_equal(ind.ema(s, 3), expected)


def test_rsi_bounds_and_direction():
    up = pd.Series(np.linspace(100, 200, 60))
    down = pd.Series(np.linspace(200, 100, 60))
    assert ind.rsi(up, 14).iloc[-1] > 95
    assert ind.rsi(down, 14).iloc[-1] < 5
    mixed = pd.Series(100 + np.sin(np.arange(100)) * 5)
    r = ind.rsi(mixed, 14).dropna()
    assert ((r >= 0) & (r <= 100)).all()


def test_rsi_known_value():
    # Classic Wilder example series (14-period), first RSI after warmup ~70.53
    closes = pd.Series([44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
                        45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28])
    r = ind.rsi(closes, 14).iloc[-1]
    assert 69.0 < r < 72.0


def test_atr_constant_range():
    df = pd.DataFrame({
        "Open": [100.0] * 30, "High": [102.0] * 30,
        "Low": [98.0] * 30, "Close": [100.0] * 30,
    })
    a = ind.atr(df, 14)
    assert abs(a.iloc[-1] - 4.0) < 0.01   # H-L constant 4, no gaps


def test_macd_sign_in_trend():
    up = pd.Series(np.linspace(100, 180, 120))
    line, sig, hist = ind.macd(up)
    assert line.iloc[-1] > 0


def test_adx_strong_trend_vs_flat():
    up = make_uptrend(150)
    adx_up, pdi, mdi = ind.adx(up, 14)
    assert adx_up.iloc[-1] > 25
    assert pdi.iloc[-1] > mdi.iloc[-1]
    flat = pd.DataFrame({
        "Open": 100.0, "High": 100.5, "Low": 99.5, "Close": 100.0,
    }, index=range(150))
    adx_flat, _, _ = ind.adx(flat, 14)
    assert adx_flat.iloc[-1] < adx_up.iloc[-1]


def test_swing_low_confirmation_lag():
    # V-shape: low at position 5; with strength=2 it is knowable at position 7
    low = pd.Series([10, 9, 8, 7, 6, 5, 6, 7, 8, 9, 10], dtype=float)
    flags = ind.confirmed_swing_lows(low, strength=2)
    assert flags.dropna().index.tolist() == [7]
    assert flags.iloc[7] == 5.0


def test_swing_low_not_leaked_early():
    # Truncate before confirmation: the pivot must NOT be visible
    low = pd.Series([10, 9, 8, 7, 6, 5, 6], dtype=float)  # only 1 bar after the low
    flags = ind.confirmed_swing_lows(low, strength=2)
    assert flags.dropna().empty


def test_close_location_value():
    row = pd.Series({"High": 110.0, "Low": 100.0, "Close": 108.0})
    assert abs(ind.close_location_value(row) - 0.8) < 1e-9
