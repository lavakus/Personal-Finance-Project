import { NextResponse } from "next/server";

import { z } from "zod";

import { verifyBotRequest } from "@/lib/bot-auth";

const HeartbeatInput = z.object({
  status: z.enum(["OK", "ERROR"]).default("OK"),
  message: z.string().max(1000).optional(),
});

/** Bot heartbeat / error reporting (brief §64). */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const auth = await verifyBotRequest(req, rawBody);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let parsed;
  try {
    parsed = HeartbeatInput.safeParse(rawBody ? JSON.parse(rawBody) : {});
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid heartbeat" }, { status: 400 });
  }

  const { admin, botId, userId } = auth.ctx;
  const now = new Date().toISOString();
  await admin.from("bots").update({ last_heartbeat_at: now }).eq("id", botId);
  await admin.from("bot_events").insert({
    bot_id: botId,
    event_type: parsed.data.status === "ERROR" ? "ERROR" : "HEARTBEAT",
    message: parsed.data.message ?? null,
  });

  if (parsed.data.status === "ERROR") {
    await admin.from("notifications").insert({
      user_id: userId,
      type: "BOT",
      title: "Bot reported an error",
      body: parsed.data.message ?? "no message",
    });
  }

  return NextResponse.json({ ok: true });
}
