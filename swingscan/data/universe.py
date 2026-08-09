"""Stock universe: NIFTY 500 constituents from NSE archives, with sector mapping.

The NIFTY 500 list is a practical liquid-universe proxy for NSE equities.
The CSV is cached locally; a stale cache is still used (with a warning) if
NSE is unreachable, so the scanner degrades gracefully.

NOTE (survivorship bias): the live constituent file reflects TODAY's index
membership. Backtests over this universe carry survivorship bias — flagged
explicitly in backtest reports. Point-in-time membership data is the fix if
historical membership files are ever added to cache/universe_history/.
"""

from __future__ import annotations

import io
import json
import logging
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import requests

log = logging.getLogger(__name__)

NIFTY500_URL = "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"
_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# Yahoo Finance symbols for Indian indices
INDEX_SYMBOLS = {
    "NIFTY50": "^NSEI",
    "NIFTY500": "^CRSLDX",
    "INDIAVIX": "^INDIAVIX",
}

SECTOR_INDEX_SYMBOLS = {
    "NIFTY IT": "^CNXIT",
    "NIFTY BANK": "^NSEBANK",
    "NIFTY AUTO": "^CNXAUTO",
    "NIFTY PHARMA": "^CNXPHARMA",
    "NIFTY FMCG": "^CNXFMCG",
    "NIFTY METAL": "^CNXMETAL",
    "NIFTY REALTY": "^CNXREALTY",
    "NIFTY ENERGY": "^CNXENERGY",
    "NIFTY MEDIA": "^CNXMEDIA",
    "NIFTY INFRA": "^CNXINFRA",
    "NIFTY PSU BANK": "^CNXPSUBANK",
    "NIFTY FIN SERVICE": "NIFTY_FIN_SERVICE.NS",
}

# NSE "Industry" field -> sector index used for relative-strength comparison.
# Industries without a reliable Yahoo sector index map to None (stock is then
# compared against NIFTY only and gets a neutral sector score).
INDUSTRY_TO_SECTOR = {
    "Information Technology": "NIFTY IT",
    "Financial Services": "NIFTY FIN SERVICE",
    "Automobile and Auto Components": "NIFTY AUTO",
    "Healthcare": "NIFTY PHARMA",
    "Fast Moving Consumer Goods": "NIFTY FMCG",
    "Metals & Mining": "NIFTY METAL",
    "Realty": "NIFTY REALTY",
    "Oil Gas & Consumable Fuels": "NIFTY ENERGY",
    "Power": "NIFTY ENERGY",
    "Media Entertainment & Publication": "NIFTY MEDIA",
    "Construction": "NIFTY INFRA",
    "Construction Materials": "NIFTY INFRA",
    "Capital Goods": "NIFTY INFRA",
    "Services": None,
    "Telecommunication": None,
    "Consumer Durables": None,
    "Chemicals": None,
    "Textiles": None,
    "Consumer Services": None,
    "Diversified": None,
    "Forest Materials": None,
}


def load_universe(cache_dir: str | Path, refresh: bool = False) -> pd.DataFrame:
    """Returns DataFrame[symbol, name, industry, sector, yahoo].

    `sector` is the mapped sector index name (or None).
    `yahoo` is the Yahoo Finance ticker (SYMBOL.NS).
    """
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / "nifty500.csv"
    meta_file = cache_dir / "nifty500.meta.json"

    text: str | None = None
    fresh_today = False
    if meta_file.exists() and cache_file.exists():
        meta = json.loads(meta_file.read_text())
        fresh_today = meta.get("fetched") == str(date.today())

    if refresh or not cache_file.exists() or not fresh_today:
        try:
            resp = requests.get(NIFTY500_URL, headers=_HEADERS, timeout=30)
            resp.raise_for_status()
            text = resp.text
            cache_file.write_text(text, encoding="utf-8")
            meta_file.write_text(json.dumps({"fetched": str(date.today()),
                                             "fetched_at": datetime.now().isoformat()}))
        except Exception as exc:  # network failure -> stale cache fallback
            if cache_file.exists():
                log.warning("NSE universe fetch failed (%s); using cached list.", exc)
            else:
                raise RuntimeError(f"Cannot fetch NIFTY 500 list and no cache exists: {exc}")

    if text is None:
        text = cache_file.read_text(encoding="utf-8")

    df = pd.read_csv(io.StringIO(text))
    df.columns = [c.strip() for c in df.columns]
    out = pd.DataFrame({
        "symbol": df["Symbol"].str.strip(),
        "name": df["Company Name"].str.strip(),
        "industry": df["Industry"].str.strip(),
    })
    # Sector = NSE industry group. Sector strength uses synthetic composites
    # built from these groups (see sector_strength.build_sector_composites),
    # so every industry gets real sector treatment.
    out["sector"] = out["industry"]
    out["yahoo"] = out["symbol"] + ".NS"
    return out
