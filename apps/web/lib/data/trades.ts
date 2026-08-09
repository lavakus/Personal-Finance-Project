import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  d,
  strategyStats,
  tradeRealizedPnl,
  tradeRMultiple,
  type StrategyStats,
} from "@tradeos/calculations";
import type { TradeDirection, TradeStatus } from "@tradeos/types";

/** Trades read model (brief §14–16). Realized P&L and R are DERIVED from
 *  entry + exits with decimal math — never stored, never hand-entered. */

export interface TradeExitRow {
  id: string;
  exit_price: string;
  quantity: string;
  fees: string;
  exit_date: string;
  exit_reason: string | null;
}

export interface TradeRow {
  id: string;
  direction: TradeDirection;
  status: TradeStatus;
  entry_price: string;
  quantity: string;
  stop_loss: string;
  target1: string | null;
  target2: string | null;
  setup: string | null;
  entry_date: string;
  reason: string | null;
  notes: string | null;
  assets: { symbol: string; name: string } | null;
  strategy_versions: {
    id: string;
    version: string;
    strategies: { name: string } | null;
  } | null;
  trade_exits: TradeExitRow[];
  trade_reviews: { trade_id: string } | null;
}

export interface TradeComputed {
  row: TradeRow;
  exitedQty: string;
  remainingQty: string;
  realizedPnl: string;
  realizedR: string;
  holdingDays: number;
}

export async function getTrades(sb: SupabaseClient): Promise<TradeComputed[]> {
  const { data, error } = await sb
    .from("trades")
    .select(
      `id, direction, status, entry_price, quantity, stop_loss, target1, target2,
       setup, entry_date, reason, notes,
       assets (symbol, name),
       strategy_versions (id, version, strategies (name)),
       trade_exits (id, exit_price, quantity, fees, exit_date, exit_reason),
       trade_reviews (trade_id)`
    )
    .order("entry_date", { ascending: false });
  if (error) throw new Error(`trades: ${error.message}`);

  return (data as unknown as TradeRow[]).map((row) => {
    const exits = row.trade_exits ?? [];
    const exitedQty = exits.reduce((a, e) => a.plus(d(e.quantity)), d(0));
    const pnl = tradeRealizedPnl({
      direction: row.direction,
      entryPrice: row.entry_price,
      exits: exits.map((e) => ({
        exitPrice: e.exit_price,
        quantity: e.quantity,
        fees: e.fees,
      })),
    });
    const r = tradeRMultiple({
      direction: row.direction,
      entryPrice: row.entry_price,
      stopLoss: row.stop_loss,
      exits: exits.map((e) => ({
        exitPrice: e.exit_price,
        quantity: e.quantity,
        fees: e.fees,
      })),
    });
    const lastExit = exits.map((e) => e.exit_date).sort().at(-1);
    const end = lastExit ? new Date(lastExit) : new Date();
    const holdingDays = Math.max(
      0,
      Math.round(
        (end.getTime() - new Date(row.entry_date).getTime()) / 86_400_000
      )
    );
    return {
      row,
      exitedQty: exitedQty.toString(),
      remainingQty: d(row.quantity).minus(exitedQty).toString(),
      realizedPnl: pnl.toString(),
      realizedR: r.toDecimalPlaces(2).toString(),
      holdingDays,
    };
  });
}

export interface StrategyRow {
  id: string;
  name: string;
  description: string | null;
  user_id: string | null;
  strategy_versions: Array<{ id: string; version: string; created_at: string }>;
}

export async function getStrategies(sb: SupabaseClient): Promise<StrategyRow[]> {
  const { data, error } = await sb
    .from("strategies")
    .select("id, name, description, user_id, strategy_versions (id, version, created_at)")
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(`strategies: ${error.message}`);
  return data as unknown as StrategyRow[];
}

/** Performance per strategy from CLOSED trades only (brief §56). */
export function strategyPerformance(
  trades: TradeComputed[]
): Map<string, { name: string; stats: StrategyStats }> {
  const grouped = new Map<string, { name: string; trades: TradeComputed[] }>();
  for (const t of trades) {
    if (t.row.status !== "CLOSED") continue;
    const name = t.row.strategy_versions
      ? `${t.row.strategy_versions.strategies?.name ?? "?"} v${t.row.strategy_versions.version}`
      : "No strategy";
    const g = grouped.get(name) ?? { name, trades: [] };
    g.trades.push(t);
    grouped.set(name, g);
  }
  const out = new Map<string, { name: string; stats: StrategyStats }>();
  for (const [name, g] of grouped) {
    out.set(name, {
      name,
      stats: strategyStats(
        g.trades.map((t) => ({
          netPnl: t.realizedPnl,
          r: t.realizedR,
          holdingDays: t.holdingDays,
        }))
      ),
    });
  }
  return out;
}
