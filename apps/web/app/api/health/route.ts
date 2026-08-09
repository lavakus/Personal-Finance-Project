import { NextResponse } from "next/server";

import type { DataFreshness, SystemHealth } from "@tradeos/types";

import { isDemoMode } from "@/lib/env";
import { createAdminSupabase } from "@/lib/supabase/admin";

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
 * System health (brief §84). Reports only aggregate freshness — no user
 * data ever leaves this endpoint — so it doubles as an uptime probe.
 *
 * It reads through the service-role client on purpose: the anon client is
 * subject to RLS, which returns ZERO ROWS (not an error) to an unauthenticated
 * caller, making every check look simultaneously "connected" and "no data".
 * Row COUNTS are used instead of row contents, so nothing readable is
 * returned even for the per-user notifications table.
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
    const admin = createAdminSupabase();

    // Connectivity: a seeded reference table must return at least one row.
    // Bypassing RLS means an empty result is a genuine failure, not a policy.
    const conn = await admin.from("asset_classes").select("code").limit(1);
    database = !conn.error && (conn.data?.length ?? 0) > 0;

    const [quotes, articles, scans, providers, notifs] = await Promise.all([
      admin.from("market_quotes").select("as_of").order("as_of", { ascending: false }).limit(1),
      admin.from("news_articles").select("published_at").order("published_at", { ascending: false }).limit(1),
      admin.from("scan_runs").select("created_at").order("created_at", { ascending: false }).limit(1),
      admin.from("data_provider_status").select("last_success_at").order("last_success_at", { ascending: false }).limit(1),
      // head:true returns the count only — no notification rows are read.
      admin.from("notifications").select("id", { count: "exact", head: true }),
    ]);

    // Quotes/news refresh on demand; scans run once per trading day, so a
    // weekend-old scan is still healthy (72h covers Fri close → Mon open).
    if (!quotes.error) marketData = freshnessFrom(quotes.data?.[0]?.as_of, 30);
    if (!articles.error) news = freshnessFrom(articles.data?.[0]?.published_at, 12);
    if (!scans.error) scanner = freshnessFrom(scans.data?.[0]?.created_at, 72);
    if (!providers.error) cron = freshnessFrom(providers.data?.[0]?.last_success_at, 30);
    notifications = !notifs.error;
  } catch {
    // service-role env missing or database unreachable — honest defaults stand
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
