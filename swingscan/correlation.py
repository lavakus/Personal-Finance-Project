"""Duplicate-exposure control (spec section 17).

Greedy selection by score: a candidate is dropped if its 60-day daily-return
correlation with any already-selected candidate exceeds the cap, or if its
sector already has the maximum number of picks.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def filter_correlated(candidates: list, returns: dict[str, pd.Series], cfg) -> tuple[list, list]:
    """candidates: list of Candidate (sorted best-first is NOT required).
    returns: symbol -> daily return series (last `window` bars, causal).
    Returns (kept, dropped_with_reasons).
    """
    ordered = sorted(candidates, key=lambda c: -c.score.total)
    kept, dropped = [], []
    sector_counts: dict[str, int] = {}

    for cand in ordered:
        sec = cand.sector or "UNMAPPED"
        if sector_counts.get(sec, 0) >= cfg.correlation.max_per_sector:
            cand.reject_reason = f"sector cap: already {sector_counts[sec]} picks in {sec}"
            dropped.append(cand)
            continue
        too_similar = None
        r1 = returns.get(cand.symbol)
        if r1 is not None:
            for k in kept:
                r2 = returns.get(k.symbol)
                if r2 is None:
                    continue
                joined = pd.concat([r1, r2], axis=1).dropna().tail(cfg.correlation.window)
                if len(joined) >= 20:
                    corr = float(joined.corr().iloc[0, 1])
                    if corr > cfg.correlation.max_pairwise:
                        too_similar = (k.symbol, corr)
                        break
        if too_similar:
            cand.reject_reason = (f"correlation {too_similar[1]:.2f} with selected {too_similar[0]} "
                                  f"> {cfg.correlation.max_pairwise} — effectively the same trade")
            dropped.append(cand)
        else:
            kept.append(cand)
            sector_counts[sec] = sector_counts.get(sec, 0) + 1
    return kept, dropped
