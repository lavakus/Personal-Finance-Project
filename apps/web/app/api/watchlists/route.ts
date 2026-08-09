import { NextResponse } from "next/server";

import { z } from "zod";

import { createServerSupabase } from "@/lib/supabase/server";

const WatchlistInput = z.object({ name: z.string().min(1).max(80) });

export async function GET() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await sb
    .from("watchlists")
    .select("id, name, watchlist_items (id, symbol, note, created_at)")
    .is("deleted_at", null)
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = WatchlistInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid name" }, { status: 400 });
  }
  const { data, error } = await sb
    .from("watchlists")
    .insert({ user_id: user.id, name: parsed.data.name })
    .select("id, name")
    .single();
  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data, { status: 201 });
}
