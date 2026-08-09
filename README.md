# swingscan — Indian Equity Swing-Trade Selection Engine

Scan → Filter → Rank → Select → Generate Trade Plan.

This is a **decision-support engine**, not a trading bot. It never places,
modifies, or manages orders. It produces ranked candidates with entry zones,
stops, targets, R:R, position sizing and explicit exit/invalidation rules —
and it is allowed (and expected) to say **NO TRADE**. The human makes every
execution decision.

Horizon: swing trades of 7–15 trading days maximum. 15 days is a hard cap,
never a goal — the thesis, targets and stops drive exits.

## Quick start

```bash
uv sync                      # installs Python + dependencies
uv run pytest                # 52 unit tests
uv run swingscan scan        # today's scan -> console + reports/scan_<date>.txt
```

Other commands:

```bash
uv run swingscan scan --date 2026-08-07          # scan an earlier date
uv run swingscan backtest --start 2022-01-01 --end 2025-12-31
uv run swingscan walkforward --first-year 2023 --last-year 2025 --train-years 3
uv run swingscan --config config/default.yaml scan   # with overrides
uv run swingscan --max-symbols 50 scan               # fast debug run
```

## What a scan does

1. **Universe** — NIFTY 500 constituents (NSE archives, cached daily).
2. **Data validation** — history length, staleness, corrupt bars, zero-volume
   sessions, suspect unadjusted corporate actions → reject symbol.
3. **Liquidity** — min price ₹100, min 20-day avg traded value ₹5 cr,
   min avg volume 100k (all configurable).
4. **Market regime** — NIFTY trend stack + RSI/ADX/ROC + breadth + India VIX
   → STRONG_BULLISH … STRONG_BEARISH. The regime sets how many candidates are
   allowed and the minimum quality score; STRONG_BEARISH disables longs.
5. **Sector strength** — synthetic equal-weight sector composites per NSE
   industry group, ranked by blended 5/10/20/60-day RS vs NIFTY.
6. **Stock relative strength** — excess returns vs NIFTY and vs own sector,
   blended and converted to a cross-sectional percentile (top 40% required).
7. **Trend structure** — Close>EMA20>EMA50>EMA200, rising slopes, HH/HL
   swing structure, and an over-extension gate (too far above EMA20 = no entry).
8. **Momentum confluence** — RSI / MACD / ADX(+DI) / ROC; overheated RSI
   *reduces* entry quality.
9. **Volume** — accumulation/distribution balance, contraction/expansion;
   breakout volume ≥ 1.5× 20-day average is mandatory for Setup B.
10. **Setups** — A: pullback-to-support continuation (preferred);
    B: tight-consolidation breakout. Gaps are never chased.
11. **Risk plan** — structural stop (swing/consolidation low − 0.5×ATR),
    targets from R-multiples capped at real overhead resistance,
    R:R ≥ 1.5 to T1 and ≥ 2.2 to T2 or the trade is rejected.
12. **Score** — weighted 0–100 composite (weights in `swingscan/config.py`),
    tiers A+/A/B+/B, reject < 75 (higher bar in weaker regimes).
13. **Correlation filter** — drops near-duplicate trades (>0.85 corr) and
    caps picks per sector.
14. **Report** — full trade plan per candidate: entry zone, stop, T1/T2,
    R:R, sizing, WHY selected, entry/exit/invalidation/do-not-chase rules.

## Configuration

Every threshold is a config field (`swingscan/config.py`), overridable via
YAML (`config/default.yaml`). **All values are initial hypotheses** — the
walk-forward validator is the sanctioned way to change them, not hand-tuning
against one backtest.

## Backtesting honesty

- Signals at close of D; entries from D+1 (same code path as the live scan).
- Stop assumed hit before target when both are touched in one bar.
- Gap through a stop fills at the open, not at the stop price.
- Full Indian delivery cost model (brokerage, STT, exchange, SEBI, GST,
  stamp duty) + slippage on every fill.
- Known limitation: the universe is *today's* NIFTY 500 membership →
  survivorship bias inflates absolute results. Treat backtests as relative
  evidence for robustness, not return forecasts.

See [ARCHITECTURE.md](ARCHITECTURE.md) for module-by-module design decisions.

## Disclaimer

Educational/decision-support software. Not investment advice. No guarantee of
any outcome; historical behaviour does not guarantee future results.
