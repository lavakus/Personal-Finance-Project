/**
 * @tradeos/market-data — provider factory + tracked-symbol registry.
 *
 * Consumers NEVER import yahoo.ts / coingecko.ts directly (brief §73):
 * they ask the factory. Swapping/adding a paid provider = new adapter file
 * + one factory entry.
 */

import type { Quote } from "@tradeos/types";

import { coingeckoProvider, COINGECKO_IDS } from "./coingecko";
import type {
  CryptoProvider,
  DateRange,
  MarketDataProvider,
} from "./types";
import { nseToYahoo, yahooProvider } from "./yahoo";

export * from "./types";
export { nseToYahoo, COINGECKO_IDS };

const marketProviders: Record<string, MarketDataProvider> = {
  yahoo: yahooProvider,
};
const cryptoProviders: Record<string, CryptoProvider> = {
  coingecko: coingeckoProvider,
};

export function getMarketDataProvider(id = "yahoo"): MarketDataProvider {
  const p = marketProviders[id];
  if (!p) throw new Error(`unknown market data provider: ${id}`);
  return p;
}

export function getCryptoProvider(id = "coingecko"): CryptoProvider {
  const p = cryptoProviders[id];
  if (!p) throw new Error(`unknown crypto provider: ${id}`);
  return p;
}

// ─────────────────────────── tracked indices (brief §9, §39, §40)

export interface TrackedIndex {
  code: string;          // stable key stored in DB
  name: string;
  providerSymbol: string; // yahoo symbol
  currency: string;
}

export const TRACKED_INDICES: TrackedIndex[] = [
  { code: "NIFTY50", name: "NIFTY 50", providerSymbol: "^NSEI", currency: "INR" },
  { code: "BANKNIFTY", name: "BANK NIFTY", providerSymbol: "^NSEBANK", currency: "INR" },
  { code: "INDIAVIX", name: "INDIA VIX", providerSymbol: "^INDIAVIX", currency: "INR" },
  { code: "SP500", name: "S&P 500", providerSymbol: "^GSPC", currency: "USD" },
  { code: "NASDAQ", name: "NASDAQ", providerSymbol: "^IXIC", currency: "USD" },
  { code: "DOWJONES", name: "Dow Jones", providerSymbol: "^DJI", currency: "USD" },
  { code: "GOLD", name: "Gold (COMEX)", providerSymbol: "GC=F", currency: "USD" },
  { code: "USDINR", name: "USD/INR", providerSymbol: "USDINR=X", currency: "INR" },
];

/** Quote for an asset by class — routes to the right provider. */
export async function quoteForAsset(params: {
  symbol: string;
  assetClass: string;
}): Promise<Quote> {
  const { symbol, assetClass } = params;
  if (assetClass === "CRYPTO") {
    const id = COINGECKO_IDS[symbol.toUpperCase()];
    if (!id) throw new Error(`no coingecko mapping for ${symbol}`);
    return getCryptoProvider().getQuote(id, "usd");
  }
  if (assetClass === "GOLD") {
    return getMarketDataProvider().getQuote("GC=F");
  }
  // EQUITY_IN and anything Yahoo-shaped
  return getMarketDataProvider().getQuote(nseToYahoo(symbol));
}

export async function dailyBarsForAsset(params: {
  symbol: string;
  assetClass: string;
  range: DateRange;
}): Promise<ReturnType<MarketDataProvider["getDailyBars"]>> {
  const { symbol, assetClass, range } = params;
  const provider = getMarketDataProvider();
  if (assetClass === "GOLD") return provider.getDailyBars("GC=F", range);
  if (assetClass === "CRYPTO")
    return provider.getDailyBars(`${symbol.toUpperCase()}-USD`, range);
  return provider.getDailyBars(nseToYahoo(symbol), range);
}
