"""Daily scanner report (spec sections 18, 21, 29, 30).

Probabilistic language only — the report describes setup quality, never
promises outcomes. NO TRADE is a first-class result.
"""

from __future__ import annotations

import pandas as pd

from .pipeline import ScanResult
from .trade_plan import Candidate, do_not_chase, entry_conditions, exit_conditions, invalidation_conditions

RULE = "=" * 68
THIN = "-" * 68


def render_report(res: ScanResult, cfg) -> str:
    L: list[str] = []
    reg = res.regime
    L += [RULE, "INDIAN SWING TRADE SCANNER", f"Date: {res.as_of.date()}", RULE, ""]

    vix = reg.details.get("vix")
    breadth = reg.details.get("breadth")
    L += ["Market:",
          f"  NIFTY Close:     {reg.details.get('nifty_close', float('nan')):,.2f}",
          f"  NIFTY Regime:    {reg.label}",
          f"  Market Strength: {reg.score:+.0f} / 100"]
    if breadth is not None:
        L.append(f"  Breadth:         {breadth * 100:.0f}% of universe above EMA50")
    if vix is not None:
        L.append(f"  India VIX:       {vix:.2f}")
    L.append(f"  Policy:          max {reg.max_candidates} candidates, min score {reg.min_total_score:.0f}")
    L.append("")

    if not res.sector_table.table.empty:
        t = res.sector_table.table
        L += [f"Sector relative strength (20d vs NIFTY, top 12 of {len(t)}):"]
        for name, r in t.head(12).iterrows():
            L.append(f"  #{int(r['rank']):<2} {name:<38} {r['rs20']:+6.2f}%")
        L.append("")

    f = res.funnel
    L += ["Funnel:",
          f"  Stocks scanned:            {f.scanned}",
          f"  Data quality passed:       {f.quality}",
          f"  Liquidity passed:          {f.liquidity}",
          f"  Trend passed:              {f.trend}",
          f"  Relative strength passed:  {f.relative_strength}",
          f"  Setup passed:              {f.setup}",
          f"  Risk/reward passed:        {f.risk_reward}",
          f"  Quality score passed:      {f.score}",
          f"  Final candidates:          {f.final}", ""]

    if res.no_trade:
        L += [RULE, "FINAL RESULT:  NO TRADE", RULE, "",
              f"NO HIGH-QUALITY SETUPS TODAY — {res.no_trade_reason}.",
              "Forcing a trade in these conditions has negative expectancy.",
              "Cash is a position.", ""]
    else:
        L += [RULE, "FINAL CANDIDATES", RULE]
        for c in res.candidates:
            L += _render_candidate(c, cfg)

    if res.near_misses:
        L += [THIN, "Near misses (for context, NOT recommendations):"]
        for sym, reason in res.near_misses[:12]:
            L.append(f"  {sym:<12} {reason}")
        L.append("")

    L += [THIN,
          "This is a decision-support scan, not investment advice. All entries",
          "are conditional plans with defined invalidation — execution and",
          "final judgement are manual. Historical edge does not guarantee",
          "future results.", RULE]
    return "\n".join(L)


def _render_candidate(c: Candidate, cfg) -> list[str]:
    rp, s = c.risk_plan, c.setup
    L = ["", THIN,
         f"Rank:    #{c.rank}",
         f"Stock:   {c.symbol}  ({c.name})",
         f"Sector:  {c.sector or 'Unmapped'}" + (f"  (rank #{c.sector_rank})" if c.sector_rank else ""),
         f"Score:   {c.score.total:.0f}/100  (Tier {c.score.tier})",
         f"Setup:   {s.setup_type} — {'pullback continuation' if s.setup_type == 'PULLBACK' else 'breakout continuation'}",
         "",
         f"Current Price:  ₹{c.price:,.2f}   (ATR ₹{c.atr:,.2f})",
         "",
         f"Entry Zone:     ₹{s.entry_low:,.2f} - ₹{s.entry_high:,.2f}",
         f"Stop Loss:      ₹{rp.stop:,.2f}",
         "",
         f"Target 1:       ₹{rp.t1:,.2f}" + (f"   [{rp.resistance_note}]" if rp.resistance_note else ""),
         f"Target 2:       ₹{rp.t2:,.2f}",
         "",
         f"Risk/share:     ₹{rp.risk_per_share:,.2f}",
         f"R:R T1:         {rp.rr1:.2f}",
         f"R:R T2:         {rp.rr2:.2f}",
         "",
         f"Suggested size: {c.sizing.shares} shares (₹{c.sizing.notional:,.0f} notional, "
         f"₹{c.sizing.risk_amount:,.0f} at risk = {cfg.risk.risk_per_trade_pct}% of capital)"
         + ("  [capped by max position size]" if c.sizing.capped_by_notional else ""),
         "",
         f"Expected Holding: {c.expected_holding}",
         f"Maximum Holding:  {cfg.exits.max_holding_days} trading days (hard cap, not a goal)",
         "",
         "Why Selected:"]
    L += [f"  + {w}" for w in c.why]
    if c.warnings:
        L.append("Warnings:")
        L += [f"  ! {w}" for w in c.warnings]
    L.append("")
    L.append("ENTRY CONDITIONS:")
    L += [f"  - {x}" for x in entry_conditions(c)]
    L.append("EXIT CONDITIONS:")
    L += [f"  - {x}" for x in exit_conditions(c)]
    L.append("INVALIDATION:")
    L += [f"  - {x}" for x in invalidation_conditions(c)]
    L.append("DO NOT CHASE IF:")
    L += [f"  - {x}" for x in do_not_chase(c)]
    return L


def render_score_table(res: ScanResult) -> str:
    if not res.candidates:
        return "(no candidates)"
    rows = []
    for c in res.candidates:
        comp = c.score.components
        rows.append(f"{c.rank:>2}. {c.symbol:<12} {c.score.total:5.1f}  "
                    f"[regime {comp['market_regime']:3.0f} | sector {comp['sector_strength']:3.0f} | "
                    f"RS {comp['relative_strength']:3.0f} | trend {comp['trend_structure']:3.0f} | "
                    f"setup {comp['setup_quality']:3.0f} | vol {comp['volume_confirmation']:3.0f} | "
                    f"mom {comp['momentum']:3.0f} | RR {comp['risk_reward']:3.0f}]")
    return "\n".join(rows)
