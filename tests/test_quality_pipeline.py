import numpy as np
import pandas as pd
import pytest

from swingscan.config import Config
from swingscan.data.quality import check_quality
from swingscan.pipeline import MarketData, scan_asof
from tests.conftest import bdates, make_uptrend


@pytest.fixture
def cfg():
    return Config()


def test_quality_rejects_short_history(cfg):
    df = make_uptrend(100)
    rep = check_quality(df, df.index[-1], cfg)
    assert not rep.ok
    assert any("insufficient history" in p for p in rep.problems)


def test_quality_rejects_stale_data(cfg):
    df = make_uptrend(300)
    rep = check_quality(df, df.index[-1] + pd.Timedelta(days=30), cfg)
    assert not rep.ok
    assert any("stale" in p for p in rep.problems)


def test_quality_rejects_suspect_corporate_action(cfg):
    df = make_uptrend(300)
    i = df.columns.get_indexer(["Close"])[0]
    df.iloc[-5, i] = df.iloc[-6, i] * 0.5      # unadjusted 1:2 split look
    rep = check_quality(df, df.index[-1], cfg)
    assert not rep.ok


def test_quality_accepts_clean_series(cfg):
    df = make_uptrend(300)
    rep = check_quality(df, df.index[-1], cfg)
    assert rep.ok, rep.problems


def test_bear_regime_returns_no_trade(cfg):
    """STRONG_BEARISH tape must disable longs entirely (spec section 3/21)."""
    n = 320
    idx = bdates(n)
    close = 25000 * (1 - 0.003) ** np.arange(n)
    nifty = pd.DataFrame({"Open": close, "High": close * 1.004,
                          "Low": close * 0.996, "Close": close, "Volume": 1e6}, index=idx)
    prices = {"AAA": make_uptrend(320)}
    uni = pd.DataFrame({"symbol": ["AAA"], "name": ["AAA"], "industry": ["Test"],
                        "sector": [None], "yahoo": ["AAA.NS"]})
    md = MarketData.build(prices, uni, nifty, {}, None, cfg)
    res = scan_asof(md, idx[-1], cfg)
    assert res.no_trade
    assert res.regime.label in ("BEARISH", "STRONG_BEARISH")
    if res.regime.label == "STRONG_BEARISH":
        assert "disabled" in res.no_trade_reason
