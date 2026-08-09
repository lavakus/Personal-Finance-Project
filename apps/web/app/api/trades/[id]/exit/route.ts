import { NextResponse } from "next/server";

import { d } from "@tradeos/calculations";
import { TradeExitInputSchema } from "@tradeos/types";

import { createServerSupabase } from "@/lib/supabase/server";

/** Close or partially close a trade (brief §15). Status transitions are
 *  computed from ledger quantities, never trusted from the client. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = TradeExitInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }
  const x = parsed.data;

  // RLS scopes this to the caller's own trades.
  const { data: trade, error: tErr } = await sb
    .from("trades")
    .select("id, quantity, status, trade_exits (quantity)")
    .eq("id", id)
    .single();
  if (tErr || !trade) {
    return NextResponse.json({ error: "trade not found" }, { status: 404 });
  }
  if (["CLOSED", "CANCELLED", "INVALIDATED"].includes(trade.status)) {
    return NextResponse.json(
      { error: `trade is already ${trade.status}` },
      { status: 409 }
    );
  }

  const exited = (trade.trade_exits ?? []).reduce(
    (a: ReturnType<typeof d>, e: { quantity: string }) => a.plus(d(e.quantity)),
    d(0)
  );
  const remaining = d(trade.quantity).minus(exited);
  if (d(x.quantity).gt(remaining)) {
    return NextResponse.json(
      { error: `exit quantity ${x.quantity} exceeds remaining ${remaining.toString()}` },
      { status: 400 }
    );
  }

  const { error: xErr } = await sb.from("trade_exits").insert({
    trade_id: id,
    user_id: user.id,
    exit_price: x.exitPrice,
    quantity: x.quantity,
    fees: x.fees,
    exit_date: x.exitDate,
    exit_reason: x.exitReason ?? null,
  });
  if (xErr) return NextResponse.json({ error: xErr.message }, { status: 500 });

  const newStatus = remaining.minus(d(x.quantity)).isZero()
    ? "CLOSED"
    : "PARTIALLY_CLOSED";
  const { error: uErr } = await sb
    .from("trades")
    .update({ status: newStatus })
    .eq("id", id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  return NextResponse.json({ id, status: newStatus }, { status: 201 });
}
