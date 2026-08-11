import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Scanner read model (brief §51, §57). Every score is explainable:
 *  components + weights are stored with each ranking, never recomputed. */

export interface TradePlanRow {
  entry_low: string;
  entry_high: string;
  entry_mid: string;
  stop: string;
  t1: string;
  t2: string;
  rr1: string;
  rr2: string;
  risk_per_share: string | null;
  do_not_chase_above: string | null;
  structure_low: string | null;
  key_level: string | null;
  max_holding_days: number;
  entry_conditions: string[];
  exit_conditions: string[];
  invalidation: string[];
  sizing: Record<string, unknown>;
}

export interface StockRankingRow {
  id: string;
  rank: number;
  symbol: string;
  name: string;
  sector: string | null;
  sector_rank: number | null;
  price: string;
  atr: string | null;
  setup_type: "PULLBACK" | "BREAKOUT" | "MOMENTUM";
  score_total: string;
  score_tier: string;
  score_components: Record<string, number>;
  score_weights: Record<string, number>;
  why: string[];
  warnings: string[];
  rs_excess_nifty_20d: string | null;
  /** Factor-engine fields (migration 0009). Optional because the swing path
   *  does not select them — absent, not merely null, on those rows. */
  weight_pct?: string | null;
  momentum_pct?: string | null;
  vol_annual_pct?: string | null;
  hold_until?: string | null;
  trade_plans: TradePlanRow | null;
}

export interface ScanRunRow {
  id: string;
  run_date: string;
  engine: string;
  engine_version: string;
  universe: string;
  regime_label: string;
  regime_score: string;
  funnel: Record<string, number>;
  no_trade: boolean;
  no_trade_reason: string | null;
  near_misses: Array<{ symbol: string; reason: string }>;
  stock_rankings: StockRankingRow[];
}

/** Selection engines that publish into scan_runs. Reads MUST filter by engine:
 *  the swing screener and the momentum core share these tables, so an
 *  unfiltered "latest run" would show whichever published most recently. */
export const ENGINE_SWING = "swingscan";
export const ENGINE_MOMENTUM = "momentum";

const RANKING_BASE = `id, rank, symbol, name, sector, sector_rank, price, atr,
     setup_type, score_total, score_tier, score_components, score_weights,
     why, warnings, rs_excess_nifty_20d, trade_plans (*)`;

/** Columns added by migration 0009. Requested ONLY by the momentum path:
 *  asking for them on the swing path made the whole query fail with
 *  "column does not exist" until 0009 was applied, which silently hid live
 *  scan data behind a migration-pending placeholder. A new engine's schema
 *  must never be a dependency of an existing feature. */
const RANKING_FACTOR = `weight_pct, momentum_pct, vol_annual_pct, hold_until`;

function runSelect(withFactorCols: boolean): string {
  const cols = withFactorCols
    ? `${RANKING_BASE}, ${RANKING_FACTOR}`
    : RANKING_BASE;
  return `id, run_date, engine, engine_version, universe, regime_label,
   regime_score, funnel, no_trade, no_trade_reason, near_misses,
   stock_rankings ( ${cols} )`;
}

async function latestRunFor(
  sb: SupabaseClient,
  engine: string,
  withFactorCols: boolean
): Promise<ScanRunRow | null> {
  const { data, error } = await sb
    .from("scan_runs")
    .select(runSelect(withFactorCols))
    .eq("engine", engine)
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`scan(${engine}): ${error.message}`);
  if (!data) return null;
  const run = data as unknown as ScanRunRow;
  run.stock_rankings.sort((a, b) => a.rank - b.rank);
  return run;
}

/** Latest swing-scanner run (pullback/breakout timing engine).
 *  Deliberately does not request migration-0009 columns — see RANKING_FACTOR. */
export async function getLatestScan(
  sb: SupabaseClient
): Promise<ScanRunRow | null> {
  return latestRunFor(sb, ENGINE_SWING, false);
}

/** Latest momentum-core rebalance (cross-sectional factor engine).
 *  Requires migration 0009; the page surfaces that as a pending notice. */
export async function getLatestMomentum(
  sb: SupabaseClient
): Promise<ScanRunRow | null> {
  return latestRunFor(sb, ENGINE_MOMENTUM, true);
}

export interface SectorRankingRow {
  date: string;
  sector: string;
  rank: number;
  rs5: string | null;
  rs10: string | null;
  rs20: string | null;
  rs60: string | null;
  rs_blend: string | null;
  score: string | null;
}

export async function getLatestSectorRankings(
  sb: SupabaseClient
): Promise<SectorRankingRow[]> {
  const { data: latest, error: dErr } = await sb
    .from("sector_rankings")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dErr) throw new Error(`sector rankings: ${dErr.message}`);
  if (!latest) return [];
  const { data, error } = await sb
    .from("sector_rankings")
    .select("*")
    .eq("date", latest.date)
    .order("rank");
  if (error) throw new Error(`sector rankings: ${error.message}`);
  return data as SectorRankingRow[];
}

export interface RegimeRow {
  date: string;
  label: string;
  score: string;
  breadth_pct: string | null;
  vix: string | null;
  nifty_close: string | null;
}

export async function getLatestRegime(
  sb: SupabaseClient
): Promise<RegimeRow | null> {
  const { data, error } = await sb
    .from("market_regime_history")
    .select("date, label, score, breadth_pct, vix, nifty_close")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`regime: ${error.message}`);
  return data as RegimeRow | null;
}

/** Historical signals for one symbol (brief §57–58 groundwork). */
export async function getSymbolScanHistory(
  sb: SupabaseClient,
  symbol: string
): Promise<
  Array<{
    run_date: string;
    rank: number;
    setup_type: string;
    score_total: string;
    score_tier: string;
    trade_plans: TradePlanRow | null;
  }>
> {
  const { data, error } = await sb
    .from("stock_rankings")
    .select(
      "rank, setup_type, score_total, score_tier, trade_plans (*), scan_runs!inner (run_date)"
    )
    .eq("symbol", symbol.toUpperCase())
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`scan history: ${error.message}`);
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    run_date: (r.scan_runs as { run_date: string }).run_date,
    rank: r.rank as number,
    setup_type: r.setup_type as string,
    score_total: String(r.score_total),
    score_tier: r.score_tier as string,
    trade_plans: r.trade_plans as TradePlanRow | null,
  }));
}
