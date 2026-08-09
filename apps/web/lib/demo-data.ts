/**
 * DEMO MODE sample data (brief §83). Rendered ONLY when Supabase env is
 * absent, always behind a visible DEMO badge. These are illustrative
 * numbers, not market data — never shown alongside live values.
 */

import type { DataFreshness, MarketRegime } from "@tradeos/types";

export const demoProfile = {
  displayName: "Demo Trader",
  role: "ADMIN" as const,
  baseCurrency: "INR" as const,
};

export const demoPortfolio = {
  invested: "1250000",
  currentValue: "1387400",
  realizedPnl: "48200",
  unrealizedPnl: "137400",
  returnPct: "10.99",
};

export const demoMarkets: Array<{
  label: string;
  value: string;
  changePct: number;
  freshness: DataFreshness;
}> = [
  { label: "NIFTY 50", value: "24,570.65", changePct: 0.42, freshness: "DEMO" },
  { label: "BANK NIFTY", value: "55,120.30", changePct: -0.18, freshness: "DEMO" },
  { label: "INDIA VIX", value: "12.16", changePct: -2.1, freshness: "DEMO" },
  { label: "BTC/USD", value: "118,240", changePct: 1.82, freshness: "DEMO" },
  { label: "GOLD", value: "3,412.50", changePct: 0.34, freshness: "DEMO" },
  { label: "S&P 500", value: "6,389.77", changePct: 0.25, freshness: "DEMO" },
  { label: "NASDAQ", value: "23,336.25", changePct: 0.35, freshness: "DEMO" },
];

export const demoRegime: { regime: MarketRegime; score: number; breadth: number } = {
  regime: "BULLISH",
  score: 40,
  breadth: 65,
};

export const demoSetups = [
  {
    symbol: "EMCURE", setup: "PULLBACK", score: 77, tier: "B",
    entry: "2,009–2,023", stop: "1,866", t1: "2,286", t2: "2,436", rr1: 1.8,
  },
];

export const demoHoldings = [
  { symbol: "RELIANCE", name: "Reliance Industries", assetClass: "EQUITY_IN", qty: "40", avg: "1352.40", invested: "54096.00", realized: "2140.00" },
  { symbol: "TATAMOTORS", name: "Tata Motors", assetClass: "EQUITY_IN", qty: "120", avg: "688.15", invested: "82578.00", realized: "0" },
  { symbol: "BTC", name: "Bitcoin", assetClass: "CRYPTO", qty: "0.05", avg: "97250.00", invested: "4862.50", realized: "312.75" },
  { symbol: "GOLD", name: "Gold (grams)", assetClass: "GOLD", qty: "25", avg: "7120.00", invested: "178000.00", realized: "0" },
];

export const demoTransactions = [
  { date: "2026-08-05", type: "BUY", symbol: "RELIANCE", qty: "10", price: "1361.20", amount: "13612.00", fees: "18.40" },
  { date: "2026-08-01", type: "DIVIDEND", symbol: "TATAMOTORS", qty: null, price: null, amount: "720.00", fees: "0" },
  { date: "2026-07-28", type: "DEPOSIT", symbol: null, qty: null, price: null, amount: "50000.00", fees: "0" },
  { date: "2026-07-21", type: "SELL", symbol: "BTC", qty: "0.01", price: "118900.00", amount: "1189.00", fees: "2.97" },
];

export const demoActiveTrades = [
  { symbol: "TATAMOTORS", direction: "LONG", pnl: "+4,120", r: "+0.8", status: "ACTIVE" },
  { symbol: "HDFCBANK", direction: "LONG", pnl: "-1,050", r: "-0.3", status: "ACTIVE" },
];

export const demoNews = [
  { headline: "RBI holds repo rate; commentary leans dovish", sentiment: "NEUTRAL", impact: "HIGH" },
  { headline: "IT majors guide higher on deal wins", sentiment: "POSITIVE", impact: "MEDIUM" },
  { headline: "Crude slips 2% on supply data", sentiment: "POSITIVE", impact: "MEDIUM" },
];

export const demoEvents = [
  { symbol: "INFY", event: "Earnings", when: "in 2 trading days", risk: "HIGH" },
  { symbol: "RELIANCE", event: "Dividend ex-date", when: "in 5 trading days", risk: "LOW" },
];
