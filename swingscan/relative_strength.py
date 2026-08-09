"""Stock relative strength vs NIFTY and vs its own sector (spec section 5).

Excess returns at 5/10/20/60 days are blended (weights favor the 20-day
horizon for a 7-15 day swing), then converted to a cross-sectional
percentile so the score always means "vs. today's opportunity set".

The percentile panel is computed vectorized in pipeline.MarketData (over
liquidity-passing symbols per date); this module holds the per-stock detail
and scoring used for explainability and gating.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class RSResult:
    score: float                       # 0-100 percentile-based score
    passed: bool                       # hard gate: percentile >= cfg.rs.min_percentile
    excess_nifty: dict = field(default_factory=dict)    # window -> %
    excess_sector: dict = field(default_factory=dict)   # window -> %
    beats_nifty: bool = False
    beats_sector: bool = False
    percentile: float = 0.0


def index_returns(close: pd.Series, as_of: pd.Timestamp, windows) -> dict[int, float]:
    s = close.loc[:as_of].dropna()
    out = {}
    for w in windows:
        out[w] = (s.iloc[-1] / s.iloc[-1 - w] - 1.0) * 100.0 if len(s) > w else np.nan
    return out


def blend_panel(ret_frames: dict[int, pd.DataFrame],
                nifty_close: pd.Series, cfg) -> pd.DataFrame:
    """Vectorized blended excess return vs NIFTY: DataFrame[date x symbol]."""
    windows, weights = cfg.rs.windows, cfg.rs.window_weights
    out = None
    for w, wt in zip(windows, weights):
        rets = ret_frames[w]
        nifty_ret = (nifty_close.pct_change(w) * 100.0).reindex(rets.index)
        excess = rets.sub(nifty_ret, axis=0)
        out = excess * wt if out is None else out + excess * wt
    return out


def rs_detail(row: pd.Series, nifty_ret: dict[int, float],
              sector_ret: dict[int, float] | None,
              percentile: float, cfg) -> RSResult:
    """Full RS explanation for one stock, given its precomputed percentile."""
    windows = cfg.rs.windows
    srets = {w: float(row[f"ret{w}"]) for w in windows}
    exc_n = {w: srets[w] - nifty_ret[w] for w in windows
             if not np.isnan(nifty_ret.get(w, np.nan))}
    exc_s = ({w: srets[w] - sector_ret[w] for w in windows
              if not np.isnan(sector_ret.get(w, np.nan))} if sector_ret else {})
    beats_nifty = all(v > 0 for k, v in exc_n.items() if k in (10, 20))
    beats_sector = all(v > 0 for k, v in exc_s.items() if k in (10, 20)) if exc_s else True
    bonus = 5.0 if (beats_nifty and beats_sector and exc_s) else 0.0
    return RSResult(
        score=float(np.clip(percentile + bonus, 0.0, 100.0)),
        passed=percentile >= cfg.rs.min_percentile,
        excess_nifty=exc_n, excess_sector=exc_s,
        beats_nifty=beats_nifty, beats_sector=beats_sector,
        percentile=float(percentile),
    )
