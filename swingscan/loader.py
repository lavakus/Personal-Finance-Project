"""High-level data assembly: universe + prices + indices -> MarketData."""

from __future__ import annotations

import logging
from datetime import date, timedelta

import pandas as pd

from .config import Config
from .data.fetcher import PriceStore
from .data.universe import INDEX_SYMBOLS, load_universe
from .pipeline import MarketData

log = logging.getLogger(__name__)


def load_market_data(cfg: Config, years: int | None = None,
                     end: date | None = None,
                     max_symbols: int | None = None,
                     refresh_universe: bool = False) -> MarketData:
    end = end or date.today()
    years = years or cfg.data.history_years
    start = end - timedelta(days=int(years * 365.25) + 30)

    universe = load_universe(cfg.data.cache_dir, refresh=refresh_universe)
    if max_symbols:
        universe = universe.head(max_symbols)

    store = PriceStore(cfg.data.cache_dir)

    nifty = store.get_one(INDEX_SYMBOLS["NIFTY50"], start, end)
    if nifty is None or nifty.empty:
        raise RuntimeError("Could not load NIFTY 50 data — cannot scan without the market index.")

    vix_df = store.get_one(INDEX_SYMBOLS["INDIAVIX"], start, end)
    vix = vix_df["Close"] if vix_df is not None and len(vix_df) else None
    if vix is None:
        log.warning("India VIX unavailable — regime scoring proceeds without it.")

    prices_raw = store.get_many(universe["yahoo"].tolist(), start, end, cfg.data.batch_size)
    # key by NSE symbol, not the .NS yahoo ticker
    yahoo_to_sym = dict(zip(universe["yahoo"], universe["symbol"]))
    prices = {yahoo_to_sym[y]: df for y, df in prices_raw.items() if y in yahoo_to_sym}
    log.info("Loaded prices for %d/%d universe symbols.", len(prices), len(universe))

    # Sector series: synthetic equal-weight composites per NSE industry group.
    # (Yahoo's ^CNX* sector indices go stale; composites are always as fresh
    # as the stock data and cover every industry.)
    from .sector_strength import build_sector_composites
    sector_closes = build_sector_composites(prices, universe)
    log.info("Built %d sector composites.", len(sector_closes))

    return MarketData.build(prices, universe, nifty, sector_closes, vix, cfg)
