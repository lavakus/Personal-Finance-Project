import { NextResponse } from "next/server";

import { AccountInputSchema } from "@tradeos/types";

import { getAccounts } from "@/lib/data/portfolio";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getAccounts(sb));
}

export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = AccountInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }
  const { data, error } = await sb
    .from("portfolio_accounts")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      currency: parsed.data.currency,
    })
    .select("id, name, currency, is_default")
    .single();
  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data, { status: 201 });
}
