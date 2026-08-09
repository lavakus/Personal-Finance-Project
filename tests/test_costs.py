from swingscan.backtest.costs import round_trip_charges, side_charges, slip_buy, slip_sell
from swingscan.config import Config


def test_buy_side_charges_hand_computed():
    cfg = Config()
    value = 100_000.0
    b = side_charges(value, is_buy=True, cfg=cfg)
    assert abs(b.brokerage - 20.0) < 1e-9            # 0.03% = 30 -> capped at 20
    assert abs(b.stt - 100.0) < 1e-9                 # 0.1%
    assert abs(b.exchange - 2.97) < 1e-6             # 0.00297%
    assert abs(b.sebi - 0.10) < 1e-6
    assert abs(b.gst - (20.0 + 2.97 + 0.10) * 0.18) < 1e-6
    assert abs(b.stamp_duty - 15.0) < 1e-9           # 0.015% buy only
    assert b.total > 0


def test_sell_side_has_no_stamp_duty():
    cfg = Config()
    s = side_charges(50_000.0, is_buy=False, cfg=cfg)
    assert s.stamp_duty == 0.0
    assert s.stt > 0                                  # delivery STT applies both sides


def test_round_trip_reasonable_magnitude():
    cfg = Config()
    total = round_trip_charges(100_000.0, 105_000.0, cfg)
    # Delivery round trip should be roughly 0.25-0.35% of turnover
    assert 200.0 < total < 700.0


def test_slippage_direction():
    cfg = Config()
    assert slip_buy(100.0, cfg) > 100.0
    assert slip_sell(100.0, cfg) < 100.0
