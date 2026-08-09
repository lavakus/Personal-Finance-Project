import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  allocationPct,
  cashBalance,
  d,
  returnPct,
  unrealizedPnl,
  walkLedger,
  type CashTxnType,
  type LedgerLot,
} from "@tradeos/calculations";
import type {
  AssetClass,
  Currency,
  Holding,
  PortfolioAccount,
  PortfolioSummary,
} from "@tradeos/types";

import { effectiveFreshness, getAssetQuotes, type AssetQuote } from "./market";

const GRAMS_PER_TROY_OUNCE = "31.1034768";

/**
 * Convert a provider quote to INR for valuation. Explicit, documented
 * conversions only — anything unmappable stays unpriced (brief §90):
 *  - EQUITY_IN: already INR
 *  - CRYPTO: USD quote × USD/INR
 *  - GOLD: COMEX USD/troy-oz → INR per gram (assumes gold quantity is grams)
 */
export function quoteToINR(params: {
  assetClass: AssetClass;
  quotePrice: string;
  usdInr: string | null;
}): ReturnType<typeof d> | null {
  const { assetClass, quotePrice, usdInr } = params;
  if (assetClass === "EQUITY_IN") return d(quotePrice);
  if (assetClass === "CRYPTO") {
    return usdInr ? d(quotePrice).times(d(usdInr)) : null;
  }
  if (assetClass === "GOLD") {
    return usdInr
      ? d(quotePrice).div(d(GRAMS_PER_TROY_OUNCE)).times(d(usdInr))
      : null;
  }
  return null;
}

/**
 * Portfolio read model (brief §10–11). Holdings are DERIVED here from the
 * transaction ledger via walkLedger — the database never stores them.
 * Price-dependent fields stay null until Phase 4 market data exists:
 * "Data unavailable" beats a fabricated number (brief §90).
 */

export interface TransactionRow {
  id: string;
  account_id: string;
  asset_id: string | null;
  type: CashTxnType;
  quantity: string | null;
  price: string | null;
  amount: string;
  currency: Currency;
  fees: string;
  executed_at: string;
  notes: string | null;
  assets: {
    symbol: string;
    name: string;
    asset_class: AssetClass;
    currency: Currency;
  } | null;
}

export interface AccountRow {
  id: string;
  name: string;
  currency: Currency;
  is_default: boolean;
}

export async function getAccounts(
  sb: SupabaseClient
): Promise<PortfolioAccount[]> {
  const { data, error } = await sb
    .from("portfolio_accounts")
    .select("id, name, currency, is_default")
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw new Error(`accounts: ${error.message}`);
  return (data as AccountRow[]).map((a) => ({
    id: a.id,
    name: a.name,
    currency: a.currency,
    isDefault: a.is_default,
  }));
}

export async function getTransactions(
  sb: SupabaseClient,
  opts: { limit?: number } = {}
): Promise<TransactionRow[]> {
  const { data, error } = await sb
    .from("transactions")
    .select(
      "id, account_id, asset_id, type, quantity, price, amount, currency, fees, executed_at, notes, assets (symbol, name, asset_class, currency)"
    )
    .order("executed_at", { ascending: true })
    .limit(opts.limit ?? 5000);
  if (error) throw new Error(`transactions: ${error.message}`);
  return data as unknown as TransactionRow[];
}

