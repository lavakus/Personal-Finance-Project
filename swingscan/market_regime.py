"""Market regime classification (spec section 3).

Composite score in [-100, +100] built from NIFTY trend stack, momentum
(RSI/ADX/ROC), market breadth (% of scan universe above EMA50) and India VIX.
Mapped to six classes; each class carries a selection policy (max candidates,
minimum quality score) so a hostile tape tightens the funnel automatically.

Everything is causal — regime at date D uses data <= D.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import indicators as ind

REGIMES = ["STRONG_BEARISH", "BEARISH", "WEAK", "NEUTRAL", "BULLISH", "STRONG_BULLISH"]


@dataclass
class RegimeState:
    label: str
    score: float                      # composite [-100, 100]
    stock_score: float                # 0-100 contribution to per-stock quality score
    max_candidates: int
    min_total_score: float
    allow_longs: bool
    details: dict = field(default_factory=dict)


def compute_regime_series(nifty: pd.DataFrame, cfg,
                          breadth: pd.Series | None = None,
                          vix: pd.Series | None = None) -> pd.DataFrame:
    """Vectorized regime score/label for every date in `nifty`.

    breadth: fraction (0-1) of universe stocks above their EMA50, per date.
    vix: India VIX close, per date.
    """
    c = nifty["Close"]
    e20, e50, e200 = ind.ema(c, 20), ind.ema(c, 50), ind.ema(c, 200)

    # Trend stack: -40..+40
    trend = (
        (c > e20).astype(float) + (e20 > e50).astype(float) + (e50 > e200).astype(float)
    ) / 3.0 * 80.0 - 40.0

    # Momentum: RSI centered at 50 (-25..+25), ROC sign/strength (-15..+15)
    rsi = ind.rsi(c, cfg.regime.rsi_period)
    mom_rsi = ((rsi - 50.0) / 50.0 * 25.0).clip(-25, 25)
    roc = ind.roc(c, cfg.regime.roc_period)
    mom_roc = (roc * 3.0).clip(-15, 15)

    # ADX directional kicker: trend strength in the direction of DI (-10..+10)
    adx, pdi, mdi = ind.adx(nifty, cfg.regime.adx_period)
    adx_dir = np.sign(pdi - mdi) * (adx.clip(0, 40) / 40.0 * 10.0)

    score = trend + mom_rsi + mom_roc + adx_dir

    # Breadth: -15..+15 around 50% participation
    if breadth is not None:
        b = breadth.reindex(nifty.index).ffill()
        score = score + ((b - 0.5) * 60.0).clip(-15, 15).fillna(0.0)

    # VIX: calm adds, stress subtracts (0 / -10 / +5)
    if vix is not None:
        v = vix.reindex(nifty.index).ffill()
        vix_adj = pd.Series(0.0, index=nifty.index)
        vix_adj[v < cfg.regime.vix_calm] = 5.0
        vix_adj[v > cfg.regime.vix_stressed] = -10.0
        score = score + vix_adj.fillna(0.0)

    score = score.clip(-100, 100)
    out = pd.DataFrame({"score": score}, index=nifty.index)
    out["label"] = classify(score, cfg)
    return out


def classify(score: pd.Series | float, cfg) -> pd.Series | str:
    r = cfg.regime
    bins = [-np.inf, r.bear_cutoff, r.weak_cutoff, r.neutral_cutoff,
            r.bull_cutoff, r.strong_bull_cutoff, np.inf]
    if isinstance(score, pd.Series):
        return pd.cut(score, bins=bins, labels=REGIMES).astype(str)
    return str(pd.cut(pd.Series([score]), bins=bins, labels=REGIMES).iloc[0])


def regime_state(score: float, label: str, cfg, details: dict | None = None) -> RegimeState:
    policy = cfg.regime.policy[label]
    return RegimeState(
        label=label,
        score=score,
        stock_score=float(np.clip((score + 100.0) / 2.0, 0.0, 100.0)),
        max_candidates=policy["max_candidates"],
        min_total_score=policy["min_score"],
        allow_longs=policy["max_candidates"] > 0,
        details=details or {},
    )


def compute_breadth(closes: pd.DataFrame, ema_window: int = 50) -> pd.Series:
    """% of universe above EMA(ema_window). `closes`: DataFrame[date x symbol]."""
    above = pd.DataFrame(
        {s: closes[s] > ind.ema(closes[s].dropna(), ema_window).reindex(closes.index)
         for s in closes.columns}
    )
    have_data = closes.notna()
    return above.where(have_data).sum(axis=1) / have_data.sum(axis=1).replace(0, np.nan)
