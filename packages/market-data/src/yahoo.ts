/**
 * Yahoo Finance adapter — free, no key, DELAYED data (never labeled LIVE).
 * Same source swingscan already uses successfully for NSE EOD analytics.
 * Endpoint: query1.finance.yahoo.com/v8/finance/chart (public chart API).
 */

import type { OHLCVBar, Quote } from "@tradeos/types";

import {
  freshnessFromAge,
  ProviderError,
  type DateRange,
  type MarketDataProvider,
} from "./types";

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = { "user-agent": "Mozilla/5.0 (personal portfolio tracker)" };

interface YahooChart {
  chart: {
    result?: Array<{
      meta: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      indicators: {
        quote: Array<{
          open: Array<number | null>;
          high: Array<number | null>;
          low: Array<number | null>;
          close: Array<number | null>;
          volume: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
}

async function fetchChart(
  symbol: string,
  params: Record<string, string>
): Promise<NonNullable<YahooChart["chart"]["result"]>[number]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/${encodeURIComponent(symbol)}?${qs}`, {
    headers: UA,
  });
  if (!res.ok) {
    throw new ProviderError("yahoo", `HTTP ${res.status} for ${symbol}`);
  }
  const body = (await res.json()) as YahooChart;
  const result = body.chart.result?.[0];
  if (!result) {
    throw new ProviderError(
      "yahoo",
      body.chart.error?.description ?? `empty result for ${symbol}`
    );
  }
  return result;
}

export const yahooProvider: MarketDataProvider = {
  id: "yahoo",

  async getDailyBars(symbol: string, range: DateRange): Promise<OHLCVBar[]> {
    const period1 = Math.floor(new Date(range.from).getTime() / 1000);
    const period2 = Math.floor(new Date(range.to).getTime() / 1000) + 86_400;
    const r = await fetchChart(symbol, {
      period1: String(period1),
      period2: String(period2),
      interval: "1d",
      events: "history",
    });
    const ts = r.timestamp ?? [];
    const q = r.indicators.quote[0];
    if (!q) return [];
    const bars: OHLCVBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
      if (o == null || h == null || l == null || c == null) continue;
      bars.push({
        date: new Date(ts[i]! * 1000).toISOString().slice(0, 10),
        open: o,
        high: h,
        low: l,
        close: c,
        volume: q.volume[i] ?? 0,
      });
    }
    return bars;
  },

  async getQuote(symbol: string): Promise<Quote> {
    const r = await fetchChart(symbol, { range: "5d", interval: "1d" });
    const price = r.meta.regularMarketPrice;
    const prev = r.meta.chartPreviousClose ?? r.meta.previousClose;
    if (price == null) {
      throw new ProviderError("yahoo", `no price for ${symbol}`);
    }
    const asOfMs = (r.meta.regularMarketTime ?? 0) * 1000 || Date.now();
    return {
      symbol,
      price,
      changePct: prev ? ((price - prev) / prev) * 100 : 0,
      asOf: new Date(asOfMs).toISOString(),
      freshness: freshnessFromAge(asOfMs, Date.now()),
      provider: "yahoo",
    };
  },
};

/** NSE equity symbol → Yahoo ticker (RELIANCE → RELIANCE.NS). Symbols that
 *  are already Yahoo-native (indices ^NSEI, futures GC=F, FX USDINR=X,
 *  dotted tickers) pass through unchanged. */
export function nseToYahoo(symbol: string): string {
  return symbol.includes(".") || symbol.includes("=") || symbol.startsWith("^")
    ? symbol
    : `${symbol}.NS`;
}