export function computePortfolio(
  accounts: PortfolioAccount[],
  txns: TransactionRow[],
  pricing?: { quotes: Map<string, AssetQuote>; usdInr: string | null }
): PortfolioSummary {
  // holdings: walk BUY/SELL per asset in executed_at order
  const byAsset = new Map<string, TransactionRow[]>();
  for (const t of txns) {
    if (t.asset_id && (t.type === "BUY" || t.type === "SELL")) {
      const list = byAsset.get(t.asset_id) ?? [];
      list.push(t);
      byAsset.set(t.asset_id, list);
    }
  }

  const holdings: Holding[] = [];
  let invested = d(0);
  let realized = d(0);

  for (const [assetId, list] of byAsset) {
    const lots: LedgerLot[] = list.map((t) => ({
      type: t.type as "BUY" | "SELL",
      quantity: t.quantity ?? "0",
      price: t.price ?? "0",
      fees: t.fees,
    }));
    const state = walkLedger(lots);
    invested = invested.plus(state.investedValue);
    realized = realized.plus(state.realizedPnl);
    const meta = list[0]?.assets ?? null;
    if (state.quantity.isZero() && state.realizedPnl.isZero()) continue;

    // valuation from the quote cache — absent quote = UNAVAILABLE, never a guess
    const assetClass = meta?.asset_class ?? "OTHER";
    const quote = pricing?.quotes.get(assetId);
    const priceINR =
      quote && !state.quantity.isZero()
        ? quoteToINR({
            assetClass,
            quotePrice: quote.price,
            usdInr: pricing?.usdInr ?? null,
          })
        : null;
    const currentValue = priceINR ? state.quantity.times(priceINR) : null;

    holdings.push({
      assetId,
      symbol: meta?.symbol ?? "?",
      name: meta?.name ?? "Unknown asset",
      assetClass,
      currency: meta?.currency ?? "INR",
      quantity: state.quantity.toString(),
      averageCost: state.averageCost.toString(),
      investedValue: state.investedValue.toString(),
      realizedPnl: state.realizedPnl.toString(),
      currentPrice: priceINR ? priceINR.toDecimalPlaces(2).toString() : null,
      currentValue: currentValue ? currentValue.toDecimalPlaces(2).toString() : null,
      unrealizedPnl: priceINR
        ? unrealizedPnl(state, priceINR).toDecimalPlaces(2).toString()
        : null,
      returnPct:
        currentValue && !state.investedValue.isZero()
          ? returnPct(state.investedValue, currentValue).toDecimalPlaces(2).toString()
          : null,
      allocationPct: null, // filled below once the priced total is known
      priceFreshness: quote ? effectiveFreshness(quote) : "UNAVAILABLE",
    });
  }
  holdings.sort((a, b) => Number(d(b.investedValue).minus(a.investedValue)));

  // allocation over priced holdings (brief §10)
  const pricedTotal = holdings.reduce(
    (a, h) => (h.currentValue ? a.plus(d(h.currentValue)) : a),
    d(0)
  );
  if (!pricedTotal.isZero()) {
    for (const h of holdings) {
      if (h.currentValue) {
        h.allocationPct = allocationPct(h.currentValue, pricedTotal)
          .toDecimalPlaces(2)
          .toString();
      }
    }
  }

  // cash per account from the full ledger
  const cashByAccount = accounts.map((acc) => {
    const accTxns = txns
      .filter((t) => t.account_id === acc.id)
      .map((t) => ({ type: t.type, amount: t.amount, fees: t.fees }));
    return {
      accountId: acc.id,
      accountName: acc.name,
      currency: acc.currency,
      balance: cashBalance(accTxns).toString(),
    };
  });

  // totals: only meaningful when EVERY open holding has a price — partial
  // sums are shown per-holding, never presented as "the" portfolio value.
  const openHoldings = holdings.filter((h) => !d(h.quantity).isZero());
  const allPriced =
    openHoldings.length > 0 && openHoldings.every((h) => h.currentValue !== null);
  const investedOpen = openHoldings.reduce((a, h) => a.plus(d(h.investedValue)), d(0));
  const currentTotal = allPriced
    ? openHoldings.reduce((a, h) => a.plus(d(h.currentValue as string)), d(0))
    : null;
  const unrealizedTotal = allPriced
    ? openHoldings.reduce((a, h) => a.plus(d(h.unrealizedPnl as string)), d(0))
    : null;

  return {
    invested: invested.toString(),
    currentValue: currentTotal ? currentTotal.toDecimalPlaces(2).toString() : null,
    realizedPnl: realized.toString(),
    unrealizedPnl: unrealizedTotal
      ? unrealizedTotal.toDecimalPlaces(2).toString()
      : null,
    returnPct:
      currentTotal && !investedOpen.isZero()
        ? returnPct(investedOpen, currentTotal).toDecimalPlaces(2).toString()
        : null,
    cashByAccount,
    holdings,
    asOf: new Date().toISOString(),
  };
}

export async function getPortfolioSummary(
  sb: SupabaseClient
): Promise<PortfolioSummary> {
  const [accounts, txns] = await Promise.all([
    getAccounts(sb),
    getTransactions(sb),
  ]);

  // quote cache lookups (never a provider call in the request path)
  let pricing: { quotes: Map<string, AssetQuote>; usdInr: string | null } | undefined;
  try {
    const assetIds = [
      ...new Set(txns.filter((t) => t.asset_id).map((t) => t.asset_id as string)),
    ];
    const quotes = await getAssetQuotes(sb, assetIds);
    const { data: fx } = await sb
      .from("market_quotes")
      .select("price")
      .eq("index_code", "USDINR")
      .maybeSingle();
    pricing = { quotes, usdInr: fx ? String(fx.price) : null };
  } catch {
    // market_quotes missing (0004 pending) — valuation stays UNAVAILABLE
    pricing = undefined;
  }

  return computePortfolio(accounts, txns, pricing);
}

/** True when the error is Postgres "relation does not exist" — i.e. the
 *  migration that creates the table has not been applied yet. */
export function isMigrationPending(e: unknown): boolean {
  return e instanceof Error && /does not exist|42P01/i.test(e.message);
}
