"""Event-driven daily backtest (spec sections 22-23).

Timeline discipline (no look-ahead):
  * Signals are generated at the CLOSE of day D via scan_asof(md, D) — the
    exact same function the live scanner uses, reading only bars <= D.
  * Entry orders become active on D+1 and live `entry_valid_days` days.
  * Exits are evaluated on each day's OHLC as it arrives; close-based exit
    signals (momentum failure, thesis failure) execute at the NEXT open.

Conservatism:
  * If a bar touches both stop and target, the stop is assumed first.
  * Gap through stop -> filled at the open, not at the stop price.
  * Entries above the zone are never chased; a limit at zone_high is the
    best possible fill.

Sizing: fixed-fractional risk on constant capital (no compounding), so
per-trade R multiples and rupee expectancy are directly comparable across
the test period.

Known bias (documented, spec section 2/22): the universe file is TODAY's
NIFTY 500 membership -> survivorship bias inflates absolute results. Treat
backtest output as relative evidence for parameter robustness, not as an
absolute return forecast.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import Config
from ..pipeline import MarketData, scan_asof
from ..risk import position_size
from .costs import round_trip_charges, slip_buy, slip_sell

log = logging.getLogger(__name__)


@dataclass
class PendingOrder:
    symbol: str
    setup_type: str
    signal_date: pd.Timestamp
    entry_low: float
    entry_high: float
    stop: float
    t1: float
    t2: float
    structure_low: float
    score: float
    regime: str
    sector: str | None
    days_active: int = 0


@dataclass
class Position:
    symbol: str
    setup_type: str
    entry_date: pd.Timestamp
    entry_price: float          # includes slippage
    shares: int
    stop: float
    t1: float
    t2: float
    structure_low: float
    score: float
    regime: str
    sector: str | None
    risk_per_share: float
    days_held: int = 0
    t1_hit: bool = False
    realized: float = 0.0       # gross realized rupees from partial exits
    sell_value: float = 0.0
    buy_value: float = 0.0
    remaining: int = 0
    fail_count: int = 0
    pending_exit_reason: str | None = None
    exit_legs: list = field(default_factory=list)

    def __post_init__(self):
        self.remaining = self.shares
        self.buy_value = self.entry_price * self.shares


@dataclass
class Trade:
    symbol: str
    setup_type: str
    entry_date: pd.Timestamp
    exit_date: pd.Timestamp
    entry_price: float
    shares: int
    gross_pnl: float
    charges: float
    net_pnl: float
    r_multiple: float
    holding_days: int
    exit_reason: str            # primary/final exit reason
    t1_hit: bool
    t2_hit: bool
    regime: str
    sector: str | None
    score: float
    year: int


@dataclass
class BacktestResult:
    trades: list[Trade]
    equity: pd.Series           # cumulative net PnL (rupees, constant capital)
    daily_scans: int
    no_trade_days: int
    config_note: str = ""


def run_backtest(md: MarketData, cfg: Config,
                 start: pd.Timestamp, end: pd.Timestamp,
                 progress_every: int = 0) -> BacktestResult:
    dates = md.nifty.index
    dates = dates[(dates >= pd.Timestamp(start)) & (dates <= pd.Timestamp(end))]

    open_pos: list[Position] = []
    pending: list[PendingOrder] = []
    trades: list[Trade] = []
    daily_pnl: dict[pd.Timestamp, float] = {}
    no_trade_days = 0

    for n, day in enumerate(dates):
        pnl_today = 0.0

        # ---- 1. manage open positions on today's bar --------------------
        still_open: list[Position] = []
        for pos in open_pos:
            bar = _bar(md, pos.symbol, day)
            if bar is None:                      # trading halt: hold, don't count the day
                still_open.append(pos)
                continue
            closed = _manage_position(pos, bar, day, md, cfg)
            if closed is not None:
                trades.append(closed)
                pnl_today += closed.net_pnl
            else:
                still_open.append(pos)
        open_pos = still_open

        # ---- 2. try to fill pending orders -------------------------------
        still_pending: list[PendingOrder] = []
        held = {p.symbol for p in open_pos}
        for od in pending:
            if od.symbol in held or len(open_pos) >= cfg.backtest.max_open_positions:
                continue                          # drop: duplicate or portfolio full
            bar = _bar(md, od.symbol, day)
            if bar is None:
                continue
            od.days_active += 1
            if bar["Close"] < od.structure_low:   # invalidated before entry
                continue
            fill = _try_fill(od, bar)
            if fill is not None:
                price = slip_buy(fill, cfg)
                sz = position_size(price, od.stop, cfg)
                if sz.shares > 0:
                    open_pos.append(Position(
                        symbol=od.symbol, setup_type=od.setup_type,
                        entry_date=day, entry_price=price, shares=sz.shares,
                        stop=od.stop, t1=od.t1, t2=od.t2,
                        structure_low=od.structure_low, score=od.score,
                        regime=od.regime, sector=od.sector,
                        risk_per_share=price - od.stop,
                    ))
                    held.add(od.symbol)
                continue
            if od.days_active < cfg.backtest.entry_valid_days:
                still_pending.append(od)          # order stays working
        pending = still_pending

        # ---- 3. scan at the close for tomorrow's orders -------------------
        res = scan_asof(md, day, cfg, collect_near_misses=False)
        if res.no_trade:
            no_trade_days += 1
        for c in res.candidates:
            if c.symbol in held or any(p.symbol == c.symbol for p in pending):
                continue
            pending.append(PendingOrder(
                symbol=c.symbol, setup_type=c.setup.setup_type, signal_date=day,
                entry_low=c.setup.entry_low, entry_high=c.setup.entry_high,
                stop=c.risk_plan.stop, t1=c.risk_plan.t1, t2=c.risk_plan.t2,
                structure_low=c.setup.structure_low, score=c.score.total,
                regime=res.regime.label, sector=c.sector,
            ))

        daily_pnl[day] = pnl_today
        if progress_every and (n + 1) % progress_every == 0:
            log.info("backtest %s (%d/%d) trades=%d open=%d",
                     day.date(), n + 1, len(dates), len(trades), len(open_pos))

    # ---- liquidate anything still open at the end ------------------------
    for pos in open_pos:
        bar = _last_bar(md, pos.symbol, dates[-1])
        if bar is not None:
            t = _close_out(pos, float(bar["Close"]), dates[-1], "end_of_test", cfg)
            trades.append(t)
            daily_pnl[dates[-1]] = daily_pnl.get(dates[-1], 0.0) + t.net_pnl

    equity = pd.Series(daily_pnl).sort_index().cumsum()
    return BacktestResult(trades, equity, len(dates), no_trade_days)


# ---------------------------------------------------------------- helpers

def _bar(md: MarketData, symbol: str, day: pd.Timestamp):
    panel = md.panels.get(symbol)
    if panel is None or day not in panel.index:
        return None
    return panel.loc[day]


def _last_bar(md: MarketData, symbol: str, day: pd.Timestamp):
    panel = md.panels.get(symbol)
    if panel is None:
        return None
    view = panel.loc[:day]
    return view.iloc[-1] if len(view) else None


def _try_fill(od: PendingOrder, bar) -> float | None:
    """Buy-stop-limit: trigger at entry_low, never pay above entry_high."""
    o, h, lo = float(bar["Open"]), float(bar["High"]), float(bar["Low"])
    if o > od.entry_high:                 # gapped above zone: only fill if it comes back
        return od.entry_high if lo <= od.entry_high else None
    if o >= od.entry_low:                 # opened inside the zone
        return o
    return od.entry_low if h >= od.entry_low else None   # rallied up to the trigger


def _manage_position(pos: Position, bar, day: pd.Timestamp,
                     md: MarketData, cfg: Config) -> Trade | None:
    o, h, lo, c = (float(bar[k]) for k in ("Open", "High", "Low", "Close"))
    pos.days_held += 1

    # 0. exit queued from yesterday's close signal
    if pos.pending_exit_reason:
        return _close_out(pos, o, day, pos.pending_exit_reason, cfg)

    # 1. stop first (conservative same-day rule)
    if o <= pos.stop:
        return _close_out(pos, o, day, "stop_gap", cfg)
    if lo <= pos.stop:
        return _close_out(pos, pos.stop, day, "stop", cfg)

    # 2. targets
    if not pos.t1_hit and h >= pos.t1:
        fill = max(o, pos.t1)
        part = int(round(pos.remaining * cfg.backtest.partial_at_t1))
        part = min(max(part, 1), pos.remaining)
        px = slip_sell(fill, cfg)
        pos.realized += (px - pos.entry_price) * part
        pos.sell_value += px * part
        pos.remaining -= part
        pos.t1_hit = True
        pos.exit_legs.append(("t1", day, px, part))
        if cfg.exits.trail_after_t1:
            pos.stop = max(pos.stop, pos.entry_price)     # breakeven trail
        if pos.remaining == 0:
            return _finalize(pos, day, "t1_full", cfg)
    if pos.t1_hit and pos.remaining > 0 and h >= pos.t2:
        fill = max(o, pos.t2)
        return _close_out(pos, fill, day, "t2", cfg)

    # 3. time stop
    if pos.days_held >= cfg.exits.max_holding_days:
        return _close_out(pos, c, day, "time_stop", cfg)

    # 4. close-based failure detectors -> exit next open
    ema20 = float(bar["ema20"]); atr = float(bar["atr"]); macd_h = float(bar["macd_hist"])
    if c < pos.structure_low:
        pos.pending_exit_reason = "thesis_failure"
        return None
    below = c < ema20 - cfg.exits.fail_atr_below_ema * atr
    pos.fail_count = pos.fail_count + 1 if (below and macd_h < 0) else 0
    if pos.fail_count >= cfg.exits.fail_confirm_days:
        pos.pending_exit_reason = "momentum_failure"
    return None


def _close_out(pos: Position, raw_price: float, day: pd.Timestamp,
               reason: str, cfg: Config) -> Trade:
    px = slip_sell(raw_price, cfg)
    pos.realized += (px - pos.entry_price) * pos.remaining
    pos.sell_value += px * pos.remaining
    pos.exit_legs.append((reason, day, px, pos.remaining))
    pos.remaining = 0
    return _finalize(pos, day, reason, cfg)


def _finalize(pos: Position, day: pd.Timestamp, reason: str, cfg: Config) -> Trade:
    charges = round_trip_charges(pos.buy_value, pos.sell_value, cfg)
    net = pos.realized - charges
    risk_amount = pos.risk_per_share * pos.shares
    return Trade(
        symbol=pos.symbol, setup_type=pos.setup_type,
        entry_date=pos.entry_date, exit_date=day,
        entry_price=pos.entry_price, shares=pos.shares,
        gross_pnl=round(pos.realized, 2), charges=round(charges, 2),
        net_pnl=round(net, 2),
        r_multiple=net / risk_amount if risk_amount > 0 else 0.0,
        holding_days=pos.days_held,
        exit_reason=reason, t1_hit=pos.t1_hit,
        t2_hit=reason == "t2", regime=pos.regime, sector=pos.sector,
        score=pos.score, year=day.year,
    )
