import { NextResponse } from "next/server";

import { TradeReviewInputSchema } from "@tradeos/types";

import { createServerSupabase } from "@/lib/supabase/server";

/** Post-trade behavioral review (brief §16) — one per trade, upserted. */
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

  const parsed = TradeReviewInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }
  const r = parsed.data;

  const { error } = await sb.from("trade_reviews").upsert({
    trade_id: id,
    user_id: user.id,
    followed_strategy: r.followedStrategy,
    followed_entry: r.followedEntry,
    respected_stop: r.respectedStop,
    followed_target: r.followedTarget,
    exited_early: r.exitedEarly,
    chased_entry: r.chasedEntry,
    moved_stop: r.movedStop,
    emotion: r.emotion ?? null,
    lessons: r.lessons ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tradeId: id }, { status: 201 });
}
