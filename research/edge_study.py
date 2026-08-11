"""Pre-registered search for a statistically robust NSE cross-sectional edge.

METHOD (fixed before any result was looked at)
----------------------------------------------
1. Six hypotheses, each grounded in published equity-anomaly literature rather
   than found by scanning this dataset. No parameter tuning inside a hypothesis.
2. Data split once. Selection happens on IS only; OOS is evaluated exactly once,
   for whichever hypothesis IS selects. Looking at OOS to choose would convert
   it into in-sample data and destroy the whole point.
3. The null hypothesis is NOT "zero return" — it is "no better than owning the
   eligible universe equal-weighted". In a bull market any long-only book makes
   money, so raw return proves nothing. Every test below is on the *paired
   monthly excess return* over that benchmark.
4. Six hypotheses means the 5% single-test threshold (t>1.96) would be expected
   to produce a false positive ~26% of the time. Bonferroni threshold is
   t>2.64, and that is the bar reported.
5. Costs: the project's real per-side model (slippage + STT + brokerage +
   exchange + GST), charged only on legs actually traded.
6. Regime performance is reported from the engine's own regime series so an
   edge that only works in one market state is visible as such.

KNOWN LIMITS, stated up front
-----------------------------
* Universe is current NIFTY 500 membership -> survivorship bias inflates every
  row including the benchmark. The excess-return test partially controls for it
  (both legs share the bias) but not fully.
* The March 2020 crash is consumed by the 12-month warmup, so the sharpest
  regime in recent history is absent from the test window.
* ~40 IS months is a small sample for a t-test. A t of 2.7 here is weaker
  evidence than a t of 2.7 over 200 months.

Usage:
  uv run python -m research.edge_study            # IS only (default, safe)
  uv run python -m research.edge_study --reveal-oos
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass

import numpy as np
import pandas as pd

from swingscan.backtest.costs import side_charges, slip_buy, slip_sell
from swingscan.config import Config
from swingscan.loader import load_market_data

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

WARMUP_END = pd.Timestamp("2020-10-01")
IS_START = pd.Timestamp("2020-10-01")
IS_END = pd.Timestamp("2024-02-01")
OOS_END = pd.Timestamp("2026-08-07")
TOP_N = 15
CAPITAL = 1_000_000.0
BONFERRONI_T = 2.64
N_HYPOTHESES = 6


@dataclass
class Panel:
    close: pd.DataFrame
    volume: pd.DataFrame
    rets: pd.DataFrame
    mkt: pd.Series          # NIFTY close
    mkt_rets: pd.Series
    liquid: pd.DataFrame    # causal liquidity+quality mask
    regime: pd.DataFrame


# ─────────────────────────────────── hypotheses (pre-registered)

def h1_residual_momentum(p: Panel, hist: pd.DataFrame, d: pd.Timestamp) -> pd.Series:
    """H1. Residual momentum (Blitz, Huij & Martens 2011).
    12-1 momentum with the market component removed via each name's beta.
    Documented to be more stable than raw momentum because it strips the
    market-timing bet that makes momentum crash at turning points."""
    if len(hist) < 260:
        return pd.Series(dtype=float)
    stock = hist.iloc[-21] / hist.iloc[-252] - 1
    mkt_hist = p.mkt.loc[:d]
    mkt = mkt_hist.iloc[-21] / mkt_hist.iloc[-252] - 1
    r = p.rets.loc[:d].iloc[-252:]
    m = p.mkt_rets.loc[:d].iloc[-252:]
    aligned = r.reindex(m.index)
    var = m.var()
    beta = aligned.apply(lambda c: c.cov(m) / var if var else np.nan)
    return stock - beta * mkt


def h2_reversal_in_uptrend(p: Panel, hist: pd.DataFrame, d: pd.Timestamp) -> pd.Series:
    """H2. Short-term reversal inside an established uptrend.
    Buy the weakest 5-day performers among names above their 200-day average
    (Jegadeesh 1990 reversal, conditioned on trend to avoid catching falling
    knives). This is the cross-sectional analogue of the live pullback setup."""
    if len(hist) < 210:
        return pd.Series(dtype=float)
    ma200 = hist.iloc[-200:].mean()
    last = hist.iloc[-1]
    up = last > ma200
    r5 = hist.iloc[-1] / hist.iloc[-6] - 1
    return (-r5).where(up)


def h3_low_volatility(p: Panel, hist: pd.DataFrame, d: pd.Timestamp) -> pd.Series:
    """H3. Low-volatility anomaly (Blitz & van Vliet 2007).
    Long the lowest realised-volatility names. Documented to earn higher
    risk-adjusted returns than the market across most equity markets."""
    if len(hist) < 70:
        return pd.Series(dtype=float)
    vol = hist.pct_change().iloc[-60:].std()
    return -vol


def h4_momentum_scaled_by_vol(p: Panel, hist: pd.DataFrame, d: pd.Timestamp) -> pd.Series:
    """H4. Risk-managed momentum (Barroso & Santa-Clara 2015).
    12-1 momentum divided by realised volatility — the standard mitigation for
    momentum's crash risk."""
    if len(hist) < 260:
        return pd.Series(dtype=float)
    mom = hist.iloc[-21] / hist.iloc[-252] - 1
    vol = hist.pct_change().iloc[-60:].std() * np.sqrt(252)
    return mom / vol.replace(0, np.nan)


