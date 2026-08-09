import pandas as pd
import pytest

from swingscan.config import Config
from swingscan.indicators import compute_indicator_panel
from swingscan.setups import detect_breakout, detect_pullback
from tests.conftest import make_breakout_setup, make_pullback_setup, make_uptrend


@pytest.fixture
def cfg():
    return Config()


def test_pullback_detected_on_valid_setup(cfg):
    panel = compute_indicator_panel(make_pullback_setup(), cfg)
    res = detect_pullback(panel, cfg)
    assert res.valid, res.reject_reason
    assert res.setup_type == "PULLBACK"
    assert res.stop < res.entry_low <= res.entry_high
    assert res.structure_low < res.entry_low
    assert res.score > 40


def test_pullback_rejected_without_pullback(cfg):
    """A smooth uptrend making new highs every day has no pullback to buy."""
    panel = compute_indicator_panel(make_uptrend(), cfg)
    res = detect_pullback(panel, cfg)
    assert not res.valid


def test_pullback_rejected_when_too_deep(cfg):
    df = make_pullback_setup()
    # deepen the pullback to a structural breakdown (>12%)
    for k in range(-5, -1):
        col = df.columns.get_indexer(["Close", "Low", "Open", "High"])
        drop = 1 - 0.04 * (k + 6)
        base = df["Close"].iloc[-6]
        df.iloc[k, col[0]] = base * drop
        df.iloc[k, col[1]] = base * drop * 0.99
        df.iloc[k, col[2]] = base * drop * 1.01
        df.iloc[k, col[3]] = base * drop * 1.012
    panel = compute_indicator_panel(df, cfg)
    res = detect_pullback(panel, cfg)
    assert not res.valid


def test_breakout_detected_on_valid_setup(cfg):
    panel = compute_indicator_panel(make_breakout_setup(), cfg)
    res = detect_breakout(panel, cfg)
    assert res.valid, res.reject_reason
    assert res.setup_type == "BREAKOUT"
    assert res.entry_low == res.key_level          # zone starts at resistance
    assert res.stop < res.structure_low            # stop below consolidation low
    assert res.score > 40


def test_breakout_rejected_without_volume(cfg):
    df = make_breakout_setup()
    df.iloc[-1, df.columns.get_indexer(["Volume"])[0]] = 700_000   # no expansion
    panel = compute_indicator_panel(df, cfg)
    res = detect_breakout(panel, cfg)
    assert not res.valid
    assert "volume" in res.reject_reason.lower()


def test_breakout_rejected_on_exhaustion_gap(cfg):
    df = make_breakout_setup()
    resistance = float(df["High"].iloc[-13:-1].max())
    idx = df.columns.get_indexer(["Open", "High", "Low", "Close"])
    df.iloc[-1, idx[0]] = resistance * 1.05        # huge gap open
    df.iloc[-1, idx[1]] = resistance * 1.06
    df.iloc[-1, idx[2]] = resistance * 1.045
    df.iloc[-1, idx[3]] = resistance * 1.055
    panel = compute_indicator_panel(df, cfg)
    res = detect_breakout(panel, cfg)
    assert not res.valid
    assert "chase" in res.reject_reason.lower() or "extended" in res.reject_reason.lower()


def test_breakout_rejected_without_breakout(cfg):
    df = make_breakout_setup()
    resistance = float(df["High"].iloc[-13:-1].max())
    idx = df.columns.get_indexer(["Open", "High", "Low", "Close"])
    df.iloc[-1, idx[3]] = resistance * 0.998       # closes below the level
    df.iloc[-1, idx[1]] = resistance * 1.001
    panel = compute_indicator_panel(df, cfg)
    res = detect_breakout(panel, cfg)
    assert not res.valid
