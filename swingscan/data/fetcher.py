"""OHLCV data fetch + local parquet cache.

Source: Yahoo Finance daily bars, auto-adjusted for splits/dividends
(corporate-action adjustment requirement, spec section 28).

Cache policy: one parquet per symbol under cache/prices/. A cached file is
reused when it already covers the requested [start, end] range within
tolerance; otherwise the full range is re-downloaded (simple and robust
against back-adjustment changes after corporate actions).
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

log = logging.getLogger(__name__)

_OHLCV = ["Open", "High", "Low", "Close", "Volume"]


def _safe_name(symbol: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", symbol)


def _normalize(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[[c for c in _OHLCV if c in df.columns]]
    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return df.dropna(subset=["Close"])


class PriceStore:
    def __init__(self, cache_dir: str | Path):
        self.dir = Path(cache_dir) / "prices"
        self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, symbol: str) -> Path:
        return self.dir / f"{_safe_name(symbol)}.parquet"

    def _cached(self, symbol: str, start: date, end: date) -> pd.DataFrame | None:
        p = self._path(symbol)
        if not p.exists():
            return None
        try:
            df = pd.read_parquet(p)
        except Exception:
            return None
        if df.empty:
            return None
        cov_start, cov_end = df.index[0].date(), df.index[-1].date()
        # allow slack: listings younger than `start`, and weekend/holiday gap at the end
        if cov_start <= start + timedelta(days=7) or self._is_full_history(symbol):
            if cov_end >= end - timedelta(days=4):
                return df.loc[str(start): str(end)]
        return None

    def _is_full_history(self, symbol: str) -> bool:
        marker = self.dir / f"{_safe_name(symbol)}.full"
        return marker.exists()

    def _mark_full(self, symbol: str, requested_start: date, got_start: date) -> None:
        # If Yahoo returned less than requested, the listing is younger: cache is complete.
        if got_start > requested_start + timedelta(days=7):
            (self.dir / f"{_safe_name(symbol)}.full").touch()

    def get_many(self, symbols: list[str], start: date, end: date,
                 batch_size: int = 50) -> dict[str, pd.DataFrame]:
        """Fetch daily OHLCV for many symbols, serving from cache when possible."""
        result: dict[str, pd.DataFrame] = {}
        missing: list[str] = []
        for s in symbols:
            df = self._cached(s, start, end)
            if df is not None:
                result[s] = df
            else:
                missing.append(s)

        for i in range(0, len(missing), batch_size):
            chunk = missing[i : i + batch_size]
            log.info("Downloading %d symbols (%d/%d done)...", len(chunk), i, len(missing))
            raw = yf.download(
                chunk,
                start=str(start),
                end=str(end + timedelta(days=1)),
                interval="1d",
                auto_adjust=True,
                group_by="ticker",
                threads=True,
                progress=False,
            )
            for s in chunk:
                try:
                    df = raw[s] if isinstance(raw.columns, pd.MultiIndex) else raw
                    df = _normalize(df)
                except Exception:
                    df = pd.DataFrame(columns=_OHLCV)
                if len(df):
                    df.to_parquet(self._path(s))
                    self._mark_full(s, start, df.index[0].date())
                    result[s] = df
                else:
                    log.warning("No data for %s", s)
        return result

    def get_one(self, symbol: str, start: date, end: date) -> pd.DataFrame | None:
        return self.get_many([symbol], start, end).get(symbol)
