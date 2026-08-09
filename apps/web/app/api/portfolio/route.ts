import { NextResponse } from "next/server";

import { getPortfolioSummary } from "@/lib/data/portfolio";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await getPortfolioSummary(sb));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "portfolio failed" },
      { status: 500 }
    );
  }
}
