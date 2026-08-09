import { NextResponse } from "next/server";

import { refreshMarketData } from "@/lib/data/market";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * market-data-update job (brief §85–86). Callable by:
 *  - cron with  Authorization: Bearer ${CRON_SECRET}
 *  - a signed-in ADMIN (on-demand refresh from Settings)
 */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  let authorized = Boolean(cronSecret) && auth === `Bearer ${cronSecret}`;

  if (!authorized) {
    const sb = await createServerSupabase();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (user) {
      const { data: profile } = await sb
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      authorized = profile?.role === "ADMIN";
    }
  }
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshMarketData(createAdminSupabase());
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "refresh failed" },
      { status: 500 }
    );
  }
}
