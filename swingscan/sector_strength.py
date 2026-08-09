"""Sector relative strength vs NIFTY (spec section 4).

Sector RS = sector return - NIFTY return, blended across 5/10/20/60-day
horizons, ranked across sectors. Strong sector + strong stock is preferred
over strong-looking stock in a weak sector.

Sector series are SYNTHETIC composites built from universe constituents
(equal-weight daily returns per NSE industry group) rather than Yahoo's
^CNX* sector indices: several of those stopped updating (observed stale by
3+ weeks in Aug 2026), and a stale sector index silently poisons every
cross-sector rank. Composites are always exactly as fresh as the stock
data and cover ALL industries, including ones with no NSE sector index.
Caveat: built from current members (same survivorship note as the universe).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

WINDOWS = (5, 10, 20, 60)
WINDOW_WEIGHTS = (0.20, 0.25, 0.35, 0.20)


@dataclass
class SectorTable:
    table: pd.DataFrame          # index: sector name; cols: rs5..rs60, rs_blend, rank, score

    def score_for(self, sector: str | None) -> float:
        """0-100 sector score for a stock; neutral 50 when sector unmapped."""
        if sector is None or sector not in self.table.index:
            return 50.0
        return float(self.table.loc[sector, "score"])

    def rank_for(self, sector: str | None) -> int | None:
        if sector is None or sector not in self.table.index:
            return None
        return int(self.table.loc[sector, "rank"])

    def rs_for(self, sector: str | None, window: int = 20) -> float | None:
        if sector is None or sector not in self.table.index:
            return None
        return float(self.table.loc[sector, f"rs{window}"])


def build_sector_composites(prices: dict[str, pd.DataFrame],
                            universe: pd.DataFrame,
                            min_members: int = 4) -> dict[str, pd.Series]:
    """Equal-weight return composite per industry group -> synthetic close
    series (base 100). Causal: only uses each day's member closes."""
    out: dict[str, pd.Series] = {}
    for industry, group in universe.groupby("industry"):
        members = [s for s in group["symbol"] if s in prices]
        if len(members) < min_members:
            continue
        rets = pd.DataFrame({s: prices[s]["Close"].pct_change() for s in members})
        have = rets.notna().sum(axis=1)
        mean_ret = rets.mean(axis=1)
        idx = (1.0 + mean_ret.fillna(0.0)).cumprod() * 100.0
        idx[have == 0] = np.nan
        out[str(industry)] = idx.dropna()
    return out


def compute_sector_table(sector_closes: dict[str, pd.Series],
                         nifty_close: pd.Series,
                         as_of: pd.Timestamp) -> SectorTable:
    rows = {}
    nifty = nifty_close.loc[:as_of]
    for name, close in sector_closes.items():
        s = close.loc[:as_of].dropna()
        if len(s) < max(WINDOWS) + 1 or (as_of - s.index[-1]).days > 7:
            continue
        row = {}
        for w in WINDOWS:
            sec_ret = (s.iloc[-1] / s.iloc[-1 - w] - 1.0) * 100.0
            nif_ret = (nifty.iloc[-1] / nifty.iloc[-1 - w] - 1.0) * 100.0
            row[f"ret{w}"] = sec_ret
            row[f"rs{w}"] = sec_ret - nif_ret
        row["rs_blend"] = sum(row[f"rs{w}"] * wt for w, wt in zip(WINDOWS, WINDOW_WEIGHTS))
        rows[name] = row

    table = pd.DataFrame(rows).T
    if table.empty:
        return SectorTable(table)
    table["rank"] = table["rs_blend"].rank(ascending=False, method="min").astype(int)
    # score: percentile of blended RS across sectors, plus absolute kicker
    pct = table["rs_blend"].rank(pct=True) * 100.0
    absolute = np.clip(table["rs_blend"] * 8.0, -20.0, 20.0)   # outperforming in absolute terms matters too
    table["score"] = np.clip(0.8 * pct + absolute, 0.0, 100.0)
    return SectorTable(table.sort_values("rank"))
