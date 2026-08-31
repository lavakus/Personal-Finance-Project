"""Replay the paper book and publish it to Supabase.

Idempotent by design. The engine is causal, so replaying the same start date to
the same end date always yields the same trades; this re-runs the whole history
every time and UPSERTS on (account_id, symbol, entry_date). Running it twice in
one day changes nothing, and a missed day repairs itself on the next run --
there is no incremental state to drift out of sync.

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      uv run python -m swingscan.publish_paper [--start YYYY-MM-DD] [--dry-run]
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date

import pandas as pd

from .config import Config
from . import telegram
from .loader import load_market_data
from .paper import PaperConfig, run_paper, summarize
from .publish import SupabaseREST, _num

log = logging.getLogger(__name__)

ACCOUNT_NAME = "Swing paper ₹10L"
DEFAULT_START = "2026-07-13"


def _account(sb: SupabaseREST, pcfg: PaperConfig, start: str) -> dict:
    """Find or create the paper account. The policy lives on the row, so a
    published result can always be traced to the rules that produced it."""
    rows = sb.select("paper_accounts", "*", name=f"eq.{ACCOUNT_NAME}", limit="1")
    if rows:
        return rows[0]

    owners = sb.select("profiles", "id", order="created_at.asc", limit="1")
    if not owners:
        raise RuntimeError("no profile exists yet - sign in to the app once first")

    created = sb.insert("paper_accounts", [{
        "user_id": owners[0]["id"],
        "name": ACCOUNT_NAME,
        "engine": "swingscan",
        "starting_capital": pcfg.capital,
        "per_position": pcfg.per_position,
        "min_score": pcfg.min_score,
        "max_open": pcfg.max_open,
        "start_date": start,
    }], returning=True)
    log.info("created paper account %s", created[0]["id"])
    return created[0]


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config/default.yaml")
    ap.add_argument("--start", default=DEFAULT_START)
    ap.add_argument("--end", default=None)
    ap.add_argument("--capital", type=float, default=PaperConfig.capital)
    ap.add_argument("--per-position", type=float, default=PaperConfig.per_position)
    ap.add_argument("--min-score", type=float, default=PaperConfig.min_score)
    ap.add_argument("--dry-run", action="store_true",
                    help="print the book, write nothing")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not args.dry_run and (not url or not key):
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", file=sys.stderr)
        return 2

    pcfg = PaperConfig(capital=args.capital, per_position=args.per_position,
                       min_score=args.min_score)
    end = pd.Timestamp(args.end) if args.end else pd.Timestamp(date.today())
    cfg = Config.from_yaml(args.config)
    md = load_market_data(cfg, years=3, end=end.date())

    res = run_paper(md, cfg, pcfg, pd.Timestamp(args.start), end, progress_every=10)
    s = summarize(res)
    log.info("paper %s -> %s: equity %.0f (%+.2f%%), %d closed, %d open",
             s["start"], s["end"], s["equity"], s["total_return_pct"],
             s["closed_trades"], s["open_positions"])

    if args.dry_run:
        for k, v in s.items():
            print(f"  {k:22} {v}")
        for t in res.trades:
            print(f"  CLOSED {t.symbol:12} {t.net_pnl:>10,.0f}  {t.exit_reason}")
        for p in res.open_positions:
            print(f"  OPEN   {p.symbol:12} {p.unrealized:>10,.0f}  {p.days_held}d")
        return 0

    sb = SupabaseREST(url, key)
    acct = _account(sb, pcfg, args.start)
    aid = acct["id"]

    closed_rows = [{
        "account_id": aid,
        "symbol": t.symbol,
        "setup_type": t.setup_type,
        "status": "CLOSED",
        "entry_date": str(t.entry_date.date()),
        "entry_price": _num(t.entry_price),
        "shares": int(t.shares),
        "remaining": 0,
        "stop": _num(t.initial_stop),
        "score": _num(t.score),
        "sector": t.sector,
        "regime": t.regime,
        "exit_date": str(t.exit_date.date()),
        "exit_reason": t.exit_reason,
        "gross_pnl": _num(t.gross_pnl),
        "charges": _num(t.charges),
        "net_pnl": _num(t.net_pnl),
        "r_multiple": _num(t.r_multiple),
        "holding_days": int(t.holding_days),
        "t1_hit": bool(t.t1_hit),
    } for t in res.trades]

    open_rows = [{
        "account_id": aid,
        "symbol": p.symbol,
        "setup_type": p.setup_type,
        "status": "OPEN",
        "entry_date": str(p.entry_date.date()),
        "entry_price": _num(p.entry_price),
        "shares": int(p.shares),
        "remaining": int(p.remaining),
        "stop": _num(p.stop),
        "t1": _num(p.t1),
        "t2": _num(p.t2),
        "score": _num(p.score),
        "sector": p.sector,
        "regime": p.regime,
        "holding_days": int(p.days_held),
        "t1_hit": bool(p.t1_hit),
        "last_close": _num(p.last_close),
        "unrealized": _num(p.unrealized),
    } for p in res.open_positions]

    # PostgREST rejects a bulk upsert whose objects have differing key sets
    # ("All object keys must match"). Closed rows carry exit fields and open
    # rows carry mark fields, so pad both to the union. Every differing column
    # is nullable, so the padding is a real value, not a placeholder.
    rows = closed_rows + open_rows
    if rows:
        keys = sorted({k for r in rows for k in r})
        rows = [{k: r.get(k) for k in keys} for r in rows]
    sb.upsert("paper_positions", rows, on_conflict="account_id,symbol,entry_date")

    snaps = [{
        "account_id": aid,
        "as_of": str(d.date()),
        "equity": _num(v),
        "cash": _num(res.daily_cash.get(d)),
        "open_positions": int(res.daily_open.get(d, 0)),
    } for d, v in res.equity.items()]
    sb.upsert("paper_equity_snapshots", snaps, on_conflict="account_id,as_of")

    sb.upsert("paper_accounts", [{
        "id": aid,
        "user_id": acct["user_id"],
        "name": ACCOUNT_NAME,
        "starting_capital": pcfg.capital,
        "per_position": pcfg.per_position,
        "min_score": pcfg.min_score,
        "max_open": pcfg.max_open,
        "start_date": args.start,
        "cash": _num(res.cash),
        "equity": _num(res.equity.iloc[-1]),
        "last_run_at": pd.Timestamp.now("UTC").isoformat(),
        "data_through": s["end"],
    }], on_conflict="id")

    log.info("published %d closed + %d open positions, %d snapshots",
             len(closed_rows), len(open_rows), len(snaps))

    # Alert on TODAY'S activity only. The paper engine replays the entire history on
    # every run, so alerting on the whole book would re-announce every trade daily.
    # `s["end"]` is the last bar the book is marked to, so a position opened or closed
    # on that date is genuinely new since the previous run.
    if telegram.enabled():
        today = str(s["end"])
        new_open = [r for r in open_rows if r["entry_date"] == today]
        new_closed = [r for r in closed_rows if r["exit_date"] == today]
        msg = telegram.paper_alert(new_open, new_closed,
                                   float(res.equity.iloc[-1]), float(pcfg.capital))
        if msg:
            telegram.send(msg)
        else:
            log.info("no paper activity on %s, no alert sent", today)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
