/**
 * @tradeos/types — shared zod schemas + TypeScript types.
 *
 * One schema definition = runtime validation (API boundaries) + static types
 * (web, mobile, jobs). Enums mirror the Postgres enum types 1:1; if you
 * change one side, change the other in the same commit.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────── enums

export const Role = z.enum(["ADMIN", "USER"]);
export type Role = z.infer<typeof Role>;

export const Currency = z.enum(["INR", "OMR", "USD"]);
export type Currency = z.infer<typeof Currency>;

export const AssetClass = z.enum([
  "EQUITY_IN",
  "CRYPTO",
  "GOLD",
  "CASH",
  "GLOBAL_INDEX",
  "OTHER",
]);
export type AssetClass = z.infer<typeof AssetClass>;

export const TransactionType = z.enum([
  "BUY",
  "SELL",
  "DEPOSIT",
  "WITHDRAWAL",
  "DIVIDEND",
  "FEE",
  "TRANSFER",
]);
export type TransactionType = z.infer<typeof TransactionType>;

export const TradeStatus = z.enum([
  "PLANNED",
  "ACTIVE",
  "PARTIALLY_CLOSED",
  "CLOSED",
  "CANCELLED",
  "INVALIDATED",
]);
export type TradeStatus = z.infer<typeof TradeStatus>;

export const TradeDirection = z.enum(["LONG", "SHORT"]);
export type TradeDirection = z.infer<typeof TradeDirection>;

export const MarketRegime = z.enum([
  "STRONG_BULLISH",
  "BULLISH",
  "NEUTRAL",
  "WEAK",
  "BEARISH",
  "STRONG_BEARISH",
]);
export type MarketRegime = z.infer<typeof MarketRegime>;

export const SetupType = z.enum(["PULLBACK", "BREAKOUT"]);
export type SetupType = z.infer<typeof SetupType>;

export const DataFreshness = z.enum([
  "LIVE",
  "RECENT",
  "STALE",
  "DEMO",
  "UNAVAILABLE",
]);
export type DataFreshness = z.infer<typeof DataFreshness>;

export const Sentiment = z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]);
export type Sentiment = z.infer<typeof Sentiment>;

export const Impact = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type Impact = z.infer<typeof Impact>;

export const AlertType = z.enum([
  "PRICE",
  "SETUP",
  "BREAKOUT",
  "PULLBACK",
  "TARGET",
  "STOP",
  "NEWS",
  "EVENT",
  "EARNINGS",
  "PORTFOLIO",
  "BOT",
  "DATA",
]);
export type AlertType = z.infer<typeof AlertType>;

// ───────────────────────────────────────────────────── core entities
// Money/quantity travel as strings (Postgres numeric) — parse with
// decimal.js in @tradeos/calculations, never with parseFloat for math.

export const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "decimal string expected");

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(80),
  role: Role,
  baseCurrency: Currency,
  createdAt: z.string(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const AssetSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string().min(1).max(32),
  name: z.string(),
  assetClass: AssetClass,
  exchange: z.string().nullable(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  currency: Currency,
  isActive: z.boolean(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const TransactionInputSchema = z
  .object({
    accountId: z.string().uuid(),
    assetId: z.string().uuid().nullable().default(null),
    type: TransactionType,
    quantity: decimalString.nullable().default(null),
    price: decimalString.nullable().default(null),
    // For BUY/SELL the server derives amount = quantity × price (decimal);
    // for cash types the client supplies it.
    amount: decimalString.optional(),
    currency: Currency,
    fees: decimalString.default("0"),
    executedAt: z.string(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((t, ctx) => {
    const isTrade = t.type === "BUY" || t.type === "SELL";
    if (isTrade && (!t.quantity || !t.price)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${t.type} requires quantity and price`,
      });
    }
    if (["BUY", "SELL", "DIVIDEND"].includes(t.type) && !t.assetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${t.type} requires an asset`,
      });
    }
    if (!isTrade && !t.amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${t.type} requires an amount`,
      });
    }
  });
export type TransactionInput = z.infer<typeof TransactionInputSchema>;

export const PortfolioAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  currency: Currency,
  isDefault: z.boolean(),
});
export type PortfolioAccount = z.infer<typeof PortfolioAccountSchema>;

export const AccountInputSchema = z.object({
  name: z.string().min(1).max(80),
  currency: Currency.default("INR"),
});
export type AccountInput = z.infer<typeof AccountInputSchema>;

// A derived holding — computed from the transaction ledger, never stored.
// Price fields are null until market data exists (no fabrication, brief §90).
export const HoldingSchema = z.object({
  assetId: z.string().uuid(),
  symbol: z.string(),
  name: z.string(),
  assetClass: AssetClass,
  currency: Currency,
  quantity: decimalString,
  averageCost: decimalString,
  investedValue: decimalString,
  realizedPnl: decimalString,
  currentPrice: decimalString.nullable(),
  currentValue: decimalString.nullable(),
  unrealizedPnl: decimalString.nullable(),
  returnPct: decimalString.nullable(),
  allocationPct: decimalString.nullable(),
  priceFreshness: DataFreshness,
});
export type Holding = z.infer<typeof HoldingSchema>;

export const PortfolioSummarySchema = z.object({
  invested: decimalString,
  currentValue: decimalString.nullable(),
  realizedPnl: decimalString,
  unrealizedPnl: decimalString.nullable(),
  returnPct: decimalString.nullable(),
  cashByAccount: z.array(
    z.object({
      accountId: z.string().uuid(),
      accountName: z.string(),
      currency: Currency,
      balance: decimalString,
    })
  ),
  holdings: z.array(HoldingSchema),
  asOf: z.string(),
});
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

export const AssetInputSchema = z.object({
  symbol: z.string().min(1).max(32).transform((s) => s.toUpperCase().trim()),
  name: z.string().min(1).max(120),
  assetClass: AssetClass,
  currency: Currency.default("INR"),
});
export type AssetInput = z.infer<typeof AssetInputSchema>;

export const TradeInputSchema = z.object({
  symbol: z.string().min(1),
  assetClass: AssetClass,
  direction: TradeDirection,
  entryPrice: decimalString,
  quantity: decimalString,
  stopLoss: decimalString,
  target1: decimalString.nullable(),
  target2: decimalString.nullable(),
  strategyVersionId: z.string().uuid().nullable(),
  setup: SetupType.nullable(),
  entryDate: z.string(),
  reason: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
});
export type TradeInput = z.infer<typeof TradeInputSchema>;

export const OHLCVBarSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});
export type OHLCVBar = z.infer<typeof OHLCVBarSchema>;

export const QuoteSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  changePct: z.number(),
  asOf: z.string(),
  freshness: DataFreshness,
  provider: z.string(),
});
export type Quote = z.infer<typeof QuoteSchema>;

// Explainable score breakdown (brief §3): components always shown.
export const ScoreBreakdownSchema = z.object({
  components: z.record(z.string(), z.number()),
  weights: z.record(z.string(), z.number()),
  total: z.number().min(0).max(100),
  tier: z.string(),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export const TradePlanSchema = z.object({
  symbol: z.string(),
  setup: SetupType,
  entryLow: z.number(),
  entryHigh: z.number(),
  stopLoss: z.number(),
  target1: z.number(),
  target2: z.number(),
  rr1: z.number(),
  rr2: z.number(),
  maxHoldingDays: z.number().int(),
  invalidation: z.array(z.string()),
  earlyExitConditions: z.array(z.string()),
  doNotChaseAbove: z.number().nullable(),
  score: ScoreBreakdownSchema,
  why: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type TradePlan = z.infer<typeof TradePlanSchema>;

export const SystemHealthSchema = z.object({
  database: z.boolean(),
  marketData: DataFreshness,
  news: DataFreshness,
  scanner: DataFreshness,
  cron: DataFreshness,
  notifications: z.boolean(),
  demoMode: z.boolean(),
  checkedAt: z.string(),
});
export type SystemHealth = z.infer<typeof SystemHealthSchema>;
