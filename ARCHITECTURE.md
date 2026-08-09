# Architecture & Design Decisions

```
INDIAN EQUITY UNIVERSE (NIFTY 500, NSE archives)
        ↓  data/universe.py
DATA FETCH + CACHE (Yahoo daily OHLCV, split/dividend adjusted, parquet)
        ↓  data/fetcher.py
DATA VALIDATION  ──reject──▶ (stale / short / corrupt / suspect CA)
        ↓  data/quality.py + vectorized mirror in pipeline.MarketData
LIQUIDITY FILTER (price, traded value, volume)
        ↓
MARKET REGIME (NIFTY trend stack + RSI/ADX/ROC + breadth + VIX)
        ↓  market_regime.py          ──STRONG_BEARISH──▶ NO LONG TRADES
SECTOR STRENGTH (synthetic industry composites vs NIFTY)
        ↓  sector_strength.py
STOCK RELATIVE STRENGTH (5/10/20/60d excess vs NIFTY + sector, percentile)
        ↓  relative_strength.py
TREND STRUCTURE (EMA stack, slopes, HH/HL, extension gate)
        ↓  trend.py
MOMENTUM CONFLUENCE (RSI+MACD+ADX+ROC, overheat penalty)   momentum.py
VOLUME CHARACTER (accumulation/contraction/expansion)      volume.py
        ↓
SETUP A: PULLBACK (setups/pullback.py)   SETUP B: BREAKOUT (setups/breakout.py)
        ↓
ENTRY ZONE + STRUCTURAL STOP + TARGETS CAPPED AT RESISTANCE + R:R GATE
        ↓  risk.py
QUALITY SCORE 0–100 (weighted composite, tiers)             ranking.py
        ↓
CORRELATION / SECTOR-CAP FILTER                             correlation.py
        ↓
FINAL RANKING → TRADE PLAN → MANUAL DECISION                trade_plan.py, reporting.py
```

Backtesting: `backtest/engine.py` (event-driven), `backtest/costs.py`
(Indian delivery costs), `backtest/metrics.py`, `backtest/walkforward.py`.
Orchestration: `pipeline.py` (scan), `loader.py` (data assembly), `cli.py`.

## Key decisions and why

### One scan function for live and backtest
`pipeline.scan_asof(md, date, cfg)` is the ONLY decision path. The live
scanner calls it with today's date; the backtester calls it for every
historical date. There is no separate "backtest logic" that could drift from
what you trade. It reads only bars `<= date`; `tests/test_no_lookahead.py`
proves a scan with future data loaded is byte-identical to one with data
truncated at the scan date.

### No look-ahead, mechanically enforced
- Every indicator is causal (EMA/RSI/ATR/ADX/rolling ops) — precomputing
  full-history panels is therefore safe and fast.
- Swing pivots inherently need future bars to confirm; `indicators.py`
  exposes only *confirmed* pivots, with the flag placed at the bar where the
  pivot becomes knowable (`i + strength`), never at the pivot itself.
- Signals at close of day D are only fillable from D+1's bar in the engine.
- Regime, breadth, sector and RS panels are all built from shifted/rolling
  causal operations.

### Vectorized gates + detailed shortlist evaluation
Cheap gates (quality, liquidity, trend stack, RS percentile) are precomputed
as cross-sectional boolean panels in `MarketData`. The expensive, explainable
per-stock evaluation (structure, setups, targets) runs only on the daily
shortlist (typically tens of names). This keeps a 10-year × 500-symbol
backtest tractable in pure pandas without any change in decisions.

### Synthetic sector composites instead of ^CNX* indices
During development, most Yahoo NSE sector indices (^CNXAUTO, ^CNXENERGY, …)
were 3+ weeks stale while stocks were current — a stale sector index silently
corrupts every cross-sector rank. Sector series are therefore equal-weight
daily-return composites of the universe's own members per NSE industry group:
always as fresh as the stock data, and every industry (Chemicals, Consumer
Durables, …) gets real sector treatment instead of a neutral placeholder.

### Regime → selection policy, not just a label
Each regime carries `(max_candidates, min_total_score)`. A weak tape doesn't
just tighten language — it mathematically raises the bar (e.g. BEARISH allows
1 candidate at score ≥ 88) and STRONG_BEARISH returns NO TRADE structurally.

### Extension is penalized, not rewarded
Trend scoring peaks at ~1 ATR above EMA20 and a hard gate rejects > 4 ATR.
A strong stock that is vertically extended is a *worse entry*, per spec §6/7.
The same idea appears as breakout "DO NOT CHASE" (> 1.5 ATR past the level)
and the pullback "too extended past trigger" rejection.

### Structural stops, resistance-aware targets
Stops go where the thesis dies (below the pullback/consolidation low, minus
0.5×ATR), never at an arbitrary percentage. Targets start at 1.8R/2.8R but are
capped just under the nearest confirmed overhead swing high; if that cap makes
R:R < 1.5, the trade is rejected — "major resistance before T1" is a rejection
reason, not a footnote.

### Exit logic prioritizes thesis over time
The engine encodes: stop hit; T1 (book half, stop→breakeven); T2; thesis
failure (close below structure low → exit next open); momentum failure (two
consecutive closes 0.25 ATR below EMA20 with negative MACD histogram — one
red day is deliberately NOT enough); and only then the 15-day cap.

### Conservative fill model
Stop before target when a single bar touches both; gaps through stops fill at
the open; entries never chase above the zone (a gap above the zone only fills
if price trades back into it). Slippage on every fill, full Indian delivery
charges on every round trip.

### Walk-forward is the only sanctioned tuner
`backtest/walkforward.py` selects parameters on a validation year and reports
them on an untouched test year, rolling annually. The objective shrinks
expectancy by trade count (`expR · n/(n+20)`) and ties break toward *fewer*
deviations from defaults — robustness beats backtest profit by construction.
The default grid is deliberately tiny (3 parameters); every extra dimension
multiplies overfitting risk.

### Known limitations (stated, not hidden)
- **Survivorship bias**: universe = current NIFTY 500 members. Backtest
  absolute returns are inflated; use results comparatively. Fix path:
  point-in-time membership files in `cache/universe_history/`.
- **Yahoo data quality**: adjusted daily bars are good but not exchange-grade;
  the quality gate rejects obvious problems, it cannot catch everything.
- **Daily bars only**: intraday entry refinement (e.g. 15-min confirmation)
  is out of scope; the entry-zone + limit discipline approximates it.
- **No fundamental/news layer**: earnings dates, F&O ban lists and exchange
  surveillance actions must be checked manually before executing any plan
  (the report says so on every candidate).

## Testing

52 tests: indicator correctness (incl. Wilder RSI known value), swing-pivot
confirmation lag (the anti-leak property), setup detection on synthetic
patterns + rejection cases (no volume, exhaustion gap, too-deep pullback),
risk math (incl. the spec's 142-share sizing example), resistance-capped
target rejection, cost model vs hand-computed charges, fill mechanics,
stop-first conservatism, partial-at-T1 trailing, momentum-failure
confirmation, regime classification and policy, tier boundaries, data-quality
gates, bear-market NO-TRADE, and the full no-lookahead scan equivalence.
