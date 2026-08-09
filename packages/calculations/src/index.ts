/**
 * @tradeos/calculations — decimal-precise financial math (brief §88).
 *
 * Every function accepts decimal strings or Decimal instances — NEVER pass
 * floats that came from arithmetic. Returned values are Decimal; call
 * `.toFixed(n)` at display boundaries only.
 *
 * These functions are the single source of truth for money math on web,
 * mobile and API. Do not re-implement any of this in a component.
 */

import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Dec = Decimal.Value;
export const d = (v: Dec): Decimal => new Decimal(v);

// ───────────────────────────────────────────── position sizing (§32)

export interface PositionSizeResult {
  maxRisk: Decimal;
  riskPerShare: Decimal;
  quantity: Decimal;      // whole units, floored
  capitalRequired: Decimal;
}

export function positionSize(params: {
  accountSize: Dec;
  riskPct: Dec;          // e.g. 1 for 1%
  entry: Dec;
  stopLoss: Dec;
}): PositionSizeResult {
  const entry = d(params.entry);
  const stop = d(params.stopLoss);
  const riskPerShare = entry.minus(stop).abs();
  const maxRisk = d(params.accountSize).times(d(params.riskPct).div(100));
  const quantity = riskPerShare.isZero()
    ? d(0)
    : maxRisk.div(riskPerShare).floor();
  return {
    maxRisk,
    riskPerShare,
    quantity,
    capitalRequired: quantity.times(entry),
  };
}

// ───────────────────────────────────────────────────── R multiple

/** Realized R: signed P&L per unit divided by initial risk per unit. */
export function rMultiple(params: {
  direction: "LONG" | "SHORT";
  entry: Dec;
  exit: Dec;
  stopLoss: Dec;
}): Decimal {
  const entry = d(params.entry);
  const exit = d(params.exit);
  const risk = entry.minus(d(params.stopLoss)).abs();
  if (risk.isZero()) return d(0);
  const pnlPerUnit =
    params.direction === "LONG" ? exit.minus(entry) : entry.minus(exit);
  return pnlPerUnit.div(risk);
}

export function riskReward(params: {
  entry: Dec;
  stopLoss: Dec;
  target: Dec;
}): Decimal {
  const entry = d(params.entry);
  const risk = entry.minus(d(params.stopLoss)).abs();
  if (risk.isZero()) return d(0);
  return d(params.target).minus(entry).abs().div(risk);
}

// ─────────────────────────────────────── average cost & realized P&L
// Weighted-average-cost ledger walk (the standard for Indian delivery
// equity accounting). SELL reduces quantity at average cost and books
// realized P&L; BUY re-weights the average.

export interface LedgerLot {
  type: "BUY" | "SELL";
  quantity: Dec;
  price: Dec;
  fees?: Dec;
}

export interface HoldingState {
  quantity: Decimal;
  averageCost: Decimal;   // per unit, fees on buys capitalized
  investedValue: Decimal; // quantity * averageCost
  realizedPnl: Decimal;   // net of fees on sells
}

export function walkLedger(lots: LedgerLot[]): HoldingState {
  let qty = d(0);
  let avg = d(0);
  let realized = d(0);

  for (const lot of lots) {
    const q = d(lot.quantity);
    const price = d(lot.price);
    const fees = d(lot.fees ?? 0);
    if (q.lte(0)) throw new Error("lot quantity must be positive");

    if (lot.type === "BUY") {
      const newCost = qty.times(avg).plus(q.times(price)).plus(fees);
      qty = qty.plus(q);
      avg = qty.isZero() ? d(0) : newCost.div(qty);
    } else {
      if (q.gt(qty)) throw new Error("sell quantity exceeds holding");
      realized = realized.plus(price.minus(avg).times(q)).minus(fees);
      qty = qty.minus(q);
      if (qty.isZero()) avg = d(0);
    }
  }
  return {
    quantity: qty,
    averageCost: avg,
    investedValue: qty.times(avg),
    realizedPnl: realized,
  };
}

export function unrealizedPnl(state: HoldingState, currentPrice: Dec): Decimal {
  return d(currentPrice).minus(state.averageCost).times(state.quantity);
}

export function returnPct(invested: Dec, currentValue: Dec): Decimal {
  const inv = d(invested);
  if (inv.isZero()) return d(0);
  return d(currentValue).minus(inv).div(inv).times(100);
}

// ───────────────────────────────────────────────── cash ledger (§11)
// Signed cash impact of a transaction on its account. Convention:
// `amount` is always the gross positive value; direction comes from type.
// TRANSFER is the outgoing side — the receiving account records DEPOSIT.

export type CashTxnType =
  | "BUY" | "SELL" | "DEPOSIT" | "WITHDRAWAL" | "DIVIDEND" | "FEE" | "TRANSFER";

