/**
 * Provider abstraction (brief §73 — mandatory). Nothing outside this
 * package may import a concrete provider; consumers go through the
 * factory in index.ts so paid/licensed feeds are adapters, not rewrites.
 */

import type { DataFreshness, OHLCVBar, Quote } from "@tradeos/types";

export interface DateRange {
  /** ISO dates, inclusive. */
  from: string;
  to: string;
}

export interface MarketDataProvider {
  id: string;
  getDailyBars(symbol: string, range: DateRange): Promise<OHLCVBar[]>;
  getQuote(symbol: string): Promise<Quote>;
}

export interface CryptoProvider {
  id: string;
  getQuote(coinId: string, vsCurrency: string): Promise<Quote>;
}

export interface GoldProvider {
  id: string;
  getQuote(): Promise<Quote>;
}

/**
 * Freshness from quote age (brief §76). Free feeds are delayed, so this
 * platform NEVER labels them LIVE: at best RECENT.
 */
export function freshnessFromAge(asOfMs: number, nowMs: number): DataFreshness {
  const ageHours = (nowMs - asOfMs) / 3_600_000;
  if (ageHours <= 24) return "RECENT";
  if (ageHours <= 24 * 7) return "STALE";
  return "UNAVAILABLE";
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string
  ) {
    super(`[${provider}] ${message}`);
  }
}
