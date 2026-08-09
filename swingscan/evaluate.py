"""Evaluate published historical signals (TradeOS Phase 10, brief §58).

For every stock_ranking with a trade_plan and no final outcome yet, walk
the bars strictly AFTER the signal date and determine:

  entry triggered? -> T1 / T2 / STOP / TIMEOUT (15 trading days) / OPEN
  plus MFE / MAE, realized R and holding days.

Only post-signal data is read; the signal rows themselves are never
modified (scans are append-only history).

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      uv run python -m swingscan.evaluate [--config file]
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date

import pandas as pd

from .config import Config
from .loader import load_market_data
from .publish import SupabaseREST, _num

log = logging.getLogger(__name__)

MAX_HOLD_DAYS = 15
ENTRY_WINDOW_DAYS = 2   # entry order expires after 2 trading days (plan text)


def evaluate_plan(bars: pd.DataFrame, signal_date: pd.Timestamp, plan: dict) -> dict | None:
    """Walk post-signal bars. Returns an outcome row or None if no bars yet."""
    entry_low = float(plan["entry_low"])
    entry_high = float(plan["entry_high"])
    stop = float(plan["stop"])
    t1, t2 = float(plan["t1"]), float(plan["t2"])

    post = bars.loc[bars.index > signal_date]
    if post.empty:
        return None

    evaluated_through = post.index[-1].date()
    base = {
        "evaluated_through": str(evaluated_through),
        "entry_triggered": False,
        "t1_hit": False, "t2_hit": False, "stop_hit": False, "timed_out": False,
        "entry_date": None, "entry_price": None,
        "exit_date": None, "exit_price": None,
        "r_multiple": None, "mfe_pct": None, "mae_pct": None,
        "holding_days": None,
    }

    # --- entry: first bar within the window whose range touches the zone
    entry_i = None
    entry_price = None
    for i, (ts, row) in enumerate(post.iterrows()):
        if i >= ENTRY_WINDOW_DAYS:
            break
        lo, hi = float(row["Low"]), float(row["High"])
        if lo <= entry_high and hi >= entry_low:
            entry_i = i
            # conservative fill: worst price inside the zone reachable that bar
            entry_price = min(max(lo, entry_low), entry_high)
            base["entry_triggered"] = True
            base["entry_date"] = str(ts.date())
            base["entry_price"] = entry_price
            break

    if entry_i is None:
        base["outcome"] = "NOT_TRIGGERED" if len(post) >= ENTRY_WINDOW_DAYS else "OPEN"
        return base

    risk = entry_price - stop
    if risk <= 0:
        base["outcome"] = "INVALIDATED"
        return base

    held = post.iloc[entry_i:]
    mfe = mae = 0.0
    outcome, exit_price, exit_date, days = "OPEN", None, None, 0

    for j, (ts, row) in enumerate(held.iterrows()):
        lo, hi = float(row["Low"]), float(row["High"])
        close = float(row["Close"])
        mfe = max(mfe, (hi - entry_price) / entry_price * 100)
        mae = min(mae, (lo - entry_price) / entry_price * 100)
        days = j
        # conservative ordering: stop checked before targets on the same bar
        if lo <= stop:
            outcome, exit_price, exit_date = "STOP", stop, ts
            break
        if hi >= t2:
            outcome, exit_price, exit_date = "T2", t2, ts
            base["t1_hit"] = True
            base["t2_hit"] = True
            break
        if hi >= t1:
            base["t1_hit"] = True
        if j >= MAX_HOLD_DAYS:
            outcome, exit_price, exit_date = "TIMEOUT", close, ts
            base["timed_out"] = True
            break

    base["mfe_pct"] = round(mfe, 3)
    base["mae_pct"] = round(mae, 3)
    base["holding_days"] = days
    if exit_price is not None and exit_date is not None:
        base["exit_price"] = exit_price
        base["exit_date"] = str(exit_date.date())
        base["r_multiple"] = round((exit_price - entry_price) / risk, 3)
        # T1-then-stop still ends STOP but keeps t1_hit=true for analytics
        base["outcome"] = outcome
    else:
        base["outcome"] = "OPEN"
    return base


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default="config/default.yaml")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", file=sys.stderr)
        return 2
    db = SupabaseREST(url, key)

    # pending = rankings whose outcome is missing or still open/not final
    r = db.s.get(
        f"{db.base}/stock_rankings",
        params={
            "select": "id,symbol,scan_runs(run_date),trade_plans(*),trade_outcomes(outcome)",
            "order": "created_at.asc",
            "limit": "500",
        },
    )
    r.raise_for_status()
    rows = r.json()
    pending = [
        row for row in rows
        if row.get("trade_plans")
        and (not row.get("trade_outcomes")
             or row["trade_outcomes"]["outcome"] in ("OPEN",))
    ]
    if not pending:
        print("No signals pending evaluation.")
        return 0

    cfg = Config.from_yaml(args.config)
    md = load_market_data(cfg, end=date.today())

    evaluated = 0
    for row in pending:
        sym = row["symbol"]
        panel = md.panels.get(sym)
        if panel is None:
            continue
        signal_date = pd.Timestamp(row["scan_runs"]["run_date"])
        result = evaluate_plan(panel, signal_date, row["trade_plans"])
        if result is None:
            continue
        result = {k: (_num(v) if isinstance(v, float) else v) for k, v in result.items()}
        result["stock_ranking_id"] = row["id"]
        db.upsert("trade_outcomes", [result], on_conflict="stock_ranking_id")
        evaluated += 1
        log.info("evaluated %s (%s): %s", sym, signal_date.date(), result["outcome"])

    print(f"Evaluated {evaluated} signals.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
