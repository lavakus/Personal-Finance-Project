"""Command-line interface.

  swingscan scan        [--date YYYY-MM-DD] [--config file.yaml] [--refresh-universe]
  swingscan backtest    --start YYYY-MM-DD --end YYYY-MM-DD [--config ...]
  swingscan walkforward --first-year YYYY --last-year YYYY [--train-years N]

This tool selects and plans trades. It never executes them.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date
from pathlib import Path

import pandas as pd

from .config import Config
from .loader import load_market_data
from .pipeline import scan_asof
from .reporting import render_report, render_score_table


def _setup_console() -> None:
    """Windows consoles often default to cp1252; the report uses ₹ and —."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.INFO if verbose else logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def cmd_scan(args) -> int:
    cfg = Config.from_yaml(args.config)
    as_of = pd.Timestamp(args.date) if args.date else pd.Timestamp(date.today())
    md = load_market_data(cfg, end=as_of.date(), max_symbols=args.max_symbols,
                          refresh_universe=args.refresh_universe)
    # scan the last available trading day <= requested date
    trade_day = md.nifty.index[md.nifty.index <= as_of][-1]
    res = scan_asof(md, trade_day, cfg)
    report = render_report(res, cfg)
    print(report)
    if res.candidates:
        print("\nScore breakdown:")
        print(render_score_table(res))
    out_dir = Path("reports")
    out_dir.mkdir(exist_ok=True)
    out_file = out_dir / f"scan_{trade_day.date()}.txt"
    out_file.write_text(report, encoding="utf-8")
    print(f"\nSaved: {out_file}")
    return 0


def cmd_backtest(args) -> int:
    from .backtest.engine import run_backtest
    from .backtest.metrics import compute_metrics, render_metrics, segmented_metrics

    cfg = Config.from_yaml(args.config)
    start, end = pd.Timestamp(args.start), pd.Timestamp(args.end)
    years = max(3, int((end - start).days / 365.25) + 2)  # +buffer for EMA200 warmup
    md = load_market_data(cfg, years=years + 1, end=end.date(), max_symbols=args.max_symbols)

    res = run_backtest(md, cfg, start, end, progress_every=250)
    m = compute_metrics(res, cfg.risk.account_capital)
    out = [render_metrics(m)]
    if res.trades:
        out.append("\nBy setup:\n" + segmented_metrics(res.trades, lambda t: t.setup_type).to_string())
        out.append("\nBy regime at entry:\n" + segmented_metrics(res.trades, lambda t: t.regime).to_string())
        out.append("\nBy year:\n" + segmented_metrics(res.trades, lambda t: t.year).to_string())
        out.append("\nBy sector:\n" + segmented_metrics(res.trades, lambda t: t.sector or "UNMAPPED").to_string())
    out.append("\nCAVEAT: universe = current NIFTY 500 members (survivorship bias);")
    out.append("treat results as relative evidence, not an absolute return forecast.")
    text = "\n".join(out)
    print(text)
    Path("reports").mkdir(exist_ok=True)
    f = Path("reports") / f"backtest_{start.date()}_{end.date()}.txt"
    f.write_text(text, encoding="utf-8")
    print(f"\nSaved: {f}")
    return 0


def cmd_walkforward(args) -> int:
    from .backtest.walkforward import render_walkforward, walk_forward

    cfg = Config.from_yaml(args.config)
    end = pd.Timestamp(f"{args.last_year}-12-31")
    years = args.last_year - args.first_year + args.train_years + 2
    md = load_market_data(cfg, years=years, end=end.date(), max_symbols=args.max_symbols)
    grid = None
    if args.quick:   # reduced grid for a faster (coarser) validation pass
        grid = {"volume.breakout_vol_mult": [1.3, 1.8],
                "risk.t1_r_multiple": [1.5, 2.2]}
    res = walk_forward(md, cfg, args.first_year, args.last_year,
                       train_years=args.train_years, grid=grid)
    text = render_walkforward(res)
    print(text)
    Path("reports").mkdir(exist_ok=True)
    f = Path("reports") / f"walkforward_{args.first_year}_{args.last_year}.txt"
    f.write_text(text, encoding="utf-8")
    print(f"\nSaved: {f}")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="swingscan",
                                description="Indian swing-trade selection engine (plans only, no execution)")
    p.add_argument("--config", default=None, help="YAML config overrides")
    p.add_argument("--max-symbols", type=int, default=None, help="limit universe size (debug)")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("scan", help="run today's scan and print trade plans")
    s.add_argument("--date", default=None, help="scan as of date (default: today)")
    s.add_argument("--refresh-universe", action="store_true")
    s.set_defaults(fn=cmd_scan)

    b = sub.add_parser("backtest", help="historical simulation with costs")
    b.add_argument("--start", required=True)
    b.add_argument("--end", required=True)
    b.set_defaults(fn=cmd_backtest)

    w = sub.add_parser("walkforward", help="rolling out-of-sample parameter validation")
    w.add_argument("--first-year", type=int, required=True)
    w.add_argument("--last-year", type=int, required=True)
    w.add_argument("--train-years", type=int, default=3)
    w.add_argument("--quick", action="store_true", help="reduced parameter grid")
    w.set_defaults(fn=cmd_walkforward)

    args = p.parse_args(argv)
    _setup_console()
    _setup_logging(args.verbose)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