def h5_volume_confirmed_high(p: Panel, hist: pd.DataFrame, d: pd.Timestamp) -> pd.Series:
    """H5. 52-week-high proximity confirmed by volume expansion.
    George & Hwang (2004) anchoring, plus the volume filter the live breakout
    setup uses — participation is meant to separate a real break from drift."""
    if len(hist) < 260:
        return pd.Series(dtype=float)
    window = hist.iloc[-252:]
    prox = window.iloc[-1] / window.max()            # 1.0 = at the high
    vol = p.volume.loc[:d]
    if len(vol) < 25:
        return pd.Series(dtype=float)
    vratio = vol.iloc[-5:].mean() / vol.iloc[-20:].mean().replace(0, np.nan)
    return prox.where(prox >= 0.95) * vratio


def h6_momentum_acceleration(p: Panel, hist: pd.DataFrame, d: pd.Timestamp) -> pd.Series:
    """H6. Momentum acceleration.
    Recent 6-month momentum minus the prior 6 months: names whose trend is
    strengthening rather than merely persistent (Ardila et al., 'momentum of
    momentum')."""
    if len(hist) < 260:
        return pd.Series(dtype=float)
    recent = hist.iloc[-21] / hist.iloc[-126] - 1
    older = hist.iloc[-126] / hist.iloc[-252] - 1
    return recent - older


HYPOTHESES = {
    "H1 residual momentum": h1_residual_momentum,
    "H2 reversal in uptrend": h2_reversal_in_uptrend,
    "H3 low volatility": h3_low_volatility,
    "H4 momentum / vol": h4_momentum_scaled_by_vol,
    "H5 52w high + volume": h5_volume_confirmed_high,
    "H6 momentum acceleration": h6_momentum_acceleration,
}


# ─────────────────────────────────── portfolio harness

def month_ends(dates: pd.DatetimeIndex, lo, hi) -> list[pd.Timestamp]:
    d = dates[(dates >= lo) & (dates <= hi)]
    if len(d) == 0:
        return []
    return pd.Series(d, index=d).groupby([d.year, d.month]).last().tolist()


