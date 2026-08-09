import { NextResponse } from "next/server";

import { AssetInputSchema } from "@tradeos/types";

import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  let query = sb
    .from("assets")
    .select("id, symbol, name, asset_class, currency")
    .eq("is_active", true)
    .order("symbol")
    .limit(20);
  if (q) query = query.or(`symbol.ilike.%${q}%,name.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * Create an asset if it doesn't exist. Assets are SHARED reference data
 * (admin-write under RLS), so after authenticating the session this uses
 * the service-role client — input is zod-validated and idempotent.
 */
export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = AssetInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }
  const a = parsed.data;
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("assets")
    .upsert(
      {
        symbol: a.symbol,
        name: a.name,
        asset_class: a.assetClass,
        currency: a.currency,
      },
      { onConflict: "symbol,asset_class", ignoreDuplicates: false }
    )
    .select("id, symbol, name, asset_class, currency")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
