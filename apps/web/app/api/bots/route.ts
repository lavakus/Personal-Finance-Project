import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { z } from "zod";

import { hashApiKey } from "@/lib/bot-auth";
import { createServerSupabase } from "@/lib/supabase/server";

const BotInput = z.object({
  name: z.string().min(1).max(80),
  strategy: z.string().max(120).optional(),
  description: z.string().max(1000).optional(),
});

export async function GET() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await sb
    .from("bots")
    .select("id, name, strategy, is_active, last_heartbeat_at, created_at")
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** Register a bot. The API key is returned ONCE in plaintext; only its
 *  sha256 hash is stored (brief §64, §79). */
export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = BotInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid bot input" }, { status: 400 });
  }

  const { data: bot, error } = await sb
    .from("bots")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      strategy: parsed.data.strategy ?? null,
      description: parsed.data.description ?? null,
    })
    .select("id, name")
    .single();
  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  const apiKey = `tbk_${randomBytes(32).toString("hex")}`;
  const { error: kErr } = await sb.from("bot_api_keys").insert({
    bot_id: bot.id,
    key_hash: hashApiKey(apiKey),
    label: "initial",
  });
  if (kErr) return NextResponse.json({ error: kErr.message }, { status: 500 });

  return NextResponse.json(
    {
      botId: bot.id,
      name: bot.name,
      apiKey,
      note: "Store this key now — it is shown only once and only its hash is kept.",
    },
    { status: 201 }
  );
}
