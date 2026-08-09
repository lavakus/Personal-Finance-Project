import { NextResponse } from "next/server";

import { createRssNewsProvider, matchAssets } from "@tradeos/news";

import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const maxDuration = 60;

/** news-update job (brief §33–35). Cron bearer OR admin session. Fetches
 *  official RSS feeds, classifies heuristically, maps to known assets,
 *  inserts deduped by URL. */
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
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminSupabase();
    const items = await createRssNewsProvider().getLatestNews();

    const { data: assets } = await admin
      .from("assets")
      .select("id, symbol, name")
      .eq("is_active", true);

    let inserted = 0;
    let mapped = 0;
    for (const item of items) {
      const { data, error } = await admin
        .from("news_articles")
        .upsert(
          {
            headline: item.headline,
            url: item.url,
            source: item.source,
            category: item.category,
            published_at: item.publishedAt,
            sentiment: item.sentiment,
            impact: item.impact,
          },
          { onConflict: "url", ignoreDuplicates: true }
        )
        .select("id")
        .maybeSingle();
      if (error || !data) continue;
      inserted++;

      const hits = matchAssets(item.headline, assets ?? []);
      for (const assetId of hits) {
        const { error: mErr } = await admin
          .from("news_assets")
          .upsert(
            { article_id: data.id, asset_id: assetId },
            { onConflict: "article_id,asset_id", ignoreDuplicates: true }
          );
        if (!mErr) mapped++;
      }
    }

    await admin.from("data_provider_status").upsert({
      provider: "rss-news",
      last_success_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ fetched: items.length, inserted, mapped });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "news job failed" },
      { status: 500 }
    );
  }
}
