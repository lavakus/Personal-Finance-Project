"""End-of-day Telegram report: the paper book's holdings plus every signal from
the last N days and where each one stands now.

Runs as the last step of the daily pipeline, AFTER publish -> evaluate -> paper,
so every number it reads from Supabase was refreshed minutes earlier. It reads
only from Supabase - no market-data load - so it takes seconds and cannot drift
from what the dashboard shows.

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      uv run python -m swingscan.report [--days 30] [--print-only]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date, timedelta

from . import telegram
from .publish import SupabaseREST

log = logging.getLogger(__name__)

ACCOUNT_NAME = "Swing paper ₹10L"

# outcome -> (icon, human label). Order also controls listing order in the report.
OUTCOMES = {
    "OPEN":          ("🟡", "open"),
    "T2":            ("🏆", "hit T2"),
    "T1":            ("✅", "hit T1"),
    "TIMEOUT":       ("⏱", "time out"),
    "STOP":          ("❌", "stopped"),
    "NOT_TRIGGERED": ("⚪", "never triggered"),
}


def _f(v, default=0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def paper_section(sb: SupabaseREST) -> list[str]:
    accts = sb.select("paper_accounts", "*", name=f"eq.{ACCOUNT_NAME}", limit="1")
    if not accts:
        return ["<b>📒 Paper book</b>: not set up yet"]
    a = accts[0]
    equity = _f(a.get("equity"), _f(a.get("starting_capital")))
    start = _f(a.get("starting_capital"), 1.0)
    ret = 100.0 * (equity / start - 1.0) if start else 0.0
    out = [f"<b>📒 Paper book</b>  ₹{equity:,.0f} ({ret:+.2f}%)"
           f"   marked to {a.get('data_through', '?')}"]

    held = sb.select(
        "paper_positions",
        "symbol,setup_type,entry_date,entry_price,remaining,stop,t1,t2,"
        "last_close,unrealized,holding_days,t1_hit",
        account_id=f"eq.{a['id']}", status="eq.OPEN", order="entry_date.asc")
    if not held:
        out.append("  fully in cash - no open positions")
        return out
    out.append(f"  <b>{len(held)} holding(s):</b>")
    for p in held:
        entry, last = _f(p["entry_price"]), _f(p.get("last_close"))
        upnl = _f(p.get("unrealized"))
        pct = 100.0 * (last / entry - 1.0) if entry and last else 0.0
        icon = "🟢" if upnl >= 0 else "🔻"
        t1txt = " T1✓" if p.get("t1_hit") else ""
        out.append(
            f"\n{icon} <b>{telegram._esc(p['symbol'])}</b>"
            f"  {p.get('remaining')} sh @ ₹{entry:,.2f} -> ₹{last:,.2f}"
            f"  <b>{pct:+.1f}%</b> (₹{upnl:+,.0f}){t1txt}"
            f"\n    stop ₹{_f(p.get('stop')):,.2f}"
            f"  t1 ₹{_f(p.get('t1')):,.2f}  t2 ₹{_f(p.get('t2')):,.2f}"
            f"  held {p.get('holding_days', '?')}d"
        )
    return out


def signals_section(sb: SupabaseREST, days: int) -> list[str]:
    # One embedded query: outcomes with their ranking, plan and scan date. The
    # window filter happens in Python because PostgREST cannot filter a parent
    # by a nested column without a view.
    rows = sb.select(
        "trade_outcomes",
        "outcome,r_multiple,holding_days,entry_triggered,entry_price,exit_price,"
        "exit_date,mfe_pct,"
        "stock_rankings(symbol,setup_type,score_total,"
        "scan_runs(run_date),trade_plans(entry_mid,stop,t1,t2))")
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    sig = []
    for r in rows:
        rk = r.get("stock_rankings") or {}
        run = (rk.get("scan_runs") or {}).get("run_date", "")
        if run and run >= cutoff:
            r["_symbol"] = rk.get("symbol", "?")
            r["_setup"] = rk.get("setup_type", "")
            r["_score"] = _f(rk.get("score_total"))
            r["_date"] = run
            plans = rk.get("trade_plans")
            plan = plans[0] if isinstance(plans, list) and plans else (plans or {})
            r["_plan"] = plan
            sig.append(r)
    if not sig:
        return [f"<b>🔍 Signals, last {days}d</b>: none"]

    sig.sort(key=lambda r: r["_date"], reverse=True)
    decided = [r for r in sig if r.get("outcome") in ("T1", "T2", "STOP", "TIMEOUT")]
    wins = [r for r in decided if r.get("outcome") in ("T1", "T2")]
    tot_r = sum(_f(r.get("r_multiple")) for r in decided)
    head = (f"<b>🔍 Signals, last {days}d</b>  ({len(sig)} total"
            + (f", {len(wins)}/{len(decided)} decided hit target, {tot_r:+.1f}R"
               if decided else "") + ")")
    out = [head]
    for r in sig[:15]:
        icon, label = OUTCOMES.get(r.get("outcome") or "OPEN", ("❓", r.get("outcome") or "?"))
        plan = r["_plan"]
        line = (f"\n{icon} <b>{telegram._esc(r['_symbol'])}</b> {telegram._esc(r['_setup'])}"
                f" ({r['_date']}, score {r['_score']:.0f}) - <b>{label}</b>")
        if r.get("outcome") == "OPEN" and r.get("entry_triggered"):
            line += (f"\n    in @ ₹{_f(r.get('entry_price')):,.2f}"
                     f"  stop ₹{_f(plan.get('stop')):,.2f}"
                     f"  t1 ₹{_f(plan.get('t1')):,.2f}"
                     f"  peak {_f(r.get('mfe_pct')):+.1f}%")
        elif r.get("outcome") in ("T1", "T2", "STOP", "TIMEOUT"):
            entry, exitp = _f(r.get("entry_price")), _f(r.get("exit_price"))
            pct = 100.0 * (exitp / entry - 1.0) if entry and exitp else 0.0
            line += (f"\n    ₹{entry:,.2f} -> ₹{exitp:,.2f}  <b>{pct:+.1f}%</b>"
                     f"  {_f(r.get('r_multiple')):+.2f}R"
                     f"  {r.get('holding_days', '?')}d")
        out.append(line)
    if len(sig) > 15:
        out.append(f"\n…and {len(sig) - 15} older signal(s).")
    return out


def build_report(sb: SupabaseREST, days: int) -> str:
    parts = [f"<b>🌙 NSE end-of-day report — {date.today().isoformat()}</b>", ""]
    parts += paper_section(sb)
    parts.append("")
    parts += signals_section(sb, days)
    return "\n".join(parts)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--print-only", action="store_true",
                    help="print the report, send nothing")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", file=sys.stderr)
        return 2

    msg = build_report(SupabaseREST(url, key), args.days)
    print(msg)
    if args.print_only:
        return 0
    if telegram.enabled():
        ok = telegram.send(msg)
        log.info("report %s", "sent" if ok else "SEND FAILED")
        return 0 if ok else 1
    log.info("telegram not configured, report printed only")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
