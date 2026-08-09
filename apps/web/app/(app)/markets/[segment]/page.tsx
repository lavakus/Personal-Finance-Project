import { notFound } from "next/navigation";

import { Badge, Card, PnL } from "@/components/ui";
import { getIndexQuotes, type QuoteRow } from "@/lib/data/market";
import { isMigrationPending } from "@/lib/data/portfolio";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Market segment pages (brief §39–40). All quotes come from the Postgres
 *  cache with visible freshness — provider calls never happen per-request. */

const SEGMENTS: Record<
  string,
  { title: string; indexCodes: string[]; assetClass: string | null }
> = {
  india: {
    title: "Indian market",
    indexCodes: ["NIFTY50", "BANKNIFTY", "INDIAVIX"],
    assetClass: "EQUITY_IN",
  },
  crypto: {
    title: "Crypto",
    indexCodes: [],
    assetClass: "CRYPTO",
  },
  gold: {
    title: "Gold",
    indexCodes: ["GOLD", "USDINR"],
    assetClass: "GOLD",
  },
  global: {
    title: "Global markets",
    indexCodes: ["SP500", "NASDAQ", "DOWJONES", "USDINR"],
    assetClass: null,
  },
};

interface AssetQuoteRow {
  price: string;
  change_pct: string;
  as_of: string;
  freshness: string;
  provider: string;
  assets: { symbol: string; name: string; asset_class: string } | null;
}

export default async function MarketSegmentPage({
  params,
}: {
  params: Promise<{ segment: string }>;
}) {
  const { segment } = await params;
  const cfg = SEGMENTS[segment];
  if (!cfg) notFound();

  if (isDemoMode) {
    return (
      <Card title={cfg.title} action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">
          Connect Supabase and run the market-data job to see cached quotes here.
        </p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let indexQuotes: QuoteRow[] = [];
  let assetQuotes: AssetQuoteRow[] = [];
  try {
    indexQuotes = (await getIndexQuotes(sb)).filter((q) =>
      cfg.indexCodes.includes(q.index_code ?? "")
    );
    if (cfg.assetClass) {
      const { data, error } = await sb
        .from("market_quotes")
        .select(
          "price, change_pct, as_of, freshness, provider, assets!inner (symbol, name, asset_class)"
        )
        .eq("assets.asset_class", cfg.assetClass);
      if (error) throw new Error(error.message);
      assetQuotes = data as unknown as AssetQuoteRow[];
    }
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0004_market_data.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  const empty = indexQuotes.length === 0 && assetQuotes.length === 0;

  return (
    <div className="space-y-4">
      {indexQuotes.length > 0 ? (
        <Card title={cfg.title}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {indexQuotes.map((q) => (
              <div key={q.index_code}>
                <div className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                  {q.market_indices?.name ?? q.index_code}
                </div>
                <div className="num mt-0.5 text-lg font-semibold">
                  {Number(q.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </div>
                <div className="flex items-center gap-1.5">
                  <PnL value={Number(q.change_pct)} suffix="%" />
                  <Badge tone={q.freshness === "RECENT" ? "gain" : "warn"}>{q.freshness}</Badge>
                </div>
                <div className="mt-0.5 text-[10px] text-(--color-text-faint)">
                  {q.provider} · {new Date(q.as_of).toLocaleString("en-IN")}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {cfg.assetClass ? (
        <Card title={`Tracked ${cfg.title.toLowerCase()} assets`}>
          {assetQuotes.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
              No {cfg.assetClass} assets tracked yet — they appear automatically
              once you add transactions or trades, then run the market-data refresh.
            </p>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                  <th className="pb-2 font-medium">Asset</th>
                  <th className="pb-2 text-right font-medium">Price</th>
                  <th className="pb-2 text-right font-medium">Change</th>
                  <th className="pb-2 font-medium">Freshness</th>
                  <th className="pb-2 font-medium">As of</th>
                </tr>
              </thead>
              <tbody>
                {assetQuotes.map((q) => (
                  <tr key={q.assets?.symbol} className="border-t border-(--color-border)">
                    <td className="py-2">
                      <span className="font-semibold">{q.assets?.symbol}</span>
                      <span className="ml-2 text-[11px] text-(--color-text-faint)">
                        {q.assets?.name}
                      </span>
                    </td>
                    <td className="num text-right">
                      {Number(q.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="num text-right">
                      <PnL value={Number(q.change_pct)} suffix="%" />
                    </td>
                    <td>
                      <Badge tone={q.freshness === "RECENT" ? "gain" : "warn"}>{q.freshness}</Badge>
                    </td>
                    <td className="text-[11px] text-(--color-text-faint)">
                      {new Date(q.as_of).toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {empty ? (
        <Card title={cfg.title}>
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            No quotes cached yet — run the market-data refresh from Settings.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
