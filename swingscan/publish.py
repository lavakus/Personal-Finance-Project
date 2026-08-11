"""Publish a swingscan run into Supabase (TradeOS Phase 5).

Runs the exact same scan_asof pipeline as the CLI, then writes:
  market_regime_history, market_breadth, sector_rankings,
  scan_runs -> stock_rankings -> trade_plans

Idempotent per trading day: re-publishing a date replaces only that
date's scan_run (children cascade); historical runs are never touched
(spec: keep every scan, no lookahead, NO TRADE is a valid result).

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      uv run python -m swingscan.publish [--date YYYY-MM-DD] [--config file]

The service-role key must ONLY live in CI secrets / server env.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import date

import pandas as pd
import requests

from .config import Config
from .loader import load_market_data
from .pipeline import ScanResult, scan_asof
from .trade_plan import (
    Candidate,
    entry_conditions,
    exit_conditions,
    invalidation_conditions,
)

log = logging.getLogger(__name__)

ENGINE_VERSION = "1.0"


class SupabaseREST:
    """Minimal PostgREST client using the service-role key."""

    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.s = requests.Session()
        self.s.headers.update({
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        })

    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        if not rows:
            return
        r = self.s.post(
            f"{self.base}/{table}",
            params={"on_conflict": on_conflict},
            headers={"Prefer": "resolution=merge-duplicates"},
            data=json.dumps(rows),
        )
        if r.status_code >= 300:
            raise RuntimeError(f"upsert {table}: {r.status_code} {r.text[:300]}")

    def insert(self, table: str, rows: list[dict], returning: bool = False):
        if not rows:
            return []
        headers = {"Prefer": "return=representation"} if returning else {}
        r = self.s.post(f"{self.base}/{table}", headers=headers, data=json.dumps(rows))
        if r.status_code >= 300:
            raise RuntimeError(f"insert {table}: {r.status_code} {r.text[:300]}")
        return r.json() if returning else []

    def delete(self, table: str, **filters: str) -> None:
        r = self.s.delete(f"{self.base}/{table}", params=filters)
        if r.status_code >= 300:
            raise RuntimeError(f"delete {table}: {r.status_code} {r.text[:300]}")

    def select(self, table: str, select: str = "*", **filters: str) -> list[dict]:
        r = self.s.get(f"{self.base}/{table}", params={"select": select, **filters})
        if r.status_code >= 300:
            raise RuntimeError(f"select {table}: {r.status_code} {r.text[:300]}")
        return r.json()


def _num(v) -> float | None:
    """JSON-safe float (NaN/inf -> None)."""
    if v is None:
        return None
    f = float(v)
    return f if f == f and abs(f) != float("inf") else None


def _plan_row(c: Candidate, ranking_id: str) -> dict:
    rp, s = c.risk_plan, c.setup
    return {
        "stock_ranking_id": ranking_id,
        "entry_low": _num(s.entry_low),
        "entry_high": _num(s.entry_high),
        "entry_mid": _num(rp.entry),
        "stop": _num(rp.stop),
        "t1": _num(rp.t1),
        "t2": _num(rp.t2),
        "rr1": _num(rp.rr1),
        "rr2": _num(rp.rr2),
        "risk_per_share": _num(rp.risk_per_share),
        "do_not_chase_above": _num(s.do_not_chase_above),
        "structure_low": _num(s.structure_low),
        "key_level": _num(s.key_level),
        "max_holding_days": 15,
        "entry_conditions": entry_conditions(c),
        "exit_conditions": exit_conditions(c),
        "invalidation": invalidation_conditions(c),
        "sizing": {
            "shares": int(c.sizing.shares),
            "notional": _num(c.sizing.notional),
            "risk_amount": _num(c.sizing.risk_amount),
            "capped_by_notional": bool(c.sizing.capped_by_notional),
        },
    }


def publish(res: ScanResult, db: SupabaseREST) -> None:
    run_date = str(res.as_of.date())
    reg = res.regime

    # 1. regime + breadth history (upsert by date)
    breadth = reg.details.get("breadth")
    db.upsert("market_regime_history", [{
        "date": run_date,
        "label": reg.label,
        "score": _num(reg.score),
        "breadth_pct": _num(breadth * 100 if breadth is not None else None),
        "vix": _num(reg.details.get("vix")),
        "nifty_close": _num(reg.details.get("nifty_close")),
        "details": {"max_candidates": reg.max_candidates,
                    "min_total_score": _num(reg.min_total_score),
                    "allow_longs": reg.allow_longs},
    }], on_conflict="date")
    if breadth is not None:
        db.upsert("market_breadth", [{
            "date": run_date,
            "pct_above_ema50": _num(breadth * 100),
        }], on_conflict="date")

    # 2. sector rankings (upsert by date+sector)
    t = res.sector_table.table
    if not t.empty:
        rows = []
        for name, r in t.iterrows():
            rows.append({
                "date": run_date,
                "sector": str(name),
                "rank": int(r["rank"]),
                "rs5": _num(r.get("rs5")),
                "rs10": _num(r.get("rs10")),
                "rs20": _num(r.get("rs20")),
                "rs60": _num(r.get("rs60")),
                "rs_blend": _num(r.get("rs_blend")),
                "score": _num(r.get("score")),
            })
        db.upsert("sector_rankings", rows, on_conflict="date,sector")

    # 3. replace this date's scan run (children cascade on delete)
    db.delete("scan_runs", run_date=f"eq.{run_date}")
    run = db.insert("scan_runs", [{
        "run_date": run_date,
        "engine": "swingscan",
        "engine_version": ENGINE_VERSION,
        "universe": "NIFTY500",
        "regime_label": reg.label,
        "regime_score": _num(reg.score),
        "funnel": vars(res.funnel),
        "no_trade": res.no_trade,
        "no_trade_reason": res.no_trade_reason,
        "near_misses": [{"symbol": s, "reason": r} for s, r in res.near_misses[:50]],
    }], returning=True)
    run_id = run[0]["id"]

    for c in res.candidates:
        ranking = db.insert("stock_rankings", [{
            "scan_run_id": run_id,
            "rank": c.rank,
            "symbol": c.symbol,
            "name": c.name,
            "sector": c.sector,
            "sector_rank": c.sector_rank,
            "price": _num(c.price),
            "atr": _num(c.atr),
            "setup_type": c.setup.setup_type,
            "score_total": _num(c.score.total),
            "score_tier": c.score.tier,
            "score_components": {k: _num(v) for k, v in c.score.components.items()},
            "score_weights": {k: _num(v) for k, v in c.score.weighted.items()},
            "why": c.why,
            "warnings": c.warnings,
            "rs_excess_nifty_20d": _num(c.rs_excess_nifty_20d),
        }], returning=True)
        db.insert("trade_plans", [_plan_row(c, ranking[0]["id"])])

    log.info("published scan %s: %d candidates (no_trade=%s)",
             run_date, len(res.candidates), res.no_trade)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", default=None, help="scan as-of date (default: today)")
    ap.add_argument("--config", default="config/default.yaml")
    ap.add_argument("--max-symbols", type=int, default=None)
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", file=sys.stderr)
        return 2

    cfg = Config.from_yaml(args.config)
    as_of = pd.Timestamp(args.date) if args.date else pd.Timestamp(date.today())
    md = load_market_data(cfg, end=as_of.date(), max_symbols=args.max_symbols)
    trade_day = md.nifty.index[md.nifty.index <= as_of][-1]
    res = scan_asof(md, trade_day, cfg)

    publish(res, SupabaseREST(url, key))
    print(f"Published scan for {trade_day.date()}: "
          f"{len(res.candidates)} candidates, no_trade={res.no_trade}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
