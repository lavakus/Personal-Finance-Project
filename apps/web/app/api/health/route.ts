import { NextResponse } from "next/server";

import type { SystemHealth } from "@tradeos/types";

import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

/** System health (brief §84). Providers/cron report real ages from Phase 4+;
 *  until then they are honestly UNAVAILABLE (never faked green). */
export async function GET() {
  let database = false;
  if (!isDemoMode) {
    try {
      const supabase = await createServerSupabase();
      const { error } = await supabase.from("asset_classes").select("code").limit(1);
      database = !error;
    } catch {
      database = false;
    }
  }

  const health: SystemHealth = {
    database,
    marketData: isDemoMode ? "DEMO" : "UNAVAILABLE",
    news: isDemoMode ? "DEMO" : "UNAVAILABLE",
    scanner: isDemoMode ? "DEMO" : "UNAVAILABLE",
    cron: isDemoMode ? "DEMO" : "UNAVAILABLE",
    notifications: false,
    demoMode: isDemoMode,
    checkedAt: new Date().toISOString(),
  };
  return NextResponse.json(health);
}
