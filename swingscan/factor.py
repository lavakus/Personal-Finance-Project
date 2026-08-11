"""Cross-sectional momentum core (12-1), long-only, periodic rebalance.

A structurally different edge from the swing scanner in `pipeline.py`:

    pipeline.py   5-60 day relative strength, pullback/breakout entry timing,
                  ~11 day holds, risk-sized -> most capital in cash.
    this module    12-month lookback skipping the last month, no entry timing,
                  equal-weight top-N, held for months -> fully invested.

`rank_asof` is pure with respect to time: it reads only bars <= as_of, exactly
like `scan_asof`, so the backtest and the live rebalance share one code path
and the no-lookahead property is testable.

The 12-1 formulation (skip the most recent month) is deliberate and is the
standard academic construction: the skip removes the short-term reversal that
contaminates raw 12-month momentum.

This module selects and sizes. It never places an order.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .backtest.costs import round_trip_charges, slip_buy, slip_sell
from .config import Config
from .pipeline import MarketData

log = logging.getLogger(__name__)

# Trading-day offsets. 21 ~ one month, 252 ~ one year.
SKIP_BARS = 21
LOOKBACK_BARS = 252


@dataclass
class FactorConfig:
    top_n: int = 10                 # names held
    hold_months: int = 3            # rebalance cadence
    max_per_sector: int = 3         # concentration cap on a 10-name book
    min_momentum: float = 0.0       # never hold a name whose 12-1 return is negative
    lookback_bars: int = LOOKBACK_BARS
    skip_bars: int = SKIP_BARS


@dataclass
class FactorPick:
    symbol: str
    name: str
    sector: str | None
    rank: int
    momentum_pct: float            # 12-1 return, %
    momentum_pctile: float         # 0-100 within the eligible universe
    price: float
    weight_pct: float              # equal weight
    vol_annual_pct: float | None   # 60d realised vol, for context
    why: list[str] = field(default_factory=list)


@dataclass
class FactorSelection:
    as_of: pd.Timestamp
    picks: list[FactorPick]
    eligible: int                  # universe size after quality/liquidity gates
    no_trade: bool = False
    no_trade_reason: str | None = None


def _row_asof(frame: pd.DataFrame, as_of: pd.Timestamp) -> pd.Series | None:
    idx = frame.index.asof(as_of)
    return None if idx is pd.NaT else frame.loc[idx]


def rank_asof(md: MarketData, as_of: pd.Timestamp, cfg: Config,
              fcfg: FactorConfig | None = None) -> FactorSelection:
    """Rank the universe on 12-1 momentum using only data up to `as_of`."""
    fcfg = fcfg or FactorConfig()
    as_of = pd.Timestamp(as_of).normalize()

    close = pd.DataFrame({s: p["Close"] for s, p in md.panels.items()})
    hist = close.loc[:as_of]
    need = fcfg.lookback_bars + 5
    if len(hist) < need:
        return FactorSelection(as_of, [], 0, True,
                               f"need {need} bars of history, have {len(hist)}")

    # 12-1 momentum: return from t-252 to t-21. Skipping the last month is what
    # separates momentum from short-term reversal.
    start = hist.iloc[-fcfg.lookback_bars]
    end = hist.iloc[-fcfg.skip_bars]
    mom = (end / start - 1).replace([np.inf, -np.inf], np.nan)

    # Reuse the engine's own causal gates rather than reinventing them: data
    # quality (enough history, no absurd moves) and liquidity (price, traded
    # value, volume).
    liquidity = _row_asof(md.liquidity_mask, as_of)
    if liquidity is None:
        return FactorSelection(as_of, [], 0, True, f"no data on/before {as_of.date()}")
    eligible_mask = liquidity.fillna(False) & mom.notna()
    mom = mom[eligible_mask[mom.index].fillna(False)]
    eligible = int(len(mom))
    if eligible < fcfg.top_n:
        return FactorSelection(as_of, [], eligible, True,
                               f"only {eligible} names passed quality/liquidity")

    pctile = mom.rank(pct=True) * 100.0
    vol = hist.pct_change().iloc[-60:].std() * np.sqrt(252) * 100.0

    uni = md.universe.set_index("symbol")
    ordered = mom.sort_values(ascending=False)

    # Sector cap: a concentrated top-10 book can otherwise end up 8-deep in one
    # sector, which is one bet at 8x size rather than eight bets.
    picks: list[FactorPick] = []
    per_sector: dict[str | None, int] = {}
    for sym, m in ordered.items():
        if len(picks) >= fcfg.top_n:
            break
        if m < fcfg.min_momentum:
            break                                  # ranked, so the rest are worse
        sec = md.sectors.get(sym)
        if sec is not None and per_sector.get(sec, 0) >= fcfg.max_per_sector:
            continue
        per_sector[sec] = per_sector.get(sec, 0) + 1
        picks.append(FactorPick(
            symbol=sym,
            name=str(uni.loc[sym, "name"]) if sym in uni.index else sym,
            sector=sec,
            rank=len(picks) + 1,
            momentum_pct=float(m * 100),
            momentum_pctile=float(pctile.get(sym, np.nan)),
            price=float(hist[sym].iloc[-1]),
            weight_pct=0.0,                        # filled below
            vol_annual_pct=float(vol.get(sym)) if pd.notna(vol.get(sym)) else None,
            why=[
                f"12-1 momentum {m * 100:+.1f}% "
                f"(top {max(1.0, 100 - pctile.get(sym, 0)):.0f}% of {eligible} eligible)",
                f"sector {sec or 'unmapped'}, capped at {fcfg.max_per_sector} per sector",
                f"equal weight, held ~{fcfg.hold_months} months to the next rebalance",
            ],
        ))

    if not picks:
        return FactorSelection(as_of, [], eligible, True,
                               "no name has positive 12-1 momentum")

    w = 100.0 / len(picks)
    for p in picks:
        p.weight_pct = w
    return FactorSelection(as_of, picks, eligible)


# ─────────────────────────────────────────────────────────── backtest

@dataclass
class FactorTrade:
    symbol: str
    entry_date: pd.Timestamp
    exit_date: pd.Timestamp
    entry_price: float
    exit_price: float
    weight_pct: float
    gross_pct: float
    net_pct: float                 # after costs, contribution to portfolio
    held_days: int


@dataclass
class FactorResult:
    equity: pd.Series              # portfolio value, rebalance-dated
    trades: list[FactorTrade]
    rebalances: int
    no_trade_dates: list[pd.Timestamp]


def rebalance_dates(md: MarketData, start: pd.Timestamp, end: pd.Timestamp,
                    hold_months: int) -> list[pd.Timestamp]:
    """Month-end trading days, taken every `hold_months`."""
    dates = md.dates[(md.dates >= start) & (md.dates <= end)]
    if len(dates) == 0:
        return []
    month_last = pd.Series(dates, index=dates).groupby(
        [dates.year, dates.month]).last().tolist()
    return month_last[::hold_months]


def backtest_factor(md: MarketData, cfg: Config, start: pd.Timestamp,
                    end: pd.Timestamp,
                    fcfg: FactorConfig | None = None) -> FactorResult:
    """Equal-weight top-N, rebalanced every `hold_months`, costs charged on
    every leg actually traded (names carried over are not re-charged)."""
    fcfg = fcfg or FactorConfig()
    close = pd.DataFrame({s: p["Close"] for s, p in md.panels.items()})
    rebals = rebalance_dates(md, start, end, fcfg.hold_months)
    if len(rebals) < 2:
        return FactorResult(pd.Series(dtype=float), [], 0, [])

    equity = float(cfg.risk.account_capital)
    curve: dict[pd.Timestamp, float] = {rebals[0]: equity}
    trades: list[FactorTrade] = []
    no_trade: list[pd.Timestamp] = []
    held: dict[str, float] = {}                    # symbol -> entry price paid

    for i, d in enumerate(rebals[:-1]):
        nxt = rebals[i + 1]
        sel = rank_asof(md, d, cfg, fcfg)
        if sel.no_trade:
            no_trade.append(d)
            # Stay in cash for this period rather than forcing a book.
            held = {}
            curve[nxt] = equity
            continue

        target = [p.symbol for p in sel.picks]
        weight = equity / len(target)

        # Exit names leaving the book; charge the sell leg.
        for sym in list(held):
            if sym not in target:
                held.pop(sym)

        new_held: dict[str, float] = {}
        period_pnl = 0.0
        for sym in target:
            px_in = close[sym].loc[:d].iloc[-1]
            fwd = close[sym].loc[d:nxt].dropna()
            if len(fwd) < 2 or not np.isfinite(px_in) or px_in <= 0:
                continue
            px_out = float(fwd.iloc[-1])
            carried = sym in held
            buy = px_in if carried else slip_buy(float(px_in), cfg)
            sell = slip_sell(px_out, cfg)
            shares = weight / buy
            gross = (sell - buy) * shares
            charges = 0.0 if carried else round_trip_charges(
                buy * shares, sell * shares, cfg)
            net = gross - charges
            period_pnl += net
            new_held[sym] = px_in
            trades.append(FactorTrade(
                symbol=sym, entry_date=d, exit_date=nxt,
                entry_price=float(buy), exit_price=px_out,
                weight_pct=100.0 / len(target),
                gross_pct=float(gross / weight * 100),
                net_pct=float(net / weight * 100),
                held_days=int((nxt - d).days),
            ))

        equity += period_pnl
        held = new_held
        curve[nxt] = equity

    return FactorResult(pd.Series(curve).sort_index(), trades, len(rebals) - 1, no_trade)


def metrics(res: FactorResult, capital: float) -> dict:
    eq = res.equity.dropna()
    if len(eq) < 3:
        return {"periods": 0, "note": "not enough rebalances"}
    years = (eq.index[-1] - eq.index[0]).days / 365.25
    total = eq.iloc[-1] / eq.iloc[0] - 1
    dd = (eq / eq.cummax() - 1).min()
    rets = eq.pct_change().dropna()
    per_year = len(eq) / max(years, 1e-9)
    net = [t.net_pct for t in res.trades]
    return {
        "periods": len(eq) - 1,
        "positions": len(res.trades),
        "total_return_pct": total * 100,
        "cagr_pct": ((1 + total) ** (1 / max(years, 1e-9)) - 1) * 100,
        "max_drawdown_pct": dd * 100,
        "sharpe": float(rets.mean() / rets.std() * np.sqrt(per_year)) if rets.std() else 0.0,
        "cagr_over_dd": (((1 + total) ** (1 / max(years, 1e-9)) - 1) / abs(dd)) if dd else 0.0,
        "win_rate_pct": (sum(1 for x in net if x > 0) / len(net) * 100) if net else 0.0,
        "avg_position_net_pct": float(np.mean(net)) if net else 0.0,
        "no_trade_periods": len(res.no_trade_dates),
        "years": years,
    }