export function cashDelta(txn: {
  type: CashTxnType;
  amount: Dec;
  fees?: Dec;
}): Decimal {
  const amount = d(txn.amount);
  const fees = d(txn.fees ?? 0);
  switch (txn.type) {
    case "DEPOSIT":    return amount;
    case "WITHDRAWAL": return amount.neg();
    case "BUY":        return amount.plus(fees).neg();
    case "SELL":       return amount.minus(fees);
    case "DIVIDEND":   return amount.minus(fees);
    case "FEE":        return amount.neg();
    case "TRANSFER":   return amount.plus(fees).neg();
  }
}

export function cashBalance(
  txns: Array<{ type: CashTxnType; amount: Dec; fees?: Dec }>
): Decimal {
  return txns.reduce((acc, t) => acc.plus(cashDelta(t)), d(0));
}

// ─────────────────────────────────────────────────────── CAGR (§13)

export function cagr(params: {
  begin: Dec;
  end: Dec;
  days: number;
}): Decimal {
  const begin = d(params.begin);
  if (begin.lte(0) || params.days <= 0) return d(0);
  const years = params.days / 365.25;
  const ratio = d(params.end).div(begin);
  if (ratio.lte(0)) return d(-100);
  // Decimal.pow supports fractional exponents
  return ratio.pow(d(1).div(years)).minus(1).times(100);
}

// ──────────────────────────────────────────────────── allocation (§10)

export function allocationPct(partValue: Dec, totalValue: Dec): Decimal {
  const total = d(totalValue);
  if (total.isZero()) return d(0);
  return d(partValue).div(total).times(100);
}

// ──────────────────────────────────── trade P&L with partial exits (§15)

export interface TradeExitLot {
  exitPrice: Dec;
  quantity: Dec;
  fees?: Dec;
}

/** Realized P&L across all (partial) exits, net of exit fees. */
export function tradeRealizedPnl(params: {
  direction: "LONG" | "SHORT";
  entryPrice: Dec;
  exits: TradeExitLot[];
}): Decimal {
  const entry = d(params.entryPrice);
  return params.exits.reduce((acc, e) => {
    const perUnit =
      params.direction === "LONG"
        ? d(e.exitPrice).minus(entry)
        : entry.minus(d(e.exitPrice));
    return acc.plus(perUnit.times(d(e.quantity))).minus(d(e.fees ?? 0));
  }, d(0));
}

/** Quantity-weighted R multiple across partial exits. */
export function tradeRMultiple(params: {
  direction: "LONG" | "SHORT";
  entryPrice: Dec;
  stopLoss: Dec;
  exits: TradeExitLot[];
}): Decimal {
  const entry = d(params.entryPrice);
  const risk = entry.minus(d(params.stopLoss)).abs();
  if (risk.isZero()) return d(0);
  const totalQty = params.exits.reduce((a, e) => a.plus(d(e.quantity)), d(0));
  if (totalQty.isZero()) return d(0);
  const pnl = tradeRealizedPnl(params);
  return pnl.div(totalQty).div(risk);
}

// ─────────────────────────────────────────── trade stats (§56 basis)

export interface TradeStat {
  netPnl: Dec;
  r: Dec;
  holdingDays: number;
}

export interface StrategyStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: Decimal;        // 0..100
  avgWinner: Decimal;
  avgLoser: Decimal;
  profitFactor: Decimal;   // Infinity-safe: capped at 999
  expectancy: Decimal;     // mean net P&L
  avgR: Decimal;
  avgHoldingDays: Decimal;
}

export function strategyStats(trades: TradeStat[]): StrategyStats {
  const n = trades.length;
  const zero = {
    trades: 0, wins: 0, losses: 0,
    winRate: d(0), avgWinner: d(0), avgLoser: d(0),
    profitFactor: d(0), expectancy: d(0), avgR: d(0), avgHoldingDays: d(0),
  };
  if (n === 0) return zero;

  const pnls = trades.map((t) => d(t.netPnl));
  const winners = pnls.filter((p) => p.gt(0));
  const losers = pnls.filter((p) => p.lte(0));
  const grossWin = winners.reduce((a, b) => a.plus(b), d(0));
  const grossLoss = losers.reduce((a, b) => a.plus(b), d(0)).abs();
  const sum = pnls.reduce((a, b) => a.plus(b), d(0));
  const sumR = trades.reduce((a, t) => a.plus(d(t.r)), d(0));
  const sumHold = trades.reduce((a, t) => a + t.holdingDays, 0);

  return {
    trades: n,
    wins: winners.length,
    losses: losers.length,
    winRate: d(winners.length).div(n).times(100),
    avgWinner: winners.length ? grossWin.div(winners.length) : d(0),
    avgLoser: losers.length
      ? losers.reduce((a, b) => a.plus(b), d(0)).div(losers.length)
      : d(0),
    profitFactor: grossLoss.isZero()
      ? (grossWin.isZero() ? d(0) : d(999))
      : Decimal.min(grossWin.div(grossLoss), d(999)),
    expectancy: sum.div(n),
    avgR: sumR.div(n),
    avgHoldingDays: d(sumHold).div(n),
  };
}
