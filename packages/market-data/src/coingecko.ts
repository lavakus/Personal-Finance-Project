/**
 * CoinGecko adapter — free public API, no key, rate-limited (~10-30/min).
 * Used only for periodic quote refresh, never per-request.
 */

import type { Quote } from "@tradeos/types";

import { ProviderError, type CryptoProvider } from "./types";

const BASE = "https://api.coingecko.com/api/v3";

interface SimplePrice {
  [coinId: string]: {
    [key: string]: number;
  };
}

export const coingeckoProvider: CryptoProvider = {
  id: "coingecko",

  async getQuote(coinId: string, vsCurrency: string): Promise<Quote> {
    const qs = new URLSearchParams({
      ids: coinId,
      vs_currencies: vsCurrency,
      include_24hr_change: "true",
      include_last_updated_at: "true",
    });
    const res = await fetch(`${BASE}/simple/price?${qs}`);
    if (!res.ok) {
      throw new ProviderError("coingecko", `HTTP ${res.status} for ${coinId}`);
    }
    const body = (await res.json()) as SimplePrice;
    const row = body[coinId];
    const price = row?.[vsCurrency];
    if (price == null) {
      throw new ProviderError("coingecko", `no price for ${coinId}`);
    }
    const asOfMs = (row?.last_updated_at ?? 0) * 1000 || Date.now();
    return {
      symbol: coinId.toUpperCase(),
      price,
      changePct: row?.[`${vsCurrency}_24h_change`] ?? 0,
      asOf: new Date(asOfMs).toISOString(),
      freshness: "RECENT", // spot API is near-real-time but still not exchange LIVE
      provider: "coingecko",
    };
  },
};

/** Common symbol → CoinGecko id. Extend as assets are added. */
export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
};
