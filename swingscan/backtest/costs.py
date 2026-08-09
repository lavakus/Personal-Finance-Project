"""Indian delivery-equity transaction cost model (spec section 25).

Charges modeled per side on traded value:
  brokerage (percent with per-order rupee cap), STT (buy+sell for delivery),
  NSE exchange transaction charge, SEBI turnover fee, GST (18% on
  brokerage+exchange+SEBI), stamp duty (buy only). Slippage is applied to
  execution PRICES by the engine, not here.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CostBreakdown:
    brokerage: float
    stt: float
    exchange: float
    sebi: float
    gst: float
    stamp_duty: float

    @property
    def total(self) -> float:
        return self.brokerage + self.stt + self.exchange + self.sebi + self.gst + self.stamp_duty


def side_charges(value: float, is_buy: bool, cfg) -> CostBreakdown:
    c = cfg.costs
    brokerage = min(value * c.brokerage_pct, c.brokerage_cap)
    stt = value * c.stt_pct
    exchange = value * c.exchange_pct
    sebi = value * c.sebi_pct
    gst = (brokerage + exchange + sebi) * c.gst_pct
    stamp = value * c.stamp_duty_pct if is_buy else 0.0
    return CostBreakdown(brokerage, stt, exchange, sebi, gst, stamp)


def round_trip_charges(buy_value: float, sell_value: float, cfg) -> float:
    return side_charges(buy_value, True, cfg).total + side_charges(sell_value, False, cfg).total


def slip_buy(price: float, cfg) -> float:
    return price * (1.0 + cfg.costs.slippage_pct)


def slip_sell(price: float, cfg) -> float:
    return price * (1.0 - cfg.costs.slippage_pct)
