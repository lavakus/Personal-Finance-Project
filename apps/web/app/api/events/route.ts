import { NextResponse } from "next/server";

import { z } from "zod";

import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

const EventInput = z.object({
  kind: z.enum(["corporate", "earnings"]),
  symbol: z.string().min(1).max(32).transform((s) => s.toUpperCase().trim()),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  eventType: z.string().max(40).optional(),   // corporate only
  title: z.string().max(300).optional(),
  period: z.string().max(20).optional(),      // earnings only
});

/** Manual event entry (brief §37–38). Free reliable Indian corporate-event
 *  APIs don't exist, and scraping NSE violates its ToS — so events are
 *  curated by the admin (a provider adapter can replace this later). */
export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await sb
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "ADMIN") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const parsed = EventInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }
  const e = parsed.data;
  const admin = createAdminSupabase();

  const { data: asset } = await admin
    .from("assets")
    .select("id")
    .eq("symbol", e.symbol)
    .maybeSingle();

  if (e.kind === "earnings") {
    const { error } = await admin.from("earnings_events").upsert(
      {
        asset_id: asset?.id ?? null,
        symbol: e.symbol,
        earnings_date: e.date,
        period: e.period ?? null,
        confirmed: true,
        source: "manual",
      },
      { onConflict: "symbol,earnings_date" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await admin.from("corporate_events").upsert(
      {
        asset_id: asset?.id ?? null,
        symbol: e.symbol,
        event_type: e.eventType ?? "OTHER",
        event_date: e.date,
        title: e.title ?? `${e.eventType ?? "Event"} — ${e.symbol}`,
        source: "manual",
      },
      { onConflict: "symbol,event_type,event_date" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
