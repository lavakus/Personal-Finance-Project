import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminSupabase } from "./supabase/admin";

/**
 * Bot ingestion auth (brief §64): x-api-key + HMAC-SHA256 signature over
 * `${timestamp}.${rawBody}` + timestamp freshness window + per-key rate
 * limit. Keys are stored hashed; a leaked DB row cannot forge requests.
 */

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 60; // requests/minute/key (per server instance)

const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(keyHash: string): boolean {
  const now = Date.now();
  const b = buckets.get(keyHash);
  if (!b || now > b.resetAt) {
    buckets.set(keyHash, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  b.count++;
  return b.count > RATE_LIMIT;
}

export interface BotContext {
  botId: string;
  userId: string;
  admin: SupabaseClient;
}

export async function verifyBotRequest(
  req: Request,
  rawBody: string
): Promise<{ ok: true; ctx: BotContext } | { ok: false; status: number; error: string }> {
  const apiKey = req.headers.get("x-api-key");
  const signature = req.headers.get("x-signature");
  const timestamp = req.headers.get("x-timestamp");
  if (!apiKey || !signature || !timestamp) {
    return { ok: false, status: 401, error: "missing x-api-key / x-signature / x-timestamp" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) {
    return { ok: false, status: 401, error: "timestamp outside allowed window" };
  }

  const expected = createHmac("sha256", apiKey)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "bad signature" };
  }

  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  if (rateLimited(keyHash)) {
    return { ok: false, status: 429, error: "rate limited" };
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("bot_api_keys")
    .select("bot_id, revoked_at, bots (user_id)")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (error || !data || data.revoked_at) {
    return { ok: false, status: 401, error: "unknown or revoked key" };
  }

  return {
    ok: true,
    ctx: {
      botId: data.bot_id,
      userId: (data.bots as unknown as { user_id: string }).user_id,
      admin,
    },
  };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
