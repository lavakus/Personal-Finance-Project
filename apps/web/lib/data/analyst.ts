import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getIndexQuotes } from "./market";
import { getPortfolioSummary } from "./portfolio";
import { getLatestRegime, getLatestScan, getLatestSectorRankings } from "./scanner";
import { getTrades, strategyPerformance } from "./trades";

/**
 * AI analyst data layer (brief §61–62). The assistant receives ONLY this
 * verified structured snapshot — every number comes from the database.
 * AI explains and summarizes; it never computes or invents values
 * (brief rule 17: AI is not responsible for financial calculations).
 */

export interface AnalystSnapshot {
  asOf: string;
  regime: { label: string; score: number; breadth: number | null; vix: number | null } | null;
  indices: Array<{ name: string; price: number; changePct: number; freshness: string }>;
  sectors: { top: Array<{ sector: string; rank: number; rs20: number | null }>; bottom: Array<{ sector: string; rank: number; rs20: number | null }> };
  scan: {
    date: string;
    noTrade: boolean;
    noTradeReason: string | null;
    setups: Array<{ symbol: string; setup: string; score: number; tier: string; rr1: number | null; warnings: string[] }>;
  } | null;
  portfolio: {
    invested: string;
    currentValue: string | null;
    realizedPnl: string;
    unrealizedPnl: string | null;
    holdings: Array<{ symbol: string; assetClass: string; allocationPct: string | null; unrealizedPnl: string | null }>;
  };
  openTrades: Array<{ symbol: string; direction: string; status: string; entryDate: string; holdingDays: number }>;
  strategyStats: Array<{ name: string; trades: number; winRatePct: number; profitFactor: number; expectancy: number }>;
  earningsSoon: Array<{ symbol: string; date: string }>;
}

export async function gatherAnalystSnapshot(sb: SupabaseClient): Promise<AnalystSnapshot> {
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  const [regime, indices, sectors, scan, portfolio, trades, earnings] =
    await Promise.all([
      safe(() => getLatestRegime(sb), null),
      safe(() => getIndexQuotes(sb), []),
      safe(() => getLatestSectorRankings(sb), []),
      safe(() => getLatestScan(sb), null),
      getPortfolioSummary(sb),
      safe(() => getTrades(sb), []),
      safe(async () => {
        const { data } = await sb
          .from("earnings_events")
          .select("symbol, earnings_date")
          .gte("earnings_date", new Date().toISOString().slice(0, 10))
          .lte("earnings_date", new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10));
        return data ?? [];
      }, []),
    ]);

  const perf = strategyPerformance(trades);

  return {
    asOf: new Date().toISOString(),
    regime: regime
      ? {
          label: regime.label,
          score: Number(regime.score),
          breadth: regime.breadth_pct !== null ? Number(regime.breadth_pct) : null,
          vix: regime.vix !== null ? Number(regime.vix) : null,
        }
      : null,
    indices: indices.map((q) => ({
      name: q.market_indices?.name ?? q.index_code ?? "?",
      price: Number(q.price),
      changePct: Number(q.change_pct),
      freshness: q.freshness,
    })),
    sectors: {
      top: sectors.slice(0, 5).map((s) => ({
        sector: s.sector,
        rank: s.rank,
        rs20: s.rs20 !== null ? Number(s.rs20) : null,
      })),
      bottom: sectors.slice(-3).map((s) => ({
        sector: s.sector,
        rank: s.rank,
        rs20: s.rs20 !== null ? Number(s.rs20) : null,
      })),
    },
    scan: scan
      ? {
          date: scan.run_date,
          noTrade: scan.no_trade,
          noTradeReason: scan.no_trade_reason,
          setups: scan.stock_rankings.slice(0, 5).map((s) => ({
            symbol: s.symbol,
            setup: s.setup_type,
            score: Number(s.score_total),
            tier: s.score_tier,
            rr1: s.trade_plans ? Number(s.trade_plans.rr1) : null,
            warnings: s.warnings ?? [],
          })),
        }
      : null,
    portfolio: {
      invested: portfolio.invested,
      currentValue: portfolio.currentValue,
      realizedPnl: portfolio.realizedPnl,
      unrealizedPnl: portfolio.unrealizedPnl,
      holdings: portfolio.holdings
        .filter((h) => Number(h.quantity) > 0)
        .map((h) => ({
          symbol: h.symbol,
          assetClass: h.assetClass,
          allocationPct: h.allocationPct,
          unrealizedPnl: h.unrealizedPnl,
        })),
    },
    openTrades: trades
      .filter((t) => ["ACTIVE", "PARTIALLY_CLOSED"].includes(t.row.status))
      .map((t) => ({
        symbol: t.row.assets?.symbol ?? "?",
        direction: t.row.direction,
        status: t.row.status,
        entryDate: t.row.entry_date,
        holdingDays: t.holdingDays,
      })),
    strategyStats: [...perf.values()].map(({ name, stats }) => ({
      name,
      trades: stats.trades,
      winRatePct: Number(stats.winRate.toFixed(0)),
      profitFactor: Number(stats.profitFactor.toFixed(2)),
      expectancy: Number(stats.expectancy.toFixed(0)),
    })),
    earningsSoon: earnings.map((e: { symbol: string; earnings_date: string }) => ({
      symbol: e.symbol,
      date: e.earnings_date,
    })),
  };
}

export const ANALYST_SYSTEM_PROMPT = `You are the market analyst inside TradeOS, a personal Indian-market trading terminal. You receive a JSON snapshot of VERIFIED data: market regime, cached index quotes, sector rankings, the latest scanner run, the user's portfolio, open trades, per-strategy statistics, and upcoming earnings.

Rules you must never break:
- Use ONLY numbers present in the snapshot. Never invent, estimate, or extrapolate prices, returns, or statistics. If something is missing, say "no data".
- You are an analyst, not an advisor: describe what the data shows and what risks stand out. Never instruct the user to buy or sell, never promise outcomes, and label everything as analysis.
- NO TRADE days are healthy — never pressure toward action.
- Quote freshness honestly: this platform uses delayed free-tier data.

Write a concise market & portfolio briefing with short sections: MARKET, SECTORS, SETUPS, PORTFOLIO, RISKS, CONCLUSION. Plain text, no markdown headers beyond simple uppercase labels, under 350 words.`;