def run_signal(p: Panel, cfg: Config, fn, lo, hi, top_n: int = TOP_N):
    """Monthly-rebalanced equal-weight long-only book. Returns (monthly returns,
    benchmark monthly returns, turnover list)."""
    rebals = month_ends(p.close.index, lo, hi)
    if len(rebals) < 6:
        return None
    equity, bench = CAPITAL, CAPITAL
    shares: dict[str, float] = {}
    cash = CAPITAL
    strat_m, bench_m, turn = [], [], []

    for i, d in enumerate(rebals[:-1]):
        nxt = rebals[i + 1]
        hist = p.close.loc[:d]
        liq = p.liquid.loc[p.liquid.index.asof(d)]

        score = fn(p, hist, d)
        if score is None or score.empty:
            strat_m.append(0.0)
            bench_m.append(0.0)
            continue
        score = score.replace([np.inf, -np.inf], np.nan).dropna()
        score = score[liq.reindex(score.index).fillna(False)]
        picks = list(score.nlargest(top_n).index) if len(score) >= top_n else []

        start_equity = cash + sum(
            sh * float(p.close[s].loc[:d].iloc[-1]) for s, sh in shares.items())

        if picks:
            turn.append(len(set(picks) - set(shares)) / len(picks))
            for s in [x for x in shares if x not in picks]:
                px = slip_sell(float(p.close[s].loc[:d].iloc[-1]), cfg)
                g = shares.pop(s) * px
                cash += g - side_charges(g, False, cfg).total
            alloc = start_equity / len(picks)
            for s in picks:
                raw = float(p.close[s].loc[:d].iloc[-1])
                have = shares.get(s, 0.0) * raw
                delta = alloc - have
                if delta > 0:
                    ch = side_charges(delta, True, cfg).total
                    if cash >= delta + ch:
                        shares[s] = shares.get(s, 0.0) + delta / slip_buy(raw, cfg)
                        cash -= delta + ch
                elif delta < 0 and s in shares:
                    ch = side_charges(-delta, False, cfg).total
                    shares[s] -= (-delta) / slip_sell(raw, cfg)
                    cash += -delta - ch

        # A delisted/suspended name yields NaN here; carry its last good price
        # so one missing quote cannot NaN out the whole month.
        def mark(sym: str, sh: float) -> float:
            px = p.close[sym].loc[:nxt].ffill().iloc[-1]
            return sh * (0.0 if pd.isna(px) else float(px))

        end_equity = cash + sum(mark(s, sh) for s, sh in shares.items())
        strat_m.append(end_equity / start_equity - 1 if start_equity else 0.0)
        equity = end_equity

        names = [s for s in p.close.columns if bool(liq.get(s, False))]
        br = 0.0
        if names:
            fwd = p.close.loc[d:nxt, names].ffill()
            m = (fwd.iloc[-1] / fwd.iloc[0] - 1).replace(
                [np.inf, -np.inf], np.nan).mean(skipna=True)
            # NOT `m or 0.0`: NaN is truthy in Python, so that idiom lets a NaN
            # through, and pandas .prod() then silently skips the month while
            # np.mean propagates it — the two aggregates would disagree.
            br = 0.0 if pd.isna(m) else float(m)
        bench_m.append(br)
        bench *= 1 + br

    idx = pd.DatetimeIndex(rebals[1:len(strat_m) + 1])
    return (pd.Series(strat_m, index=idx), pd.Series(bench_m, index=idx),
            float(np.mean(turn)) if turn else 0.0)


def stats(strat: pd.Series, bench: pd.Series, turnover: float, label: str) -> dict:
    # Drop any month either leg could not price, so every statistic below is
    # computed on exactly the same set of months.
    ok = strat.notna() & bench.notna()
    strat, bench = strat[ok], bench[ok]
    ex = strat - bench
    n = len(ex)
    t = ex.mean() / (ex.std(ddof=1) / np.sqrt(n)) if n > 2 and ex.std(ddof=1) else 0.0
    ann = lambda s: (1 + s).prod() ** (12 / len(s)) - 1
    curve = (1 + strat).cumprod()
    dd = (curve / curve.cummax() - 1).min()
    return {
        "label": label, "months": n,
        "cagr": ann(strat) * 100, "bench_cagr": ann(bench) * 100,
        "excess_ann": (ann(strat) - ann(bench)) * 100,
        "excess_mean_m": ex.mean() * 100,
        "t": float(t),
        "hit": float((ex > 0).mean() * 100),
        "dd": dd * 100,
        "sharpe": float(strat.mean() / strat.std(ddof=1) * np.sqrt(12)) if strat.std(ddof=1) else 0.0,
        "turnover": turnover * 100,
    }


