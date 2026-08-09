import { NextResponse } from "next/server";

import { z } from "zod";

import { verifyBotRequest } from "@/lib/bot-auth";

const BotTradeInput = z.object({
  externalId: z.string().min(1).max(120),
  symbol: z.string().min(1).max(32),
  direction: z.enum(["LONG", "SHORT"]).default("LONG"),
  status: z.enum(["OPEN", "CLOSED"]),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive().nullable().optional(),
  quantity: z.number().positive(),
  pnl: z.number().nullable().optional(),
  fees: z.number().min(0).default(0),
  openedAt: z.string(),
  closedAt: z.string().nullable().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

/** Bot trade ingestion (brief §64): trade opened / trade closed. Upserted
 *  by (bot, externalId) so bots can safely retry. */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const auth = await verifyBotRequest(req, rawBody);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let parsed;
  try {
    parsed = BotTradeInput.safeParse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const t = parsed.data;

  const { error } = await auth.ctx.admin.from("bot_trades").upsert(
    {
      bot_id: auth.ctx.botId,
      external_id: t.externalId,
      symbol: t.symbol.toUpperCase(),
      direction: t.direction,
      status: t.status,
      entry_price: t.entryPrice,
      exit_price: t.exitPrice ?? null,
      quantity: t.quantity,
      pnl: t.pnl ?? null,
      fees: t.fees,
      opened_at: t.openedAt,
      closed_at: t.closedAt ?? null,
      raw: t.raw ?? {},
    },
    { onConflict: "bot_id,external_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
