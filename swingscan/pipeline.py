"""Scan orchestration (spec section 33).

UNIVERSE -> DATA VALIDATION -> LIQUIDITY -> MARKET REGIME -> SECTOR RS ->
STOCK RS -> TREND -> MOMENTUM -> VOLUME -> SETUPS -> ENTRY/STOP/TARGETS ->
R:R -> SCORE -> CORRELATION -> RANKING -> TRADE PLAN.

Design notes
------------
* `scan_asof` is pure with respect to time: it only reads bars <= as_of.
  The live scan and the backtest share this single code path, so there is
  no live/backtest drift and the no-lookahead property is testable.
* Cheap gates (data quality, liquidity, trend stack, RS percentile) are
  precomputed as vectorized cross-sectional panels in MarketData. Every
  operation used there is causal (rolling/ewm/pct_change/shift), so
  precomputing over full history leaks nothing. The expensive per-stock
  evaluation only runs on the (small) daily shortlist.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import Config
from .correlation import filter_correlated
from .indicators import compute_indicator_panel
from .market_regime import RegimeState, compute_regime_series, regime_state
from .momentum import evaluate_momentum
from .ranking import score_candidate
from .relative_strength import blend_panel, index_returns, rs_detail
from .risk import build_risk_plan, position_size
from .sector_strength import SectorTable, compute_sector_table
from .setups import detect_breakout, detect_pullback
from .trade_plan import Candidate
from .trend import evaluate_trend
from .volume import evaluate_volume

log = logging.getLogger(__name__)


@dataclass
class Funnel:
    scanned: int = 0
    quality: int = 0
    liquidity: int = 0
    trend: int = 0
    relative_strength: int = 0
    setup: int = 0
    risk_reward: int = 0
    score: int = 0
    final: int = 0


@dataclass
class ScanResult:
    as_of: pd.Timestamp
    regime: RegimeState
    sector_table: SectorTable
    funnel: Funnel
    candidates: list[Candidate]
    near_misses: list[tuple[str, str]] = field(default_factory=list)   # (symbol, reason)
    no_trade: bool = False
    no_trade_reason: str | None = None


class MarketData:
    """Precomputed, causal panels shared by live scan and backtest."""

    def __init__(self, panels, universe, nifty, sector_closes, vix, cfg: Config):
        self.panels: dict[str, pd.DataFrame] = panels
        self.universe = universe
        self.nifty = nifty
        self.sector_closes = sector_closes
        self.vix = vix
        self.sectors: dict[str, str | None] = dict(zip(universe["symbol"], universe["sector"]))

        def frame(col: str) -> pd.DataFrame:
            return pd.DataFrame({s: p[col] for s, p in panels.items()})

        close = frame("Close")
        self.dates = nifty.index

        # --- data-quality mask (vectorized mirror of data.quality checks) ---
        has_bar = close.notna()
        enough_history = has_bar.cumsum() >= cfg.data.min_history_bars
        volume = frame("Volume")
        few_zero_vol = (volume.fillna(0) == 0).rolling(60, min_periods=1).sum() <= 5
        sane_moves = (close.pct_change().abs() > 0.40).rolling(60, min_periods=1).sum() == 0
        quality = has_bar & enough_history & few_zero_vol & sane_moves

        # --- liquidity mask ---
        traded_value = frame("traded_value20")
        vol_avg20 = frame("vol_avg20")
        liq = cfg.liquidity
        liquidity = (
            (close >= liq.min_price)
            & (traded_value >= liq.min_avg_traded_value)
            & (vol_avg20 >= liq.min_avg_volume)
        )

        # --- fast trend mask (full structure check runs per-shortlist) ---
        e20, e50, e200 = frame("ema20"), frame("ema50"), frame("ema200")
        atr = frame("atr")
        ext_ok = (close - e20) / atr <= cfg.trend.max_extension_atr
        trend = (
            (close > e20) & (e20 > e50) & (e50 > e200)
            & (frame("ema20_slope") > 0) & (frame("ema50_slope") > 0)
            & ext_ok
        )

        self.quality_mask = quality
        self.liquidity_mask = quality & liquidity
        self.trend_mask = self.liquidity_mask & trend
        self.has_bar = has_bar

        # --- RS percentile across liquidity passers, per date ---
        ret_frames = {w: frame(f"ret{w}") for w in cfg.rs.windows}
        rs_blend = blend_panel(ret_frames, nifty["Close"], cfg)
        self.rs_pct = rs_blend.where(self.liquidity_mask).rank(axis=1, pct=True) * 100.0

        # --- breadth + regime ---
        above50 = (close > e50) & has_bar
        self.breadth = above50.sum(axis=1) / has_bar.sum(axis=1).replace(0, np.nan)
        self.regime_series = compute_regime_series(nifty, cfg, breadth=self.breadth, vix=vix)

    @classmethod
    def build(cls, prices: dict[str, pd.DataFrame], universe: pd.DataFrame,
              nifty: pd.DataFrame, sector_closes: dict[str, pd.Series],
              vix: pd.Series | None, cfg: Config) -> "MarketData":
        panels = {s: compute_indicator_panel(df, cfg)
                  for s, df in prices.items() if len(df) >= 60}
        return cls(panels, universe, nifty, sector_closes, vix, cfg)


def scan_asof(md: MarketData, as_of: pd.Timestamp, cfg: Config,
              collect_near_misses: bool = True) -> ScanResult:
    as_of = pd.Timestamp(as_of).normalize()
    funnel = Funnel()
    near: list[tuple[str, str]] = []
    uni = md.universe.set_index("symbol")

    # ---- market regime ------------------------------------------------
    reg_rows = md.regime_series.loc[:as_of]
    if reg_rows.empty:
        raise ValueError(f"No NIFTY data on/before {as_of.date()}")
    reg_row = reg_rows.iloc[-1]
    vix_val = None
    if md.vix is not None:
        v = md.vix.loc[:as_of].dropna()
        vix_val = float(v.iloc[-1]) if len(v) else None
    breadth_hist = md.breadth.loc[:as_of].dropna()
    regime = regime_state(float(reg_row["score"]), str(reg_row["label"]), cfg,
                          details={"vix": vix_val,
                                   "breadth": float(breadth_hist.iloc[-1]) if len(breadth_hist) else None,
                                   "nifty_close": float(md.nifty["Close"].loc[:as_of].iloc[-1])})

    sector_table = compute_sector_table(md.sector_closes, md.nifty["Close"], as_of)

    if not regime.allow_longs:
        return ScanResult(as_of, regime, sector_table, funnel, [], near, True,
                          f"Market regime {regime.label}: long entries disabled")

    # ---- vectorized gates for this date --------------------------------
    def row_or_none(mask: pd.DataFrame):
        idx = mask.index.asof(as_of)
        return mask.loc[idx] if idx is not pd.NaT else None

    has_bar = row_or_none(md.has_bar)
    if has_bar is None:
        raise ValueError(f"No stock data on/before {as_of.date()}")
    quality = row_or_none(md.quality_mask)
    liquidity = row_or_none(md.liquidity_mask)
    trend_fast = row_or_none(md.trend_mask)
    rs_row = row_or_none(md.rs_pct)

    funnel.scanned = int(has_bar.sum())
    funnel.quality = int(quality.sum())
    funnel.liquidity = int(liquidity.sum())
    funnel.trend = int(trend_fast.sum())
    rs_gate = trend_fast & (rs_row >= cfg.rs.min_percentile)
    funnel.relative_strength = int(rs_gate.sum())

    shortlist = [s for s in rs_gate.index[rs_gate.fillna(False)]]

    # ---- detailed evaluation on the shortlist ---------------------------
    nifty_ret = index_returns(md.nifty["Close"], as_of, cfg.rs.windows)
    sector_rets = {name: index_returns(close, as_of, cfg.rs.windows)
                   for name, close in md.sector_closes.items()}

    candidates: list[Candidate] = []
    views: dict[str, pd.DataFrame] = {}
    for sym in shortlist:
        view = md.panels[sym].loc[:as_of]
        views[sym] = view

        trend_res = evaluate_trend(view, cfg)   # full structure detail (slopes/HH-HL/extension)
        if not trend_res.passed:
            continue

        sector = md.sectors.get(sym)
        rs = rs_detail(view.iloc[-1], nifty_ret,
                       sector_rets.get(sector) if sector else None,
                       float(rs_row[sym]), cfg)

        mom = evaluate_momentum(view, cfg)
        vol = evaluate_volume(view, cfg)

        setup = detect_pullback(view, cfg)
        if not setup.valid:
            alt = detect_breakout(view, cfg)
            if alt.valid:
                setup = alt
        if not setup.valid:
            if collect_near_misses and setup.reject_reason and "watchlist" in setup.reject_reason:
                near.append((sym, setup.reject_reason))
            continue
        funnel.setup += 1

        rp = build_risk_plan(view, setup.entry_low, setup.entry_high, setup.stop, cfg)
        if not rp.valid:
            if collect_near_misses:
                near.append((sym, f"{setup.setup_type}: {rp.reject_reason}"))
            continue
        funnel.risk_reward += 1

        subscores = {
            "market_regime": regime.stock_score,
            "sector_strength": sector_table.score_for(sector),
            "relative_strength": rs.score,
            "trend_structure": trend_res.score,
            "setup_quality": setup.score,
            "volume_confirmation": vol.score,
            "momentum": mom.score,
            "risk_reward": rp.score,
        }
        breakdown = score_candidate(subscores, cfg)
        threshold = max(cfg.ranking.reject_below, regime.min_total_score)
        if breakdown.total < threshold:
            if collect_near_misses:
                near.append((sym, f"score {breakdown.total:.0f} below threshold {threshold:.0f}"))
            continue
        funnel.score += 1

        row = view.iloc[-1]
        why = _why(regime, sector, sector_table, rs, trend_res, setup, vol, mom, rp)
        warnings = trend_res.flags + setup.flags + mom.flags + vol.flags
        candidates.append(Candidate(
            symbol=sym,
            name=str(uni.loc[sym, "name"]) if sym in uni.index else sym,
            sector=sector, sector_rank=sector_table.rank_for(sector),
            price=float(row["Close"]), atr=float(row["atr"]),
            setup=setup, risk_plan=rp, score=breakdown,
            sizing=position_size(rp.entry, rp.stop, cfg),
            why=why, warnings=warnings,
            rs_excess_nifty_20d=rs.excess_nifty.get(20),
        ))

    # ---- correlation / duplicate exposure -------------------------------
    returns = {c.symbol: views[c.symbol]["Close"].pct_change().tail(cfg.correlation.window + 5)
               for c in candidates}
    kept, dropped = filter_correlated(candidates, returns, cfg)
    near.extend((c.symbol, c.reject_reason) for c in dropped)

    kept = sorted(kept, key=lambda c: -c.score.total)[: regime.max_candidates]
    for i, c in enumerate(kept, 1):
        c.rank = i
    funnel.final = len(kept)

    no_trade = len(kept) == 0
    return ScanResult(as_of, regime, sector_table, funnel, kept, near,
                      no_trade, "No candidate met all quality gates today" if no_trade else None)


def _why(regime, sector, sector_table, rs, trend_res, setup, vol, mom, rp) -> list[str]:
    why = [f"market regime {regime.label} (score {regime.score:+.0f})"]
    if sector and sector_table.rank_for(sector):
        why.append(f"sector {sector} ranked #{sector_table.rank_for(sector)} "
                   f"(20d RS {sector_table.rs_for(sector, 20):+.1f}% vs NIFTY)")
    exc20 = rs.excess_nifty.get(20)
    why.append(f"relative strength: top {max(1.0, 100 - rs.percentile):.0f}% of universe"
               + (f", 20d excess vs NIFTY {exc20:+.1f}%" if exc20 is not None else ""))
    if rs.excess_sector.get(20) is not None:
        why.append(f"vs own sector (20d): {rs.excess_sector[20]:+.1f}%")
    why.extend(trend_res.reasons[:2])
    why.extend(setup.reasons[:3])
    why.extend(vol.reasons[:1])
    why.extend(mom.reasons[:2])
    why.append(f"R:R {rp.rr1:.1f} to T1 / {rp.rr2:.1f} to T2")
    why.extend(rp.reasons[:1])
    return why
