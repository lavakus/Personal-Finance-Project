import { NextResponse } from "next/server";

import { z } from "zod";

import { createServerSupabase } from "@/lib/supabase/server";

const PriceAlertInput = z.object({
  symbol: z.string().min(1).max(32).transform((s) => s.toUpperCase().trim()),
  direction: z.enum(["above", "below"]),
  level: z.number().positive(),
});

/** Create a PRICE alert rule (brief §66). */
export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = PriceAlertInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid alert" }, { status: 400 });
  }
  const a = parsed.data;
  const { data, error } = await sb
    .from("alerts")
    .insert({
      user_id: user.id,
      type: "PRICE",
      symbol: a.symbol,
      condition: { [a.direction]: a.level },
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

/** Deactivate a rule (?id=) or mark all notifications read (?read=all). */
export async function PATCH(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  if (url.searchParams.get("read") === "all") {
    const { error } = await sb
      .from("notifications")
      .update({ is_read: true })
      .eq("is_read", false);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const id = url.searchParams.get("id");
  if (id) {
    const { error } = await sb.from("alerts").update({ is_active: false }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "nothing to do" }, { status: 400 });
}
