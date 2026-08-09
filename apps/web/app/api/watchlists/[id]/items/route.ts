import { NextResponse } from "next/server";

import { z } from "zod";

import { createServerSupabase } from "@/lib/supabase/server";

const ItemInput = z.object({
  symbol: z.string().min(1).max(32).transform((s) => s.toUpperCase().trim()),
  note: z.string().max(500).optional(),
});

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
  const parsed = ItemInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }
  const { data, error } = await sb
    .from("watchlist_items")
    .insert({
      watchlist_id: id,
      user_id: user.id,
      symbol: parsed.data.symbol,
      note: parsed.data.note ?? null,
    })
    .select("id, symbol")
    .single();
  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const itemId = new URL(req.url).searchParams.get("itemId");
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
  const { error } = await sb
    .from("watchlist_items")
    .delete()
    .eq("id", itemId)
    .eq("watchlist_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
