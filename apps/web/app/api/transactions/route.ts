import { NextResponse } from "next/server";

import { d, walkLedger, type LedgerLot } from "@tradeos/calculations";
import { TransactionInputSchema } from "@tradeos/types";

import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await sb
    .from("transactions")
    .select(
      "id, account_id, asset_id, type, quantity, price, amount, currency, fees, executed_at, notes, assets (symbol, name)"
    )
    .order("executed_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = TransactionInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }
  const t = parsed.data;

  // BUY/SELL: amount is DERIVED as quantity × price with decimal math —
  // never trusted from the client, never float (brief §88).
  const isTrade = t.type === "BUY" || t.type === "SELL";
  const amount = isTrade
    ? d(t.quantity as string).times(d(t.price as string)).toString()
    : (t.amount as string);

  // A SELL may never exceed the ledger's current holding for that asset.
  if (t.type === "SELL" && t.assetId) {
    const { data: prior, error: priorErr } = await sb
      .from("transactions")
      .select("type, quantity, price, fees, executed_at")
      .eq("asset_id", t.assetId)
      .in("type", ["BUY", "SELL"])
      .order("executed_at", { ascending: true });
    if (priorErr) {
      return NextResponse.json({ error: priorErr.message }, { status: 500 });
    }
    const lots: LedgerLot[] = (prior ?? []).map((p) => ({
      type: p.type as "BUY" | "SELL",
      quantity: p.quantity ?? "0",
      price: p.price ?? "0",
      fees: p.fees,
    }));
    const held = walkLedger(lots).quantity;
    if (d(t.quantity as string).gt(held)) {
      return NextResponse.json(
        { error: `sell quantity ${t.quantity} exceeds holding ${held.toString()}` },
        { status: 400 }
      );
    }
  }

  const { data, error } = await sb
    .from("transactions")
    .insert({
      user_id: user.id,
      account_id: t.accountId,
      asset_id: t.assetId,
      type: t.type,
      quantity: t.quantity,
      price: t.price,
      amount,
      currency: t.currency,
      fees: t.fees,
      executed_at: t.executedAt,
      notes: t.notes ?? null,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
