"""Central configuration for the swing-trade selection engine.

Every numeric threshold in this file is an INITIAL HYPOTHESIS, not a tuned
constant. The walk-forward validator (swingscan.backtest.walkforward) is the
only sanctioned way to change them; do not hand-tune to a single backtest.

All parameters can be overridden from a YAML file via Config.from_yaml().
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class DataConfig:
    cache_dir: str = "cache"
    history_years: int = 3            # history pulled for a live scan
    backtest_history_years: int = 10  # history pulled for backtests
    max_staleness_days: int = 5       # reject symbol if last bar older than this (trading days ~ calendar buffer)
    min_history_bars: int = 260       # ~1 trading year required to compute EMA200 etc.
    batch_size: int = 50              # yfinance download batch


@dataclass
class LiquidityConfig:
    min_price: float = 100.0                    # rupees
    min_avg_traded_value: float = 5e7           # 20d avg traded value, rupees (5 crore)
    min_avg_volume: float = 100_000             # 20d avg shares
    traded_value_window: int = 20


@dataclass
class RegimeConfig:
    # Composite regime score in [-100, +100] mapped to six classes.
    strong_bull_cutoff: float = 60.0
    bull_cutoff: float = 30.0
    neutral_cutoff: float = 0.0
    weak_cutoff: float = -25.0
    bear_cutoff: float = -55.0
    rsi_period: int = 14
    adx_period: int = 14
    roc_period: int = 20
    breadth_ema: int = 50            # breadth = % of universe above this EMA
    vix_calm: float = 14.0           # below: supportive
    vix_stressed: float = 20.0       # above: hostile
    # Per-regime selection policy: (max_candidates, min_total_score)
    policy: dict = field(default_factory=lambda: {
        "STRONG_BULLISH": {"max_candidates": 5, "min_score": 75.0},
        "BULLISH":        {"max_candidates": 5, "min_score": 75.0},
        "NEUTRAL":        {"max_candidates": 3, "min_score": 80.0},
        "WEAK":           {"max_candidates": 2, "min_score": 85.0},
        "BEARISH":        {"max_candidates": 1, "min_score": 88.0},
        "STRONG_BEARISH": {"max_candidates": 0, "min_score": 101.0},  # no longs
    })


@dataclass
class RelativeStrengthConfig:
    windows: tuple = (5, 10, 20, 60)
    # weights for blending horizon excess returns into one RS score
    window_weights: tuple = (0.15, 0.25, 0.40, 0.20)
    min_percentile: float = 60.0     # hard gate: stock must be in top 40% of universe RS


@dataclass
class TrendConfig:
    ema_fast: int = 20
    ema_mid: int = 50
    ema_slow: int = 200
    slope_window: int = 10               # bars used for EMA slope
    max_extension_atr: float = 4.0       # close more than this many ATR above EMA20 = too extended (hard gate)
    swing_pivot_strength: int = 2        # bars each side to confirm a swing pivot
    swing_lookback: int = 40


@dataclass
class MomentumConfig:
    rsi_period: int = 14
    rsi_floor: float = 50.0
    rsi_overheated: float = 80.0     # above this entry quality degrades
    adx_period: int = 14
    adx_min: float = 18.0
    roc_period: int = 10


@dataclass
class VolumeConfig:
    avg_window: int = 20
    long_window: int = 50
    breakout_vol_mult: float = 1.5       # breakout day volume vs 20d avg (validate via walk-forward)
    contraction_ratio: float = 1.0       # pullback avg vol must be <= this x 20d avg
    accumulation_window: int = 20        # up/down volume balance window


@dataclass
class PullbackConfig:
    min_days_since_high: int = 2
    max_days_since_high: int = 10
    min_depth_atr: float = 0.8
    max_depth_atr: float = 3.5
    max_depth_pct: float = 0.12
    ema_proximity_atr: float = 1.0       # pullback low must come within this of EMA20/EMA50
    trigger_lookback: int = 3            # entry = break of the high of the last N bars
    entry_zone_atr: float = 0.25
    stop_atr_mult: float = 0.5           # stop = swing low - mult*ATR


@dataclass
class BreakoutConfig:
    min_consolidation: int = 5
    max_consolidation: int = 15
    tightness_atr_mult: float = 3.0      # (window high - window low) <= mult*ATR
    atr_compression_max: float = 1.1     # ATR10/ATR50 must be <= this
    min_close_location: float = 0.55     # breakout close in upper part of day range
    max_gap_atr: float = 0.75            # open gap above resistance beyond this = exhaustion risk
    max_extension_atr: float = 1.5       # close beyond resistance by more than this = DO NOT CHASE
    entry_zone_atr: float = 0.6          # zone = [resistance, resistance + this*ATR]
    stop_atr_mult: float = 0.5           # stop = consolidation low - mult*ATR
    max_risk_atr: float = 3.0            # reject if entry-stop wider than this many ATR


@dataclass
class RiskConfig:
    t1_r_multiple: float = 1.8
    t2_r_multiple: float = 2.8
    min_rr_t1: float = 1.5
    min_rr_t2: float = 2.2
    resistance_lookback: int = 120       # bars scanned for overhead resistance
    resistance_buffer: float = 0.995     # place target just under resistance
    account_capital: float = 1_000_000.0
    risk_per_trade_pct: float = 0.5      # % of capital risked per trade
    max_position_pct: float = 20.0       # notional cap per position


@dataclass
class ScoreWeights:
    """Initial weights per spec section 15. Sum = 100."""
    market_regime: float = 10.0
    sector_strength: float = 15.0
    relative_strength: float = 20.0
    trend_structure: float = 15.0
    setup_quality: float = 15.0
    volume_confirmation: float = 10.0
    momentum: float = 5.0
    risk_reward: float = 10.0

    def as_dict(self) -> dict[str, float]:
        return dataclasses.asdict(self)


@dataclass
class RankingConfig:
    weights: ScoreWeights = field(default_factory=ScoreWeights)
    tiers: dict = field(default_factory=lambda: {
        "A+": 90.0, "A": 85.0, "B+": 80.0, "B": 75.0,   # < B floor -> reject
    })
    reject_below: float = 75.0


@dataclass
class CorrelationConfig:
    window: int = 60
    max_pairwise: float = 0.85
    max_per_sector: int = 2


@dataclass
class ExitConfig:
    max_holding_days: int = 15           # absolute maximum, not a goal
    trail_after_t1: bool = True          # after T1: stop to breakeven
    # Momentum-failure detector (early exit). Needs `confirm_days`
    # consecutive daily closes failing to avoid exiting on one red day.
    fail_close_below_ema: int = 20
    fail_confirm_days: int = 2
    fail_atr_below_ema: float = 0.25     # close must be below EMA20 by this*ATR to count
    fail_rs_collapse: float = -3.0       # 5d excess return vs NIFTY below this % = RS collapse signal


@dataclass
class CostsConfig:
    """Indian delivery-equity cost model (per side unless noted)."""
    brokerage_pct: float = 0.0003        # 0.03% (cap ignored; discount brokers often 0)
    brokerage_cap: float = 20.0          # rupees per order cap (discount broker style)
    stt_pct: float = 0.001               # 0.1% on delivery, buy AND sell
    exchange_pct: float = 0.0000297      # NSE transaction charge
    sebi_pct: float = 0.000001           # SEBI turnover fee
    gst_pct: float = 0.18                # on brokerage + exchange + sebi
    stamp_duty_pct: float = 0.00015      # buy side only
    slippage_pct: float = 0.0005         # 5 bps each side, model assumption


@dataclass
class BacktestConfig:
    entry_valid_days: int = 2            # entry order lives N days, then cancelled
    conservative_same_day: bool = True   # if stop & target both touched in one bar, assume stop first
    partial_at_t1: float = 0.5           # fraction sold at T1
    max_open_positions: int = 10         # portfolio-level cap during simulation


@dataclass
class Config:
    data: DataConfig = field(default_factory=DataConfig)
    liquidity: LiquidityConfig = field(default_factory=LiquidityConfig)
    regime: RegimeConfig = field(default_factory=RegimeConfig)
    rs: RelativeStrengthConfig = field(default_factory=RelativeStrengthConfig)
    trend: TrendConfig = field(default_factory=TrendConfig)
    momentum: MomentumConfig = field(default_factory=MomentumConfig)
    volume: VolumeConfig = field(default_factory=VolumeConfig)
    pullback: PullbackConfig = field(default_factory=PullbackConfig)
    breakout: BreakoutConfig = field(default_factory=BreakoutConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    ranking: RankingConfig = field(default_factory=RankingConfig)
    correlation: CorrelationConfig = field(default_factory=CorrelationConfig)
    exits: ExitConfig = field(default_factory=ExitConfig)
    costs: CostsConfig = field(default_factory=CostsConfig)
    backtest: BacktestConfig = field(default_factory=BacktestConfig)

    @classmethod
    def from_yaml(cls, path: str | Path | None = None) -> "Config":
        cfg = cls()
        if path is None:
            return cfg
        raw = yaml.safe_load(Path(path).read_text()) or {}
        _apply_overrides(cfg, raw)
        return cfg


def _apply_overrides(obj: Any, overrides: dict) -> None:
    for key, value in overrides.items():
        if not hasattr(obj, key):
            raise KeyError(f"Unknown config key: {key!r}")
        current = getattr(obj, key)
        if dataclasses.is_dataclass(current) and isinstance(value, dict):
            _apply_overrides(current, value)
        else:
            setattr(obj, key, value)
