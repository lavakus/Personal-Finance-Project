"""Publish a momentum-core rebalance into Supabase (shares the scan tables).

Writes one scan_run with engine='momentum' plus its stock_rankings. It does NOT
write trade_plans: a factor pick has no stop and no target, and inventing one
would misrepresent the strategy. The holding rule is `hold_until`.

Idempotent per (run_date, engine): re-publishing a date replaces that engine's
run only, leaving the same day's swingscan run untouched.

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      uv run python -m swingscan.publish_factor [--date YYYY-MM-DD] [--dry-run]
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date

import pandas as pd

from .config import Config
from .factor import FactorConfig, rank_asof
from .loader import load_market_data
from .publish import SupabaseREST, _num

log = logging.getLogger(__name__)

ENGINE = "momentum"
ENGINE_VERSION = "1.0"


def tier_for(pctile: float) -> str:
    """Decile label so the UI has a coarse quality band, like swingscan's tier."""
    if pctile >= 99:
        return "A+"
    if pctile >= 97:
        return "A"
    if pctile >= 95:
        return "B"
    return "C"


def next_rebalance(as_of: pd.Timestamp, hold_months: int) -> str:
    return str((as_of + pd.DateOffset(months=hold_months)).date())


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", default=None, help="rebalance as-of date (default: today)")
    ap.add_argument("--top-n", type=int, default=10)
    ap.add_argument("--hold-months", type=int, default=3)
    ap.add_argument("--max-per-sector", type=int, default=3)
    ap.add_argument("--config", default="config/default.yaml")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the book, write nothing")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not args.dry_run and (not url or not key):
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", file=sys.stderr)
        return 2

    cfg = Config.from_yaml(args.config)
    fcfg = FactorConfig(top_n=args.top_n, hold_months=args.hold_months,
                        max_per_sector=args.max_per_sector)
    as_of = pd.Timestamp(args.date) if args.date else pd.Timestamp(date.today())
    md = load_market_data(cfg, end=as_of.date())
    trade_day = md.nifty.index[md.nifty.index <= as_of][-1]

    sel = rank_asof(md, trade_day, cfg, fcfg)
    hold_until = next_rebalance(trade_day, args.hold_months)

    # Regime is recorded as context only — a factor engine does not gate on it.
    reg_row = md.regime_series.loc[:trade_day]
    regime_label = str(reg_row.iloc[-1]["label"]) if len(reg_row) else None
    regime_score = float(reg_row.iloc[-1]["score"]) if len(reg_row) else None

    print(f"\nMOMENTUM CORE — rebalance {trade_day.date()}")
    print(f"  eligible universe : {sel.eligible}")
    print(f"  hold until        : {hold_until}")
    if sel.no_trade:
        print(f"  NO BOOK: {sel.no_trade_reason}")
    else:
        print(f"  {'#':>2} {'symbol':<14}{'12-1 mom':>10}{'pctile':>8}"
              f"{'weight':>8}{'vol':>7}  sector")
        for p in sel.picks:
            print(f"  {p.rank:>2} {p.symbol:<14}{p.momentum_pct:>9.1f}%"
                  f"{p.momentum_pctile:>7.0f}%{p.weight_pct:>7.1f}%"
                  f"{(p.vol_annual_pct or 0):>6.0f}%  {p.sector or '-'}")
    print()

    if args.dry_run:
        print("dry run — nothing written")
        return 0

    db = SupabaseREST(url, key)
    run_date = str(trade_day.date())

    # Replace only this engine's run for the date; children cascade.
    db.delete("scan_runs", run_date=f"eq.{run_date}", engine=f"eq.{ENGINE}")
    run = db.insert("scan_runs", [{
        "run_date": run_date,
        "engine": ENGINE,
        "engine_version": ENGINE_VERSION,
        "universe": "NIFTY500",
        "regime_label": regime_label,
        "regime_score": _num(regime_score),
        "funnel": {"eligible": sel.eligible, "selected": len(sel.picks),
                   "top_n": fcfg.top_n, "hold_months": fcfg.hold_months,
                   "max_per_sector": fcfg.max_per_sector},
        "no_trade": sel.no_trade,
        "no_trade_reason": sel.no_trade_reason,
        "near_misses": [],
    }], returning=True)
    run_id = run[0]["id"]

    rows = [{
        "scan_run_id": run_id,
        "rank": p.rank,
        "symbol": p.symbol,
        "name": p.name,
        "sector": p.sector,
        "sector_rank": None,
        "price": _num(p.price),
        "atr": None,
        "setup_type": "MOMENTUM",
        "score_total": _num(p.momentum_pctile),
        "score_tier": tier_for(p.momentum_pctile),
        "score_components": {
            "momentum_12_1_pct": _num(p.momentum_pct),
            "momentum_percentile": _num(p.momentum_pctile),
            "realised_vol_annual_pct": _num(p.vol_annual_pct),
        },
        "score_weights": {"momentum_12_1_pct": 100.0},
        "why": p.why,
        "warnings": [],
        "rs_excess_nifty_20d": None,
        "weight_pct": _num(p.weight_pct),
        "momentum_pct": _num(p.momentum_pct),
        "vol_annual_pct": _num(p.vol_annual_pct),
        "hold_until": hold_until,
    } for p in sel.picks]
    if rows:
        db.insert("stock_rankings", rows)

    print(f"Published {len(rows)} momentum picks for {run_date} (engine={ENGINE}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
