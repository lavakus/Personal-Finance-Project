"""Run a swingscan backtest and store it in Supabase (TradeOS Phase 11).

Stored rows are ALWAYS kind=BACKTEST (or OUT_OF_SAMPLE when flagged) and
the UI labels them that way — backtested performance is never presented
as live results (brief §60, rule 13).

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      uv run python -m swingscan.publish_backtest \
      --start 2023-01-01 --end 2024-12-31 [--label "..."] [--oos]
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

import pandas as pd

from .backtest.engine import run_backtest
from .backtest.metrics import compute_metrics
from .config import Config
from .loader import load_market_data
from .publish import SupabaseREST, _num

log = logging.getLogger(__name__)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--label", default=None)
    ap.add_argument("--oos", action="store_true", help="mark as OUT_OF_SAMPLE")
    ap.add_argument("--config", default="config/default.yaml")
    ap.add_argument("--max-symbols", type=int, default=None)
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", file=sys.stderr)
        return 2

    cfg = Config.from_yaml(args.config)
    start, end = pd.Timestamp(args.start), pd.Timestamp(args.end)
    years = max(3, int((end - start).days / 365.25) + 2)
    md = load_market_data(cfg, years=years + 1, end=end.date(),
                          max_symbols=args.max_symbols)

    res = run_backtest(md, cfg, start, end, progress_every=250)
    metrics = compute_metrics(res, cfg.risk.account_capital)
    metrics = {k: _num(v) if isinstance(v, float) else v for k, v in metrics.items()}
    metrics["survivorship_caveat"] = (
        "universe = current NIFTY 500 members; treat results as relative "
        "evidence, not an absolute return forecast"
    )

    db = SupabaseREST(url, key)
    bt = db.insert("backtests", [{
        "label": args.label or f"swingscan {start.date()} → {end.date()}",
        "engine": "swingscan",
        "engine_version": "1.0",
        "start_date": str(start.date()),
        "end_date": str(end.date()),
        "universe": "NIFTY500",
        "capital": cfg.risk.account_capital,
        "parameters": {"risk_per_trade_pct": cfg.risk.risk_per_trade_pct},
        "metrics": metrics,
        "kind": "OUT_OF_SAMPLE" if args.oos else "BACKTEST",
    }], returning=True)
    bt_id = bt[0]["id"]

    rows = [{
        "backtest_id": bt_id,
        "symbol": t.symbol,
        "setup_type": t.setup_type,
        "entry_date": str(t.entry_date.date()),
        "exit_date": str(t.exit_date.date()),
        "entry_price": _num(t.entry_price),
        "shares": int(t.shares),
        "net_pnl": _num(t.net_pnl),
        "r_multiple": _num(t.r_multiple),
        "holding_days": int(t.holding_days),
        "exit_reason": t.exit_reason,
    } for t in res.trades]
    for i in range(0, len(rows), 500):
        db.insert("backtest_trades", rows[i:i + 500])

    print(f"Stored backtest {bt_id}: {len(rows)} trades, "
          f"{res.no_trade_days} no-trade days over {res.daily_scans} scans")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
