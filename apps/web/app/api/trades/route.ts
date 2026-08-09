import { NextResponse } from "next/server";

import { TradeInputSchema } from "@tradeos/types";

import { getTrades } from "@/lib/data/trades";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getTrades(sb));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "trades failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = TradeInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }
  const t = parsed.data;
  const { data, error } = await sb
    .from("trades")
    .insert({
      user_id: user.id,
      asset_id: t.assetId,
      direction: t.direction,
      status: t.status,
      entry_price: t.entryPrice,
      quantity: t.quantity,
      stop_loss: t.stopLoss,
      target1: t.target1,
      target2: t.target2,
      strategy_version_id: t.strategyVersionId,
      setup: t.setup,
      entry_date: t.entryDate,
      reason: t.reason ?? null,
      notes: t.notes ?? null,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
