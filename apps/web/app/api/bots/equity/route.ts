import { NextResponse } from "next/server";

import { z } from "zod";

import { verifyBotRequest } from "@/lib/bot-auth";

const EquityInput = z.object({
  equity: z.number(),
  asOf: z.string().optional(),
});

/** Bot equity snapshot ingestion (brief §64). */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const auth = await verifyBotRequest(req, rawBody);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let parsed;
  try {
    parsed = EquityInput.safeParse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid equity payload" }, { status: 400 });
  }

  const { error } = await auth.ctx.admin.from("bot_equity_snapshots").upsert(
    {
      bot_id: auth.ctx.botId,
      equity: parsed.data.equity,
      as_of: parsed.data.asOf ?? new Date().toISOString(),
    },
    { onConflict: "bot_id,as_of" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
