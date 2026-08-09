import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cashBalance,
  d,
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
  txns: TransactionRow[]
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
    holdings.push({
      assetId,
      symbol: meta?.symbol ?? "?",
      name: meta?.name ?? "Unknown asset",
      assetClass: meta?.asset_class ?? "OTHER",
      currency: meta?.currency ?? "INR",
      quantity: state.quantity.toString(),
      averageCost: state.averageCost.toString(),
      investedValue: state.investedValue.toString(),
      realizedPnl: state.realizedPnl.toString(),
      // Phase 4 wires prices; until then: unavailable, never fabricated.
      currentPrice: null,
      currentValue: null,
      unrealizedPnl: null,
      returnPct: null,
      allocationPct: null,
      priceFreshness: "UNAVAILABLE",
    });
  }
  holdings.sort((a, b) => Number(d(b.investedValue).minus(a.investedValue)));

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

  return {
    invested: invested.toString(),
    currentValue: null,
    realizedPnl: realized.toString(),
    unrealizedPnl: null,
    returnPct: null,
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
  return computePortfolio(accounts, txns);
}

/** True when the error is Postgres "relation does not exist" — i.e. the
 *  migration that creates the table has not been applied yet. */
export function isMigrationPending(e: unknown): boolean {
  return e instanceof Error && /does not exist|42P01/i.test(e.message);
}
