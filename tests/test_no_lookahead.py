"""THE critical test (spec section 22): scanning as-of date D with FULL
history loaded must produce byte-identical decisions to scanning with data
truncated at D. If any indicator, gate, or panel leaked future information,
these two runs would diverge."""

import numpy as np
import pandas as pd
import pytest

from swingscan.config import Config
from swingscan.pipeline import MarketData, scan_asof
from tests.conftest import make_breakout_setup, make_pullback_setup, make_uptrend

D = "2026-06-09"          # setup completes here
FULL_END = "2026-06-30"   # 15 future bars beyond D


def _extend(df: pd.DataFrame, until: str, drift: float = 0.004) -> pd.DataFrame:
    """Append future bars after the setup date (the data a live scan on D
    could not have seen)."""
    future_idx = pd.bdate_range(start=df.index[-1] + pd.Timedelta(days=1), end=until)
    last = df["Close"].iloc[-1]
    close = last * (1 + drift) ** np.arange(1, len(future_idx) + 1)
    fut = pd.DataFrame({
        "Open": np.concatenate([[last], close[:-1]]),
        "High": close * 1.01, "Low": close * 0.99,
        "Close": close, "Volume": 1_000_000.0,
    }, index=future_idx)
    return pd.concat([df, fut])


def _universe(symbols):
    return pd.DataFrame({
        "symbol": symbols,
        "name": symbols,
        "industry": ["Test"] * len(symbols),
        "sector": [None] * len(symbols),
        "yahoo": [s + ".NS" for s in symbols],
    })


@pytest.fixture
def data():
    prices = {
        "BRK": _extend(make_breakout_setup(n=305, end=D), FULL_END),
        "PBK": _extend(make_pullback_setup(n=305, end=D), FULL_END),
        "FLAT": make_uptrend(320, start_price=200.0, drift=0.0002, end=FULL_END),
        "WEAK": make_uptrend(320, start_price=300.0, drift=-0.001, end=FULL_END),
    }
    nifty = make_uptrend(320, start_price=20000.0, drift=0.0012, end=FULL_END)
    return prices, nifty


def _snapshot(res):
    return {
        "funnel": vars(res.funnel),
        "regime": (res.regime.label, round(res.regime.score, 6)),
        "no_trade": res.no_trade,
        "candidates": [
            (c.symbol, c.setup.setup_type, c.setup.entry_low, c.setup.entry_high,
             round(c.risk_plan.stop, 4), round(c.risk_plan.t1, 4), round(c.risk_plan.t2, 4),
             round(c.score.total, 6))
            for c in res.candidates
        ],
    }


def test_scan_identical_with_and_without_future_data(data):
    cfg = Config()
    prices, nifty = data
    as_of = pd.Timestamp(D)

    md_full = MarketData.build(prices, _universe(list(prices)), nifty, {}, None, cfg)
    res_full = scan_asof(md_full, as_of, cfg)

    truncated = {s: df.loc[:as_of] for s, df in prices.items()}
    md_trunc = MarketData.build(truncated, _universe(list(prices)), nifty.loc[:as_of], {}, None, cfg)
    res_trunc = scan_asof(md_trunc, as_of, cfg)

    assert _snapshot(res_full) == _snapshot(res_trunc)
    # make sure the deep path was actually exercised, not vacuously equal
    assert res_full.funnel.liquidity >= 3
    assert res_full.funnel.setup >= 1


def test_setups_reach_detection_on_signal_date(data):
    """Sanity: the synthetic setups actually pass the full gate chain on D."""
    cfg = Config()
    prices, nifty = data
    md = MarketData.build(prices, _universe(list(prices)), nifty, {}, None, cfg)
    res = scan_asof(md, pd.Timestamp(D), cfg)
    assert res.funnel.setup >= 1
