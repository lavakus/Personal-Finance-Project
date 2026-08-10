import { NextResponse } from "next/server";

import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const maxDuration = 60;

/** A bot silent this long has stopped reporting. */
const STALE_AFTER_MIN = 60;
/** ...but only counts as a failure if it was reporting within this window,
 *  i.e. it was genuinely running and then stopped. */
const RAN_RECENTLY_MIN = 24 * 60;

/** alert-generation job (brief §85): evaluates PRICE rules against the
 *  quote cache, earnings proximity for held/watched symbols, and stale
 *  bots. One notification per trigger per day (dedupe). */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  let authorized = Boolean(cronSecret) && auth === `Bearer ${cronSecret}`;
  if (!authorized) {
    const sb = await createServerSupabase();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (user) {
      const { data: profile } = await sb
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      authorized = profile?.role === "ADMIN";
    }
  }
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminSupabase();
  const today = new Date().toISOString().slice(0, 10);
  let created = 0;

  async function notifyOnce(params: {
    userId: string;
    alertId?: string;
    type: string;
    title: string;
    body?: string;
    symbol?: string;
  }) {
    // dedupe: same user+type+title once per day
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("user_id", params.userId)
      .eq("type", params.type)
      .eq("title", params.title)
      .gte("created_at", `${today}T00:00:00Z`)
      .maybeSingle();
    if (existing) return;
    const { error } = await admin.from("notifications").insert({
      user_id: params.userId,
      alert_id: params.alertId ?? null,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      symbol: params.symbol ?? null,
    });
    if (!error) created++;
  }

  try {
    // 1. PRICE rules vs quote cache
    const { data: rules } = await admin
      .from("alerts")
      .select("id, user_id, symbol, condition")
      .eq("type", "PRICE")
      .eq("is_active", true);
    for (const r of rules ?? []) {
      if (!r.symbol) continue;
      const { data: q } = await admin
        .from("market_quotes")
        .select("price, assets!inner (symbol)")
        .eq("assets.symbol", r.symbol)
        .maybeSingle();
      if (!q) continue;
      const price = Number(q.price);
      const cond = r.condition as { above?: number; below?: number };
      if (cond.above !== undefined && price >= cond.above) {
        await notifyOnce({
          userId: r.user_id,
          alertId: r.id,
          type: "PRICE",
          title: `${r.symbol} above ${cond.above}`,
          body: `Cached price ${price} crossed above ${cond.above}.`,
          symbol: r.symbol,
        });
      }
      if (cond.below !== undefined && price <= cond.below) {
        await notifyOnce({
          userId: r.user_id,
          alertId: r.id,
          type: "PRICE",
          title: `${r.symbol} below ${cond.below}`,
          body: `Cached price ${price} crossed below ${cond.below}.`,
          symbol: r.symbol,
        });
      }
    }

    // 2. earnings within 2 days for symbols each user holds or watches
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const { data: earnings } = await admin
      .from("earnings_events")
      .select("symbol, earnings_date")
      .gte("earnings_date", today)
      .lte("earnings_date", soon);
    if (earnings?.length) {
      const { data: watchers } = await admin
        .from("watchlist_items")
        .select("user_id, symbol");
      const { data: holders } = await admin
        .from("transactions")
        .select("user_id, assets!inner (symbol)")
        .in("type", ["BUY"]);
      const interested = new Map<string, Set<string>>();
      for (const w of watchers ?? []) {
        const set = interested.get(w.symbol) ?? new Set();
        set.add(w.user_id);
        interested.set(w.symbol, set);
      }
      for (const h of holders ?? []) {
        const sym = (h.assets as unknown as { symbol: string }).symbol;
        const set = interested.get(sym) ?? new Set();
        set.add(h.user_id);
        interested.set(sym, set);
      }
      for (const e of earnings) {
        for (const userId of interested.get(e.symbol) ?? []) {
          await notifyOnce({
            userId,
            type: "EARNINGS",
            title: `${e.symbol} earnings on ${e.earnings_date}`,
            body: "Event risk: HIGH — within 2 trading days.",
            symbol: e.symbol,
          });
        }
      }
    }

    // 3. stale bots (>60 min since heartbeat while active)
    const { data: bots } = await admin
      .from("bots")
      .select("id, user_id, name, last_heartbeat_at, is_active")
      .eq("is_active", true)
      .not("last_heartbeat_at", "is", null);
    for (const b of bots ?? []) {
      const ageMin =
        (Date.now() - new Date(b.last_heartbeat_at as string).getTime()) / 60000;
      // Alert on "went quiet while it was working", not "isn't running now".
      // Session-scheduled bots (trade the session, exit, restart tomorrow) are
      // legitimately silent overnight and at weekends, so a bare >60min rule
      // fires every single day for a perfectly healthy bot. Requiring a
      // heartbeat within the last DAY means the bot demonstrably was running
      // recently, so a 60-minute gap is a real mid-session death. A bot that
      // simply hasn't started yet is visible as STALE on the Bots page — it
      // does not need to wake anyone up.
      if (ageMin > STALE_AFTER_MIN && ageMin < RAN_RECENTLY_MIN) {
        await notifyOnce({
          userId: b.user_id,
          type: "BOT",
          title: `Bot "${b.name}" stopped mid-session`,
          body:
            `Last heartbeat ${Math.round(ageMin)} minutes ago, but it was ` +
            `reporting earlier today — it likely died rather than finished.`,
        });
      }
    }

    return NextResponse.json({ created });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "alert job failed" },
      { status: 500 }
    );
  }
}
