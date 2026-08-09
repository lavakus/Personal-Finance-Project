import { NextResponse } from "next/server";

import { StrategyInputSchema } from "@tradeos/types";

import { getStrategies } from "@/lib/data/trades";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getStrategies(sb));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "strategies failed" },
      { status: 500 }
    );
  }
}

/** Create a personal strategy with its first version, or add a new version
 *  to an existing strategy of the same name (versions are immutable). */
export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = StrategyInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }
  const s = parsed.data;

  const { data: existing } = await sb
    .from("strategies")
    .select("id")
    .eq("name", s.name)
    .eq("user_id", user.id)
    .maybeSingle();

  let strategyId = existing?.id as string | undefined;
  if (!strategyId) {
    const { data, error } = await sb
      .from("strategies")
      .insert({ user_id: user.id, name: s.name, description: s.description ?? null })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    strategyId = data.id;
  }

  const { data: version, error: vErr } = await sb
    .from("strategy_versions")
    .insert({ strategy_id: strategyId, version: s.version })
    .select("id, version")
    .single();
  if (vErr) {
    const status = vErr.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: vErr.message }, { status });
  }
  return NextResponse.json({ strategyId, ...version }, { status: 201 });
}
