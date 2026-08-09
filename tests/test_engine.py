"""Backtest execution mechanics: fills, stop-first conservatism, partials."""

import pandas as pd
import pytest

from swingscan.backtest.engine import PendingOrder, Position, _manage_position, _try_fill
from swingscan.config import Config


@pytest.fixture
def cfg():
    return Config()


def order(**kw):
    base = dict(symbol="X", setup_type="BREAKOUT", signal_date=pd.Timestamp("2026-01-01"),
                entry_low=100.0, entry_high=102.0, stop=95.0, t1=109.0, t2=114.0,
                structure_low=96.0, score=80.0, regime="BULLISH", sector=None)
    base.update(kw)
    return PendingOrder(**base)


def bar(o, h, lo, c, ema20=100.0, atr=2.0, macd_hist=1.0):
    return pd.Series({"Open": o, "High": h, "Low": lo, "Close": c,
                      "ema20": ema20, "atr": atr, "macd_hist": macd_hist})


def position(**kw):
    base = dict(symbol="X", setup_type="BREAKOUT", entry_date=pd.Timestamp("2026-01-02"),
                entry_price=101.0, shares=100, stop=95.0, t1=109.0, t2=114.0,
                structure_low=96.0, score=80.0, regime="BULLISH", sector=None,
                risk_per_share=6.0)
    base.update(kw)
    return Position(**base)


# ------------------------------------------------------------------ fills

def test_fill_at_open_inside_zone():
    assert _try_fill(order(), bar(101.0, 103.0, 100.5, 102.0)) == 101.0


def test_no_chase_when_gapped_above_zone():
    assert _try_fill(order(), bar(104.0, 106.0, 103.0, 105.0)) is None


def test_fill_at_zone_high_when_price_comes_back():
    assert _try_fill(order(), bar(104.0, 105.0, 101.5, 102.5)) == 102.0


def test_trigger_fill_when_price_rises_to_zone():
    assert _try_fill(order(), bar(99.0, 101.0, 98.5, 100.5)) == 100.0


def test_no_fill_below_trigger():
    assert _try_fill(order(), bar(98.0, 99.5, 97.5, 99.0)) is None


# ------------------------------------------------------------- management

def test_stop_before_target_same_bar(cfg):
    """Conservative rule: bar touches both stop and T1 -> stop assumed first."""
    pos = position()
    t = _manage_position(pos, bar(101.0, 110.0, 94.0, 108.0), pd.Timestamp("2026-01-05"), None, cfg)
    assert t is not None
    assert t.exit_reason == "stop"
    assert t.net_pnl < 0


def test_gap_through_stop_fills_at_open(cfg):
    pos = position()
    t = _manage_position(pos, bar(92.0, 94.0, 91.0, 93.0), pd.Timestamp("2026-01-05"), None, cfg)
    assert t.exit_reason == "stop_gap"
    # exit at open (92) minus slippage, NOT at the stop (95)
    assert t.net_pnl < (92.0 - 101.0) * 100 * 0.9


def test_t1_partial_and_breakeven_trail(cfg):
    pos = position()
    t = _manage_position(pos, bar(102.0, 110.0, 101.0, 109.5), pd.Timestamp("2026-01-05"), None, cfg)
    assert t is None                      # still open
    assert pos.t1_hit
    assert pos.remaining == 50            # 50% booked
    assert pos.stop == pytest.approx(101.0)   # trailed to entry


def test_t2_closes_remainder(cfg):
    pos = position()
    _manage_position(pos, bar(102.0, 110.0, 101.0, 109.5), pd.Timestamp("2026-01-05"), None, cfg)
    t = _manage_position(pos, bar(110.0, 115.0, 109.0, 114.5), pd.Timestamp("2026-01-06"), None, cfg)
    assert t is not None
    assert t.exit_reason == "t2"
    assert t.t1_hit and t.t2_hit
    assert t.net_pnl > 0


def test_time_stop(cfg):
    pos = position(days_held=cfg.exits.max_holding_days - 1)
    t = _manage_position(pos, bar(102.0, 103.0, 101.0, 102.5), pd.Timestamp("2026-01-05"), None, cfg)
    assert t is not None
    assert t.exit_reason == "time_stop"


def test_thesis_failure_exits_next_open(cfg):
    pos = position()
    # close below structure_low (96): queue exit
    t = _manage_position(pos, bar(99.0, 99.5, 95.5, 95.8), pd.Timestamp("2026-01-05"), None, cfg)
    assert t is None
    assert pos.pending_exit_reason == "thesis_failure"
    t = _manage_position(pos, bar(96.5, 97.0, 95.0, 96.0), pd.Timestamp("2026-01-06"), None, cfg)
    assert t is not None
    assert t.exit_reason == "thesis_failure"


def test_momentum_failure_needs_confirmation(cfg):
    """One weak close must NOT trigger the early exit; two consecutive do."""
    pos = position(stop=90.0, structure_low=91.0)   # keep stop/structure out of the way
    weak = bar(100.0, 100.5, 97.0, 97.2, ema20=100.0, atr=2.0, macd_hist=-0.5)
    assert _manage_position(pos, weak, pd.Timestamp("2026-01-05"), None, cfg) is None
    assert pos.pending_exit_reason is None          # 1 day: not yet
    assert _manage_position(pos, weak, pd.Timestamp("2026-01-06"), None, cfg) is None
    assert pos.pending_exit_reason == "momentum_failure"
