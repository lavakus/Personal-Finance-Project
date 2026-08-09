import { NextResponse } from "next/server";

import type { DataFreshness, SystemHealth } from "@tradeos/types";

import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Age-based freshness (brief §76). Anything past `staleHours` is STALE,
 *  never quietly reported as healthy. */
function freshnessFrom(
  iso: string | null | undefined,
  staleHours: number
): DataFreshness {
  if (!iso) return "UNAVAILABLE";
  const ageH = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return ageH <= staleHours ? "RECENT" : "STALE";
}

/**
 * System health (brief §84). Every status is derived from real row
 * timestamps — nothing is ever faked green, and a missing table reports
 * UNAVAILABLE rather than erroring the endpoint.
 */
export async function GET() {
  if (isDemoMode) {
    const demo: SystemHealth = {
      database: false,
      marketData: "DEMO",
      news: "DEMO",
      scanner: "DEMO",
      cron: "DEMO",
      notifications: false,
      demoMode: true,
      checkedAt: new Date().toISOString(),
    };
    return NextResponse.json(demo);
  }

  let database = false;
  let marketData: DataFreshness = "UNAVAILABLE";
  let news: DataFreshness = "UNAVAILABLE";
  let scanner: DataFreshness = "UNAVAILABLE";
  let cron: DataFreshness = "UNAVAILABLE";
  let notifications = false;

  try {
    const sb = await createServerSupabase();
    const { error } = await sb.from("asset_classes").select("code").limit(1);
    database = !error;

    const [quotes, articles, scans, providers, notifs] = await Promise.all([
      sb.from("market_quotes").select("as_of").order("as_of", { ascending: false }).limit(1),
      sb.from("news_articles").select("published_at").order("published_at", { ascending: false }).limit(1),
      sb.from("scan_runs").select("created_at").order("created_at", { ascending: false }).limit(1),
      sb.from("data_provider_status").select("last_success_at").order("last_success_at", { ascending: false }).limit(1),
      sb.from("notifications").select("id").limit(1),
    ]);

    // Quotes/news refresh on demand; scans run once per trading day, so a
    // weekend-old scan is still healthy (72h covers Fri close → Mon open).
    if (!quotes.error) marketData = freshnessFrom(quotes.data?.[0]?.as_of, 30);
    if (!articles.error) news = freshnessFrom(articles.data?.[0]?.published_at, 12);
    if (!scans.error) scanner = freshnessFrom(scans.data?.[0]?.created_at, 72);
    if (!providers.error) cron = freshnessFrom(providers.data?.[0]?.last_success_at, 30);
    notifications = !notifs.error;
  } catch {
    // leave the honest defaults in place
  }

  const health: SystemHealth = {
    database,
    marketData,
    news,
    scanner,
    cron,
    notifications,
    demoMode: false,
    checkedAt: new Date().toISOString(),
  };
  return NextResponse.json(health);
}
