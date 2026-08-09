import pandas as pd
import pytest

from swingscan.config import Config
from swingscan.indicators import compute_indicator_panel
from swingscan.risk import build_risk_plan, position_size
from tests.conftest import make_uptrend


def test_position_size_spec_example():
    """Spec section 26: capital 10L, risk 0.5%, entry 1025, SL 990 -> ~142 shares."""
    cfg = Config()
    sz = position_size(1025.0, 990.0, cfg)
    assert sz.shares == 142
    assert abs(sz.risk_amount - 142 * 35.0) < 1e-6


def test_position_size_notional_cap():
    cfg = Config()
    cfg.risk.max_position_pct = 5.0            # 50k notional cap
    sz = position_size(1000.0, 995.0, cfg)     # tight stop would want 1000 shares
    assert sz.capped_by_notional
    assert sz.shares == 50


def test_risk_plan_geometry(cfg):
    df = compute_indicator_panel(make_uptrend(300), cfg)
    entry_low, entry_high = 500.0, 505.0
    stop = 480.0
    rp = build_risk_plan(df, entry_low, entry_high, stop, cfg)
    entry = 502.5
    risk = entry - stop
    if rp.valid:
        assert rp.rr1 >= cfg.risk.min_rr_t1
        assert rp.t1 > entry and rp.t2 >= rp.t1
        assert abs(rp.risk_per_share - risk) < 1e-9


def test_risk_plan_rejects_stop_above_entry(cfg):
    df = compute_indicator_panel(make_uptrend(300), cfg)
    rp = build_risk_plan(df, 100.0, 101.0, 105.0, cfg)
    assert not rp.valid
    assert "geometry" in rp.reject_reason


def test_risk_plan_rejects_when_resistance_too_close(cfg):
    """A confirmed swing high just above entry must cap T1 and kill R:R."""
    df = make_uptrend(300)
    # carve a clear swing high ~1.5% above the last close, 10 bars back
    last_close = df["Close"].iloc[-1]
    ceiling = last_close * 1.015
    df.iloc[-10, df.columns.get_indexer(["High"])[0]] = ceiling
    panel = compute_indicator_panel(df, Config())
    entry = last_close
    rp = build_risk_plan(panel, entry * 0.999, entry * 1.001, entry * 0.96, Config())
    assert not rp.valid                        # reward to capped T1 << 1.5R
    assert "R:R" in rp.reject_reason
