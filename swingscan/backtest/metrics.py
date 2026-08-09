"""Backtest performance metrics (spec section 23)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .engine import BacktestResult, Trade

TRADING_DAYS = 252


def compute_metrics(res: BacktestResult, capital: float) -> dict:
    trades = res.trades
    if not trades:
        return {"total_trades": 0, "note": "no trades generated"}

    pnl = np.array([t.net_pnl for t in trades])
    r = np.array([t.r_multiple for t in trades])
    wins, losses = pnl[pnl > 0], pnl[pnl <= 0]
    hold = np.array([t.holding_days for t in trades])

    equity = res.equity
    curve = capital + equity
    peak = curve.cummax()
    dd = (curve - peak) / peak
    daily_ret = curve.pct_change().dropna()

    years = max((equity.index[-1] - equity.index[0]).days / 365.25, 1e-9)
    total_return = equity.iloc[-1] / capital
    cagr = (1 + total_return) ** (1 / years) - 1 if total_return > -1 else -1.0

    sharpe = (daily_ret.mean() / daily_ret.std() * np.sqrt(TRADING_DAYS)
              if daily_ret.std() > 0 else 0.0)
    downside = daily_ret[daily_ret < 0]
    sortino = (daily_ret.mean() / downside.std() * np.sqrt(TRADING_DAYS)
               if len(downside) and downside.std() > 0 else 0.0)
    max_dd = float(dd.min())
    calmar = cagr / abs(max_dd) if max_dd < 0 else 0.0

    # max consecutive losses
    max_consec = consec = 0
    for p in pnl:
        consec = consec + 1 if p <= 0 else 0
        max_consec = max(max_consec, consec)

    exit_counts = pd.Series([t.exit_reason for t in trades]).value_counts().to_dict()
    n = len(trades)
    early = sum(v for k, v in exit_counts.items()
                if k in ("momentum_failure", "thesis_failure"))

    return {
        "total_trades": n,
        "win_rate": float((pnl > 0).mean()),
        "avg_winner": float(wins.mean()) if len(wins) else 0.0,
        "avg_loser": float(losses.mean()) if len(losses) else 0.0,
        "profit_factor": float(wins.sum() / abs(losses.sum())) if losses.sum() != 0 else np.inf,
        "expectancy": float(pnl.mean()),
        "expectancy_r": float(r.mean()),
        "avg_r": float(r.mean()),
        "total_net_pnl": float(pnl.sum()),
        "total_return_pct": float(total_return * 100),
        "cagr_pct": float(cagr * 100),
        "max_drawdown_pct": float(max_dd * 100),
        "sharpe": float(sharpe),
        "sortino": float(sortino),
        "calmar": float(calmar),
        "max_consecutive_losses": int(max_consec),
        "avg_holding_days": float(hold.mean()),
        "median_holding_days": float(np.median(hold)),
        "t1_hit_rate": float(np.mean([t.t1_hit for t in trades])),
        "t2_hit_rate": float(np.mean([t.t2_hit for t in trades])),
        "stop_rate": float(sum(v for k, v in exit_counts.items() if k.startswith("stop")) / n),
        "early_exit_rate": float(early / n),
        "time_stop_rate": float(exit_counts.get("time_stop", 0) / n),
        "exit_reasons": exit_counts,
        "no_trade_days": res.no_trade_days,
        "scan_days": res.daily_scans,
    }


def segmented_metrics(trades: list[Trade], key) -> pd.DataFrame:
    """Per-segment stats. key: callable Trade -> segment label."""
    seg: dict[str, list[Trade]] = {}
    for t in trades:
        seg.setdefault(str(key(t)), []).append(t)
    rows = {}
    for label, ts in sorted(seg.items()):
        pnl = np.array([t.net_pnl for t in ts])
        r = np.array([t.r_multiple for t in ts])
        wins, losses = pnl[pnl > 0], pnl[pnl <= 0]
        rows[label] = {
            "trades": len(ts),
            "win_rate": float((pnl > 0).mean()),
            "avg_r": float(r.mean()),
            "profit_factor": float(wins.sum() / abs(losses.sum())) if losses.sum() != 0 else np.inf,
            "net_pnl": float(pnl.sum()),
            "avg_hold": float(np.mean([t.holding_days for t in ts])),
        }
    return pd.DataFrame(rows).T


def render_metrics(m: dict, title: str = "BACKTEST RESULTS") -> str:
    if m.get("total_trades", 0) == 0:
        return f"{title}\n  No trades generated."
    L = [title, "=" * len(title)]
    fmt = [
        ("Total trades", "total_trades", "{:d}"),
        ("Win rate", "win_rate", "{:.1%}"),
        ("Avg winner (Rs)", "avg_winner", "{:,.0f}"),
        ("Avg loser (Rs)", "avg_loser", "{:,.0f}"),
        ("Profit factor", "profit_factor", "{:.2f}"),
        ("Expectancy (Rs/trade)", "expectancy", "{:,.0f}"),
        ("Expectancy (R/trade)", "expectancy_r", "{:+.2f}"),
        ("Total net PnL (Rs)", "total_net_pnl", "{:,.0f}"),
        ("Return on capital", "total_return_pct", "{:+.1f}%"),
        ("CAGR (fixed sizing)", "cagr_pct", "{:+.1f}%"),
        ("Max drawdown", "max_drawdown_pct", "{:.1f}%"),
        ("Sharpe", "sharpe", "{:.2f}"),
        ("Sortino", "sortino", "{:.2f}"),
        ("Calmar", "calmar", "{:.2f}"),
        ("Max consecutive losses", "max_consecutive_losses", "{:d}"),
        ("Avg holding (days)", "avg_holding_days", "{:.1f}"),
        ("Median holding (days)", "median_holding_days", "{:.1f}"),
        ("T1 hit rate", "t1_hit_rate", "{:.1%}"),
        ("T2 hit rate", "t2_hit_rate", "{:.1%}"),
        ("Stop-loss rate", "stop_rate", "{:.1%}"),
        ("Early-exit rate", "early_exit_rate", "{:.1%}"),
        ("Time-stop rate", "time_stop_rate", "{:.1%}"),
        ("NO-TRADE days", "no_trade_days", "{:d}"),
        ("Scan days", "scan_days", "{:d}"),
    ]
    for label, k, f in fmt:
        if k in m:
            L.append(f"  {label:<26} {f.format(m[k])}")
    return "\n".join(L)
