"""Validate the momentum core: backtest, walk-forward, and a no-skill control.

A factor that only ever gets measured in-sample is a curve fit. This runs the
same selection over consecutive out-of-sample slices and prints the naive
benchmark alongside, because a long-only always-invested book in a bull market
looks good whether or not the *selection* adds anything.

  uv run python -m swingscan.factor_validate --start 2022-08-01 --end 2026-08-07
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date

import numpy as np
import pandas as pd

from .config import Config
from .factor import FactorConfig, backtest_factor, metrics, rebalance_dates
from .loader import load_market_data
from .pipeline import MarketData

log = logging.getLogger(__name__)


def benchmark_equal_weight(md: MarketData, cfg: Config, start: pd.Timestamp,
                           end: pd.Timestamp, hold_months: int) -> pd.Series:
    """Equal-weight the whole eligible universe on the same rebalance dates.
    This is the 'no selection skill' control: if the factor cannot beat it,
    the ranking is not earning its keep."""
    close = pd.DataFrame({s: p["Close"] for s, p in md.panels.items()})
    rebals = rebalance_dates(md, start, end, hold_months)
    equity = float(cfg.risk.account_capital)
    curve = {rebals[0]: equity} if rebals else {}
    for i, d in enumerate(rebals[:-1]):
        nxt = rebals[i + 1]
        liq = md.liquidity_mask.loc[md.liquidity_mask.index.asof(d)]
        names = [s for s in close.columns if bool(liq.get(s, False))]
        if names:
            fwd = close.loc[d:nxt, names].ffill()
            if len(fwd) >= 2:
                r = (fwd.iloc[-1] / fwd.iloc[0] - 1).replace([np.inf, -np.inf], np.nan)
                equity *= 1 + float(r.mean(skipna=True) or 0.0)
        curve[nxt] = equity
    return pd.Series(curve).sort_index()


def _perf_row(label: str, eq: pd.Series, capital: float) -> dict:
    eq = eq.dropna()
    if len(eq) < 3:
        return {"label": label, "cagr": None}
    years = (eq.index[-1] - eq.index[0]).days / 365.25
    total = eq.iloc[-1] / eq.iloc[0] - 1
    dd = (eq / eq.cummax() - 1).min()
    rets = eq.pct_change().dropna()
    per_year = len(eq) / max(years, 1e-9)
    cagr = (1 + total) ** (1 / max(years, 1e-9)) - 1
    return {
        "label": label,
        "cagr": cagr * 100,
        "dd": dd * 100,
        "sharpe": float(rets.mean() / rets.std() * np.sqrt(per_year)) if rets.std() else 0.0,
        "ret_dd": cagr / abs(dd) if dd else 0.0,
        "years": years,
    }


def main() -> int:
    # Windows consoles default to cp1252 and this report prints arrows and
    # dashes; same guard as cli.py.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    logging.basicConfig(level=logging.WARNING,
                        format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--start", default="2022-08-01")
    ap.add_argument("--end", default=str(date.today()))
    ap.add_argument("--top-n", type=int, default=10)
    ap.add_argument("--hold-months", type=int, default=3)
    ap.add_argument("--max-per-sector", type=int, default=3)
    ap.add_argument("--folds", type=int, default=3, help="out-of-sample slices")
    ap.add_argument("--config", default="config/default.yaml")
    args = ap.parse_args()

    cfg = Config.from_yaml(args.config)
    fcfg = FactorConfig(top_n=args.top_n, hold_months=args.hold_months,
                        max_per_sector=args.max_per_sector)
    start, end = pd.Timestamp(args.start), pd.Timestamp(args.end)
    years = max(3, int((end - start).days / 365.25) + 2)
    print("loading market data...", flush=True)
    md = load_market_data(cfg, years=years + 1, end=end.date())

    cap = cfg.risk.account_capital
    rows: list[dict] = []

    full = backtest_factor(md, cfg, start, end, fcfg)
    rows.append(_perf_row(f"momentum top{args.top_n} / {args.hold_months}m — FULL",
                          full.equity, cap))
    rows.append(_perf_row("equal-weight universe (no skill)",
                          benchmark_equal_weight(md, cfg, start, end, args.hold_months),
                          cap))

    # Walk-forward: consecutive, non-overlapping out-of-sample slices. There are
    # no fitted parameters here, so this measures stability across regimes
    # rather than guarding against optimisation — a factor that only works in
    # one slice is not a factor.
    edges = pd.date_range(start, end, periods=args.folds + 1)
    for i in range(args.folds):
        lo, hi = edges[i], edges[i + 1]
        r = backtest_factor(md, cfg, lo, hi, fcfg)
        b = benchmark_equal_weight(md, cfg, lo, hi, args.hold_months)
        rows.append(_perf_row(f"  fold {i + 1}: {lo.date()}→{hi.date()}", r.equity, cap))
        rows.append(_perf_row("     (benchmark same fold)", b, cap))

    print()
    print("=" * 84)
    print("MOMENTUM CORE — VALIDATION")
    print("=" * 84)
    print(f"{'':<44}{'CAGR':>8}{'maxDD':>9}{'Sharpe':>8}{'CAGR/DD':>9}{'yrs':>6}")
    print("-" * 84)
    for r in rows:
        if r["cagr"] is None:
            print(f"{r['label']:<44}{'insufficient data':>40}")
            continue
        print(f"{r['label']:<44}{r['cagr']:>7.1f}%{r['dd']:>8.1f}%"
              f"{r['sharpe']:>8.2f}{r['ret_dd']:>9.2f}{r['years']:>6.1f}")
    print("-" * 84)

    m = metrics(full, cap)
    print(f"positions taken {m['positions']}  |  rebalances {m['periods']}  |  "
          f"position win rate {m['win_rate_pct']:.0f}%  |  "
          f"avg position {m['avg_position_net_pct']:+.2f}%  |  "
          f"cash periods {m['no_trade_periods']}")
    print("=" * 84)
    print("Universe is current NIFTY 500 membership, so every row above carries")
    print("survivorship bias. Judge the factor by its margin OVER the benchmark,")
    print("not by its absolute return.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
