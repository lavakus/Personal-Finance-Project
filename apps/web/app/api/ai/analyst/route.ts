import { NextResponse } from "next/server";

import Anthropic from "@anthropic-ai/sdk";

import { ANALYST_SYSTEM_PROMPT, gatherAnalystSnapshot } from "@/lib/data/analyst";
import { createServerSupabase } from "@/lib/supabase/server";

export const maxDuration = 60;

/** AI market analyst (brief §61–62). Claude receives only the verified
 *  structured snapshot and writes analysis — it computes nothing. */
export async function POST() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "AI analyst not configured — set ANTHROPIC_API_KEY in the server environment.",
      },
      { status: 503 }
    );
  }

  try {
    const snapshot = await gatherAnalystSnapshot(sb);
    const client = new Anthropic();

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      output_config: { effort: "low" },
      system: ANALYST_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Verified data snapshot:\n${JSON.stringify(snapshot, null, 1)}\n\nWrite today's briefing.`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "the model declined this request" },
        { status: 502 }
      );
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return NextResponse.json({ analysis: text, asOf: snapshot.asOf });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "analysis failed" },
      { status: 500 }
    );
  }
}
