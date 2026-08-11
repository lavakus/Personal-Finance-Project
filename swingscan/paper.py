"""Paper-trading engine: the swing scanner run as a real ₹10,00,000 book.

This is NOT a backtest and NOT a new strategy. Entry and exit decisions are
made by importing the *same* helpers the validated backtest uses --
`_try_fill`, `_manage_position`, `_close_out` -- so a paper trade fills and
exits under identical rules. If those rules change, this changes with them.
Only three things differ, and all three are portfolio policy rather than
signal logic:

    1. SIZING       fixed ₹1,00,000 notional per name, not risk-based sizing.
    2. SELECTION    only signals scoring >= min_score are taken.
    3. CAPITAL      real cash accounting against a finite ₹10,00,000, so a
                    position is skipped when the cash is not there. The
                    backtest assumes constant capital and cannot refuse.

Open positions are NOT liquidated at the end of the run. run_backtest closes
everything on the last bar to score a completed experiment; a paper book is
still holding, and pretending otherwise would invent exits that never happened.

Replay is deterministic and causal: every decision on day D uses only data up
to D (`scan_asof`), so running 1 Jul -> today produces exactly the same trades
today, tomorrow and next month. That single property is what lets one code path
serve both "show me last month" and "keep trading it forward" -- the daily job
just replays from the account's start date and upserts.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import pandas as pd

from swingscan.backtest.costs import slip_buy
from swingscan.backtest.engine import (
    PendingOrder,
    Position,
    Trade,
    _bar,
    _manage_position,
    _try_fill,
)
from swingscan.config import Config
from swingscan.pipeline import MarketData, scan_asof

log = logging.getLogger(__name__)

CAPITAL = 1_000_000.0        # ₹10 lakh
PER_POSITION = 100_000.0     # ₹1 lakh per name -> 10 slots
MIN_SCORE = 80.0


@dataclass
class PaperConfig:
    capital: float = CAPITAL
    per_position: float = PER_POSITION
    min_score: float = MIN_SCORE
    max_open: int = 10


@dataclass
class OpenPosition:
    """A live position, reported rather than closed at end of run."""

    symbol: str
    setup_type: str
    entry_date: pd.Timestamp
    entry_price: float
    shares: int
    remaining: int
    stop: float
    t1: float
    t2: float
    score: float
    sector: str | None
    regime: str
    days_held: int
    t1_hit: bool
    last_close: float
    invested: float
    booked: float                 # cash already realized from partial exits

    @property
    def market_value(self) -> float:
        return self.remaining * self.last_close + self.booked

    @property
    def unrealized(self) -> float:
        return self.market_value - self.invested


@dataclass
class PaperResult:
    trades: list[Trade]
    open_positions: list[OpenPosition]
    equity: pd.Series             # total book value per day
    cash: float
    start: pd.Timestamp
    end: pd.Timestamp
    cfg: PaperConfig
    skipped_no_cash: int = 0
    skipped_low_score: int = 0
    signals_seen: int = 0
    daily_cash: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    daily_open: pd.Series = field(default_factory=lambda: pd.Series(dtype=int))


def _size(price: float, per_position: float) -> int:
    """Whole shares only. Floor, never round up: rounding up would quietly
    exceed the per-name budget on nearly every entry."""
    if price <= 0:
        return 0
    return int(per_position // price)


def run_paper(md: MarketData, cfg: Config, pcfg: PaperConfig,
              start: pd.Timestamp, end: pd.Timestamp,
              progress_every: int = 0) -> PaperResult:
    dates = md.nifty.index
    dates = dates[(dates >= pd.Timestamp(start)) & (dates <= pd.Timestamp(end))]
    if not len(dates):
        raise ValueError(f"no trading days between {start} and {end}")

    cash = pcfg.capital
    open_pos: list[Position] = []
    pending: list[PendingOrder] = []
    trades: list[Trade] = []
    equity_curve: dict[pd.Timestamp, float] = {}
    cash_curve: dict[pd.Timestamp, float] = {}
    open_curve: dict[pd.Timestamp, int] = {}
    skipped_no_cash = 0
    skipped_low_score = 0
    signals_seen = 0

    for n, day in enumerate(dates):
        # ---- 1. manage open positions on today's bar ----------------------
        still_open: list[Position] = []
        for pos in open_pos:
            bar = _bar(md, pos.symbol, day)
            if bar is None:                    # halt / no data: hold the day
                still_open.append(pos)
                continue
            closed = _manage_position(pos, bar, day, md, cfg)
            if closed is not None:
                trades.append(closed)
                # Return the capital plus the net result. Charges are inside
                # net_pnl (round_trip_charges is applied once, at exit).
                cash += pos.buy_value + closed.net_pnl
            else:
                still_open.append(pos)
        open_pos = still_open

        # ---- 2. try to fill working orders --------------------------------
        still_pending: list[PendingOrder] = []
        held = {p.symbol for p in open_pos}
        for od in pending:
            if od.symbol in held or len(open_pos) >= pcfg.max_open:
                continue                        # duplicate name, or book full
            bar = _bar(md, od.symbol, day)
            if bar is None:
                continue
            od.days_active += 1
            if bar["Close"] < od.structure_low:  # invalidated before entry
                continue
            fill = _try_fill(od, bar)
            if fill is not None:
                price = slip_buy(fill, cfg)
                shares = _size(price, pcfg.per_position)
                cost = shares * price
                if shares <= 0:
                    continue                    # one share costs over ₹1 lakh
                if cost > cash:
                    skipped_no_cash += 1
                    continue                    # honest refusal, not leverage
                cash -= cost
                open_pos.append(Position(
                    symbol=od.symbol, setup_type=od.setup_type,
                    entry_date=day, entry_price=price, shares=shares,
                    stop=od.stop, t1=od.t1, t2=od.t2,
                    structure_low=od.structure_low, score=od.score,
                    regime=od.regime, sector=od.sector,
                    risk_per_share=price - od.stop,
                ))
                held.add(od.symbol)
                continue
            if od.days_active < cfg.backtest.entry_valid_days:
                still_pending.append(od)        # order stays working
        pending = still_pending

        # ---- 3. scan at the close for tomorrow's orders -------------------
        res = scan_asof(md, day, cfg, collect_near_misses=False)
        for c in res.candidates:
            signals_seen += 1
            if c.score.total < pcfg.min_score:
                skipped_low_score += 1
                continue
            if c.symbol in held or any(p.symbol == c.symbol for p in pending):
                continue
            pending.append(PendingOrder(
                symbol=c.symbol, setup_type=c.setup.setup_type, signal_date=day,
                entry_low=c.setup.entry_low, entry_high=c.setup.entry_high,
                stop=c.risk_plan.stop, t1=c.risk_plan.t1, t2=c.risk_plan.t2,
                structure_low=c.setup.structure_low, score=c.score.total,
                regime=res.regime.label, sector=c.sector,
            ))

        # ---- 4. mark the book -------------------------------------------
        invested_value = 0.0
        for pos in open_pos:
            bar = _bar(md, pos.symbol, day)
            px = float(bar["Close"]) if bar is not None else pos.entry_price
            invested_value += pos.remaining * px + pos.sell_value
        equity_curve[day] = cash + invested_value
        cash_curve[day] = cash
        open_curve[day] = len(open_pos)

        if progress_every and (n + 1) % progress_every == 0:
            log.info("paper %s (%d/%d) trades=%d open=%d equity=%.0f",
                     day.date(), n + 1, len(dates),
                     len(trades), len(open_pos), equity_curve[day])

    # Report open positions as open. Do NOT liquidate.
    last_day = dates[-1]
    live: list[OpenPosition] = []
    for pos in open_pos:
        bar = _bar(md, pos.symbol, last_day)
        px = float(bar["Close"]) if bar is not None else pos.entry_price
        live.append(OpenPosition(
            symbol=pos.symbol, setup_type=pos.setup_type,
            entry_date=pos.entry_date, entry_price=pos.entry_price,
            shares=pos.shares, remaining=pos.remaining,
            stop=pos.stop, t1=pos.t1, t2=pos.t2, score=pos.score,
            sector=pos.sector, regime=pos.regime, days_held=pos.days_held,
            t1_hit=pos.t1_hit, last_close=px,
            invested=pos.buy_value, booked=pos.sell_value,
        ))

    return PaperResult(
        trades=trades, open_positions=live,
        equity=pd.Series(equity_curve).sort_index(),
        cash=cash, start=dates[0], end=last_day, cfg=pcfg,
        skipped_no_cash=skipped_no_cash,
        skipped_low_score=skipped_low_score,
        signals_seen=signals_seen,
        daily_cash=pd.Series(cash_curve).sort_index(),
        daily_open=pd.Series(open_curve).sort_index(),
    )


def summarize(res: PaperResult) -> dict:
    """Plain arithmetic on the equity curve. No annualisation of a one-month
    sample -- multiplying a 30-day result by 12 is how small samples get sold
    as track records."""
    eq = res.equity
    start_v, end_v = res.cfg.capital, float(eq.iloc[-1])
    closed = res.trades
    wins = [t for t in closed if t.net_pnl > 0]
    losses = [t for t in closed if t.net_pnl <= 0]
    gross_win = sum(t.net_pnl for t in wins)
    gross_loss = -sum(t.net_pnl for t in losses)
    realized = sum(t.net_pnl for t in closed)
    unrealized = sum(p.unrealized for p in res.open_positions)
    dd = float((eq / eq.cummax() - 1).min()) if len(eq) > 1 else 0.0
    return {
        "start": str(res.start.date()),
        "end": str(res.end.date()),
        "trading_days": len(eq),
        "capital": start_v,
        "equity": round(end_v, 2),
        "total_return_pct": round(100.0 * (end_v / start_v - 1), 2),
        "realized_pnl": round(realized, 2),
        "unrealized_pnl": round(unrealized, 2),
        "cash": round(res.cash, 2),
        "closed_trades": len(closed),
        "open_positions": len(res.open_positions),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": round(100.0 * len(wins) / len(closed), 1) if closed else None,
        "avg_r": round(sum(t.r_multiple for t in closed) / len(closed), 3) if closed else None,
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
        "total_charges": round(sum(t.charges for t in closed), 2),
        "max_drawdown_pct": round(100.0 * dd, 2),
        "signals_seen": res.signals_seen,
        "skipped_low_score": res.skipped_low_score,
        "skipped_no_cash": res.skipped_no_cash,
    }