def regime_split(strat: pd.Series, bench: pd.Series, p: Panel) -> dict[str, tuple[float, int]]:
    """Excess return by market regime at the start of each holding month."""
    ok = strat.notna() & bench.notna()
    out: dict[str, list[float]] = {}
    for dt, ex in (strat[ok] - bench[ok]).items():
        rows = p.regime.loc[:dt]
        lab = str(rows.iloc[-1]["label"]) if len(rows) else "UNKNOWN"
        bucket = ("BULL" if "BULL" in lab else
                  "BEAR" if "BEAR" in lab else
                  "WEAK" if lab == "WEAK" else "NEUTRAL")
        out.setdefault(bucket, []).append(ex)
    return {k: (float(np.mean(v) * 100), len(v)) for k, v in out.items()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--reveal-oos", action="store_true",
                    help="evaluate the IS-selected hypothesis on held-out data")
    ap.add_argument("--top-n", type=int, default=TOP_N)
    ap.add_argument("--config", default="config/default.yaml")
    args = ap.parse_args()

    cfg = Config.from_yaml(args.config)
    print("loading market data...", flush=True)
    md = load_market_data(cfg, years=8, end=OOS_END.date())
    close = pd.DataFrame({s: pan["Close"] for s, pan in md.panels.items()})
    volume = pd.DataFrame({s: pan["Volume"] for s, pan in md.panels.items()})
    p = Panel(close=close, volume=volume, rets=close.pct_change(),
              mkt=md.nifty["Close"], mkt_rets=md.nifty["Close"].pct_change(),
              liquid=md.liquidity_mask, regime=md.regime_series)

    print(f"universe {close.shape[1]} symbols | "
          f"IS {IS_START.date()}→{IS_END.date()} | "
          f"OOS {IS_END.date()}→{OOS_END.date()}\n")

    print("=" * 92)
    print(f"IN-SAMPLE — selection stage ({N_HYPOTHESES} pre-registered hypotheses)")
    print("Null: no better than equal-weight eligible universe. Test on monthly excess.")
    print("=" * 92)
    print(f"{'hypothesis':<28}{'CAGR':>7}{'bench':>7}{'excess':>8}"
          f"{'ex/mo':>7}{'t':>6}{'hit%':>6}{'maxDD':>8}{'turn%':>7}{'n':>4}")
    print("-" * 92)

    is_rows = []
    for label, fn in HYPOTHESES.items():
        r = run_signal(p, cfg, fn, IS_START, IS_END, args.top_n)
        if r is None:
            print(f"{label:<28}  insufficient data")
            continue
        s, b, turn = r
        st = stats(s, b, turn, label)
        st["_series"] = (s, b)
        is_rows.append(st)
        print(f"{label:<28}{st['cagr']:>6.1f}%{st['bench_cagr']:>6.1f}%"
              f"{st['excess_ann']:>+7.1f}%{st['excess_mean_m']:>+6.2f}%"
              f"{st['t']:>6.2f}{st['hit']:>5.0f}%{st['dd']:>7.1f}%"
              f"{st['turnover']:>6.0f}%{st['months']:>4}")
    print("-" * 92)
    print(f"Bonferroni bar for {N_HYPOTHESES} tests: |t| > {BONFERRONI_T:.2f}"
          f"   (single-test bar would be 1.96)")

    survivors = [r for r in is_rows if r["t"] > BONFERRONI_T]
    best = max(is_rows, key=lambda r: r["t"]) if is_rows else None

    print()
    if survivors:
        print(f"IS RESULT: {len(survivors)} hypothesis(es) clear the corrected bar:")
        for r in survivors:
            print(f"  - {r['label']}  t={r['t']:.2f}, excess {r['excess_ann']:+.1f}%/yr")
    else:
        print("IS RESULT: NO hypothesis clears the multiple-testing-corrected bar.")
        if best:
            print(f"  best was {best['label']} at t={best['t']:.2f} "
                  f"(excess {best['excess_ann']:+.1f}%/yr) — "
                  f"{'above' if best['t'] > 1.96 else 'below'} even the uncorrected bar.")

    if best:
        print()
        print("  Excess return by regime (IS, mean monthly excess):")
        for k, (v, n) in sorted(regime_split(*best["_series"], p).items()):
            print(f"    {k:<9}{v:>+7.2f}%/mo   ({n} months)")

    if not args.reveal_oos:
        print()
        print("OOS withheld. Re-run with --reveal-oos to spend the held-out sample")
        print("on the IS-selected hypothesis. It can only be spent once.")
        return 0

    print()
    print("=" * 92)
    print("OUT-OF-SAMPLE — confirmation stage (evaluated once)")
    print("=" * 92)
    if not best:
        print("nothing selected in-sample")
        return 0
    fn = HYPOTHESES[best["label"]]
    r = run_signal(p, cfg, fn, IS_END, OOS_END, args.top_n)
    if r is None:
        print("insufficient OOS data")
        return 0
    s, b, turn = r
    o = stats(s, b, turn, best["label"])
    print(f"{'':<28}{'CAGR':>7}{'bench':>7}{'excess':>8}{'ex/mo':>7}{'t':>6}"
          f"{'hit%':>6}{'maxDD':>8}{'n':>4}")
    print("-" * 92)
    for tag, st in (("IS  ", best), ("OOS ", o)):
        print(f"{tag + st['label']:<28}{st['cagr']:>6.1f}%{st['bench_cagr']:>6.1f}%"
              f"{st['excess_ann']:>+7.1f}%{st['excess_mean_m']:>+6.2f}%"
              f"{st['t']:>6.2f}{st['hit']:>5.0f}%{st['dd']:>7.1f}%{st['months']:>4}")
    print("-" * 92)
    held = o["excess_ann"] > 0 and o["t"] > 1.0
    print(f"VERDICT: the IS-selected edge {'HELD' if held else 'DID NOT HOLD'} "
          f"out of sample.")
    print("  OOS excess by regime:")
    for k, (v, n) in sorted(regime_split(s, b, p).items()):
        print(f"    {k:<9}{v:>+7.2f}%/mo   ({n} months)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
