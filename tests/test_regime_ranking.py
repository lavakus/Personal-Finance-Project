import numpy as np
import pandas as pd
import pytest

from swingscan.config import Config
from swingscan.market_regime import REGIMES, compute_regime_series, regime_state
from swingscan.ranking import score_candidate, tier_for
from tests.conftest import make_uptrend, bdates


@pytest.fixture
def cfg():
    return Config()


def test_bull_market_classified_bullish(cfg):
    nifty = make_uptrend(300, start_price=20000, drift=0.0015)
    reg = compute_regime_series(nifty, cfg)
    assert reg["label"].iloc[-1] in ("BULLISH", "STRONG_BULLISH")


def test_bear_market_classified_bearish(cfg):
    idx = bdates(300)
    close = 20000 * (1 - 0.002) ** np.arange(300)
    nifty = pd.DataFrame({"Open": close, "High": close * 1.005,
                          "Low": close * 0.995, "Close": close,
                          "Volume": 1e6}, index=idx)
    reg = compute_regime_series(nifty, cfg)
    assert reg["label"].iloc[-1] in ("BEARISH", "STRONG_BEARISH")


def test_strong_bearish_disables_longs(cfg):
    st = regime_state(-80.0, "STRONG_BEARISH", cfg)
    assert not st.allow_longs
    assert st.max_candidates == 0


def test_regime_policy_tightens_with_weakness(cfg):
    bull = regime_state(70.0, "STRONG_BULLISH", cfg)
    weak = regime_state(-30.0, "WEAK", cfg)
    assert weak.max_candidates < bull.max_candidates
    assert weak.min_total_score > bull.min_total_score


def test_score_weights_sum_to_100(cfg):
    assert abs(sum(cfg.ranking.weights.as_dict().values()) - 100.0) < 1e-9


def test_score_candidate_perfect_and_zero(cfg):
    names = list(cfg.ranking.weights.as_dict())
    perfect = score_candidate({k: 100.0 for k in names}, cfg)
    zero = score_candidate({k: 0.0 for k in names}, cfg)
    assert abs(perfect.total - 100.0) < 1e-9
    assert perfect.tier == "A+"
    assert zero.total == 0.0
    assert zero.tier == "REJECT"


def test_tier_boundaries(cfg):
    assert tier_for(90.0, cfg) == "A+"
    assert tier_for(85.0, cfg) == "A"
    assert tier_for(80.0, cfg) == "B+"
    assert tier_for(75.0, cfg) == "B"
    assert tier_for(74.9, cfg) == "REJECT"


def test_score_rejects_unknown_components(cfg):
    with pytest.raises(AssertionError):
        score_candidate({"bogus": 50.0}, cfg)
