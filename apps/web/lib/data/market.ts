import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { quoteForAsset, TRACKED_INDICES } from "@tradeos/market-data";
import type { Currency, DataFreshness } from "@tradeos/types";

/**
 * Market data read/refresh layer (brief §75–76). Quotes are cached in
 * Postgres (market_quotes) and refreshed by the cron job / admin action —
 * pages read the cache, they never call providers per-request.
 */

export interface QuoteRow {
  asset_id: string | null;
  index_code: string | null;
  price: string;
  change_pct: string;
  as_of: string;
  provider: string;
  freshness: DataFreshness;
  market_indices: {
    name: string;
    currency: Currency;
    sort_order: number;
  } | null;
}

export async function getIndexQuotes(sb: SupabaseClient): Promise<QuoteRow[]> {
  const { data, error } = await sb
    .from("market_quotes")
    .select(
      "asset_id, index_code, price, change_pct, as_of, provider, freshness, market_indices (name, currency, sort_order)"
    )
    .not("index_code", "is", null);
  if (error) throw new Error(`market quotes: ${error.message}`);
  const rows = data as unknown as QuoteRow[];
  return rows.sort(
    (a, b) =>
      (a.market_indices?.sort_order ?? 999) - (b.market_indices?.sort_order ?? 999)
  );
}

export interface AssetQuote {
  price: string;
  changePct: string;
  asOf: string;
  freshness: DataFreshness;
  provider: string;
}

export async function getAssetQuotes(
  sb: SupabaseClient,
  assetIds: string[]
): Promise<Map<string, AssetQuote>> {
  if (assetIds.length === 0) return new Map();
  const { data, error } = await sb
    .from("market_quotes")
    .select("asset_id, price, change_pct, as_of, provider, freshness")
    .in("asset_id", assetIds);
  if (error) throw new Error(`asset quotes: ${error.message}`);
  const map = new Map<string, AssetQuote>();
  for (const r of data ?? []) {
    if (!r.asset_id) continue;
    map.set(r.asset_id, {
      price: String(r.price),
      changePct: String(r.change_pct),
      asOf: r.as_of,
      freshness: r.freshness,
      provider: r.provider,
    });
  }
  return map;
}

/** Downgrade freshness that has aged since the row was written. */
export function effectiveFreshness(q: AssetQuote): DataFreshness {
  const ageH = (Date.now() - new Date(q.asOf).getTime()) / 3_600_000;
  if (q.freshness === "RECENT" && ageH > 24) return "STALE";
  return q.freshness;
}

// ─────────────────────────────── refresh (cron job / admin action)

export interface RefreshResult {
  indices: number;
  assets: number;
  errors: string[];
}

export async function refreshMarketData(
  admin: SupabaseClient
): Promise<RefreshResult> {
  const errors: string[] = [];
  let indices = 0;
  let assets = 0;

  // 1. tracked indices
  for (const idx of TRACKED_INDICES) {
    try {
      const q = await quoteForAsset({
        symbol: idx.providerSymbol,
        assetClass: "GLOBAL_INDEX",
      });
      const { error } = await admin.from("market_quotes").upsert(
        {
          index_code: idx.code,
          asset_id: null,
          price: q.price,
          change_pct: q.changePct,
          as_of: q.asOf,
          provider: q.provider,
          freshness: q.freshness,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "index_code" }
      );
      if (error) throw new Error(error.message);
      indices++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // 2. every asset referenced by any transaction or trade (small personal set)
  const { data: assetRows, error: aErr } = await admin
    .from("assets")
    .select("id, symbol, asset_class")
    .eq("is_active", true);
  if (aErr) {
    errors.push(aErr.message);
  } else {
    for (const a of assetRows ?? []) {
      if (a.asset_class === "CASH" || a.asset_class === "OTHER") continue;
      try {
        const q = await quoteForAsset({
          symbol: a.symbol,
          assetClass: a.asset_class,
        });
        const { error } = await admin.from("market_quotes").upsert(
          {
            asset_id: a.id,
            index_code: null,
            price: q.price,
            change_pct: q.changePct,
            as_of: q.asOf,
            provider: q.provider,
            freshness: q.freshness,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "asset_id" }
        );
        if (error) throw new Error(error.message);
        assets++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  // 3. provider status (brief §84)
  await admin.from("data_provider_status").upsert({
    provider: "yahoo+coingecko",
    last_success_at: errors.length === 0 ? new Date().toISOString() : undefined,
    last_error: errors.length ? errors.slice(0, 3).join(" | ") : null,
    last_error_at: errors.length ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  });

  return { indices, assets, errors };
}
