import { Badge, Card } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { demoNews } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ArticleRow {
  id: string;
  headline: string;
  url: string;
  source: string;
  category: string;
  published_at: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  impact: "HIGH" | "MEDIUM" | "LOW";
  news_assets: Array<{ assets: { symbol: string } | null }>;
}

const CATEGORIES = ["ALL", "INDIAN_MARKET", "CRYPTO", "GLOBAL", "GOLD"] as const;

/** News (brief §33–35). Sentiment/impact badges are keyword HEURISTICS —
 *  research inputs, never buy/sell signals. */
export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category = "ALL" } = await searchParams;

  if (isDemoMode) {
    return (
      <Card title="News" action={<Badge tone="demo">demo</Badge>}>
        <ul className="space-y-2.5">
          {demoNews.map((n) => (
            <li key={n.headline} className="flex items-start justify-between gap-3">
              <span className="text-[13px]">{n.headline}</span>
              <Badge tone={n.sentiment === "POSITIVE" ? "gain" : "neutral"}>
                {n.sentiment}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let rows: ArticleRow[];
  try {
    let q = sb
      .from("news_articles")
      .select(
        "id, headline, url, source, category, published_at, sentiment, impact, news_assets (assets (symbol))"
      )
      .order("published_at", { ascending: false })
      .limit(100);
    if (category !== "ALL") q = q.eq("category", category);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows = data as unknown as ArticleRow[];
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0006_news_events.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <a
            key={c}
            href={c === "ALL" ? "/news" : `/news?category=${c}`}
            className={`rounded border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
              category === c
                ? "border-(--color-accent)/50 bg-(--color-accent)/10 text-(--color-accent)"
                : "border-(--color-border-strong) text-(--color-text-dim) hover:text-(--color-text)"
            }`}
          >
            {c.replace("_", " ")}
          </a>
        ))}
      </div>

      <Card title={`News (${rows.length})`}>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            No articles yet — run the news refresh from Settings or wait for the
            scheduled job.
          </p>
        ) : (
          <ul className="divide-y divide-(--color-border)">
            {rows.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] leading-snug hover:text-(--color-accent)"
                  >
                    {a.headline}
                  </a>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-(--color-text-faint)">
                    <span>{a.source}</span>
                    <span>·</span>
                    <span>{new Date(a.published_at).toLocaleString("en-IN")}</span>
                    {a.news_assets?.map((na) =>
                      na.assets ? (
                        <a
                          key={na.assets.symbol}
                          href={`/research?symbol=${na.assets.symbol}`}
                          className="rounded bg-(--color-accent)/10 px-1.5 py-0.5 font-semibold text-(--color-accent)"
                        >
                          {na.assets.symbol}
                        </a>
                      ) : null
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge
                    tone={
                      a.sentiment === "POSITIVE"
                        ? "gain"
                        : a.sentiment === "NEGATIVE"
                          ? "loss"
                          : "neutral"
                    }
                  >
                    {a.sentiment}
                  </Badge>
                  {a.impact === "HIGH" ? <Badge tone="warn">HIGH IMPACT</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-(--color-text-faint)">
          Sentiment and impact are keyword heuristics for triage — read the
          article before acting. Positive sentiment is never a buy signal.
        </p>
      </Card>
    </div>
  );
}
