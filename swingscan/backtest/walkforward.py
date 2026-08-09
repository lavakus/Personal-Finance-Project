"""Walk-forward validation (spec section 24, 31).

Rolling scheme per test year Y:
    train      = [Y - train_years, Y - 2]     (fit sanity: params must produce
                                               enough trades and positive expectancy)
    validation = Y - 1                        (parameter SELECTION happens here)
    test       = Y                            (out-of-sample, reported)

Parameters are chosen by validation-year objective, never by test-year
results. The reported OOS metrics are the concatenation of all test years.

Objective: expectancy in R with a shrinkage penalty for low trade counts
(exp_R * n / (n + 20)) — prefers robust, active configurations over lucky
sparse ones. Ties break toward FEWER deviations from defaults (Occam bias:
robustness > backtest profit).

NOTE: gate-defining parameters (liquidity, trend stack) are shared with the
precomputed MarketData panels, so the tunable grid deliberately covers only
post-gate parameters (setup/exit/scoring thresholds).
"""

from __future__ import annotations

import copy
import itertools
import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import Config
from ..pipeline import MarketData
from .engine import run_backtest
from .metrics import compute_metrics

log = logging.getLogger(__name__)

# param name -> (path in Config, candidate values). Deliberately small:
# every added dimension multiplies overfitting risk.
DEFAULT_GRID = {
    "volume.breakout_vol_mult": [1.3, 1.5, 1.8],
    "risk.t1_r_multiple": [1.5, 1.8, 2.2],
    "ranking.reject_below": [72.0, 75.0, 80.0],
}

MIN_TRADES = 10


@dataclass
class WalkForwardResult:
    windows: list[dict] = field(default_factory=list)   # per test-year summary
    oos_trades: list = field(default_factory=list)
    oos_metrics: dict = field(default_factory=dict)


def _set_param(cfg: Config, dotted: str, value) -> None:
    obj = cfg
    *path, last = dotted.split(".")
    for p in path:
        obj = getattr(obj, p)
    setattr(obj, last, value)


def _objective(metrics: dict) -> float:
    n = metrics.get("total_trades", 0)
    if n < MIN_TRADES:
        return -np.inf
    return metrics["expectancy_r"] * n / (n + 20.0)


def _combos(grid: dict) -> list[dict]:
    keys = list(grid)
    return [dict(zip(keys, vals)) for vals in itertools.product(*grid.values())]


def walk_forward(md: MarketData, base_cfg: Config,
                 first_test_year: int, last_test_year: int,
                 train_years: int = 3,
                 grid: dict | None = None) -> WalkForwardResult:
    grid = grid or DEFAULT_GRID
    combos = _combos(grid)
    defaults = {k: getattr_dotted(base_cfg, k) for k in grid}
    result = WalkForwardResult()

    for test_year in range(first_test_year, last_test_year + 1):
        val_year = test_year - 1
        train_start = pd.Timestamp(f"{test_year - train_years}-01-01")
        val_start, val_end = pd.Timestamp(f"{val_year}-01-01"), pd.Timestamp(f"{val_year}-12-31")
        test_start, test_end = pd.Timestamp(f"{test_year}-01-01"), pd.Timestamp(f"{test_year}-12-31")

        scored: list[tuple[float, int, dict]] = []
        for combo in combos:
            cfg = copy.deepcopy(base_cfg)
            for k, v in combo.items():
                _set_param(cfg, k, v)
            # sanity on train slice: config must not be degenerate there
            train_res = run_backtest(md, cfg, train_start, val_start - pd.Timedelta(days=1))
            train_m = compute_metrics(train_res, cfg.risk.account_capital)
            if train_m.get("total_trades", 0) < MIN_TRADES or train_m.get("expectancy_r", -9) <= -0.2:
                continue
            val_res = run_backtest(md, cfg, val_start, val_end)
            val_m = compute_metrics(val_res, cfg.risk.account_capital)
            deviations = sum(1 for k, v in combo.items() if v != defaults[k])
            scored.append((_objective(val_m), -deviations, combo))
            log.info("WF %d combo %s: train n=%d expR=%.2f | val n=%d expR=%.2f",
                     test_year, combo, train_m.get("total_trades", 0),
                     train_m.get("expectancy_r", float("nan")),
                     val_m.get("total_trades", 0), val_m.get("expectancy_r", float("nan")))

        if not scored:
            result.windows.append({"test_year": test_year, "status": "no viable params"})
            continue
        scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
        best_obj, _, best = scored[0]

        cfg = copy.deepcopy(base_cfg)
        for k, v in best.items():
            _set_param(cfg, k, v)
        test_res = run_backtest(md, cfg, test_start, test_end)
        test_m = compute_metrics(test_res, cfg.risk.account_capital)
        result.oos_trades.extend(test_res.trades)
        result.windows.append({
            "test_year": test_year, "chosen_params": best,
            "validation_objective": best_obj,
            "oos_trades": test_m.get("total_trades", 0),
            "oos_expectancy_r": test_m.get("expectancy_r"),
            "oos_win_rate": test_m.get("win_rate"),
            "oos_profit_factor": test_m.get("profit_factor"),
        })

    if result.oos_trades:
        pnl = np.array([t.net_pnl for t in result.oos_trades])
        r = np.array([t.r_multiple for t in result.oos_trades])
        wins, losses = pnl[pnl > 0], pnl[pnl <= 0]
        result.oos_metrics = {
            "total_trades": len(pnl),
            "win_rate": float((pnl > 0).mean()),
            "expectancy_r": float(r.mean()),
            "profit_factor": float(wins.sum() / abs(losses.sum())) if losses.sum() != 0 else np.inf,
            "net_pnl": float(pnl.sum()),
        }
    return result


def getattr_dotted(cfg: Config, dotted: str):
    obj = cfg
    for p in dotted.split("."):
        obj = getattr(obj, p)
    return obj


def render_walkforward(res: WalkForwardResult) -> str:
    L = ["WALK-FORWARD VALIDATION", "=" * 24]
    for w in res.windows:
        if "chosen_params" in w:
            L.append(f"  Test {w['test_year']}: params {w['chosen_params']} | "
                     f"OOS n={w['oos_trades']} expR={w['oos_expectancy_r']:+.2f} "
                     f"win={w['oos_win_rate']:.0%} PF={w['oos_profit_factor']:.2f}")
        else:
            L.append(f"  Test {w['test_year']}: {w.get('status')}")
    if res.oos_metrics:
        m = res.oos_metrics
        L += ["", "Combined out-of-sample:",
              f"  trades={m['total_trades']} win={m['win_rate']:.0%} "
              f"expR={m['expectancy_r']:+.2f} PF={m['profit_factor']:.2f} "
              f"netPnL=Rs{m['net_pnl']:,.0f}"]
    L += ["", "Interpretation: stability of chosen params across windows and",
          "positive combined OOS expectancy matter more than any single-year",
          "number. Universe survivorship bias inflates absolute results."]
    return "\n".join(L)
