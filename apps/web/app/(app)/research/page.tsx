import { Badge, Card, PnL } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { getSymbolScanHistory } from "@/lib/data/scanner";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Stock research (brief §71/§100, first iteration). Shows a symbol's
 *  cached quote and its full historical signal record (brief §57). The
 *  full research page grows richer as later phases add news/fundamentals. */
export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>;
}) {
  const { symbol: raw } = await searchParams;
  const symbol = raw?.trim().toUpperCase() ?? "";

  const searchForm = (
    <form className="flex gap-2" action="/research" method="get">
      <input
        name="symbol"
        defaultValue={symbol}
        placeholder="RELIANCE"
        className="w-56 rounded border border-(--color-border-strong) bg-(--color-surface-2) px-3 py-1.5 text-[13px] outline-none focus:border-(--color-accent)"
      />
      <button
        type="submit"
        className="rounded bg-(--color-accent) px-4 py-1.5 text-[12px] font-semibold text-black hover:opacity-90"
      >
        Research
      </button>
    </form>
  );

  if (isDemoMode) {
    return (
      <Card title="Stock research" action={<Badge tone="demo">demo</Badge>}>
        {searchForm}
      </Card>
    );
  }
  if (!symbol) {
    return (
      <Card title="Stock research">
        {searchForm}
        <p className="mt-4 text-[13px] text-(--color-text-faint)">
          Enter an NSE symbol to see its cached quote and every historical
          scanner signal it has appeared in.
        </p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let history: Awaited<ReturnType<typeof getSymbolScanHistory>> = [];
  let quote: { price: string; change_pct: string; freshness: string; as_of: string } | null = null;
  try {
    history = await getSymbolScanHistory(sb, symbol);
    const { data } = await sb
      .from("market_quotes")
      .select("price, change_pct, freshness, as_of, assets!inner (symbol)")
      .eq("assets.symbol", symbol)
      .maybeSingle();
    quote = data
      ? {
          price: String(data.price),
          change_pct: String(data.change_pct),
          freshness: String(data.freshness),
          as_of: String(data.as_of),
        }
      : null;
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Migrations 0004/0005 are not applied yet — run them in the Supabase SQL editor.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card title={`Research — ${symbol}`}>
        {searchForm}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
              Cached price
            </div>
            {quote ? (
              <>
                <div className="num mt-0.5 text-lg font-semibold">
                  ₹{Number(quote.price).toLocaleString("en-IN")}
                </div>
                <div className="flex items-center gap-1.5">
                  <PnL value={Number(quote.change_pct)} suffix="%" />
                  <Badge tone={quote.freshness === "RECENT" ? "gain" : "warn"}>
                    {quote.freshness}
                  </Badge>
                </div>
              </>
            ) : (
              <div className="mt-1">
                <Badge tone="neutral">unavailable</Badge>
                <p className="mt-1 text-[11px] text-(--color-text-faint)">
                  Not in the quote cache — it joins automatically once held or traded.
                </p>
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
              Historical signals
            </div>
            <div className="num mt-0.5 text-lg font-semibold">{history.length}</div>
          </div>
        </div>
      </Card>

      <Card title={`Scanner signal history (${history.length})`}>
        {history.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            {symbol} has not appeared in any published scan yet.
          </p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Rank</th>
                <th className="pb-2 font-medium">Setup</th>
                <th className="pb-2 font-medium">Score</th>
                <th className="pb-2 text-right font-medium">Entry zone</th>
                <th className="pb-2 text-right font-medium">Stop</th>
                <th className="pb-2 text-right font-medium">T1 / T2</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const p = h.trade_plans;
                return (
                  <tr key={h.run_date} className="border-t border-(--color-border)">
                    <td className="num py-2">{h.run_date}</td>
                    <td className="num">#{h.rank}</td>
                    <td><Badge tone="accent">{h.setup_type}</Badge></td>
                    <td className="num">
                      {Number(h.score_total).toFixed(0)}{" "}
                      <span className="text-(--color-text-faint)">({h.score_tier})</span>
                    </td>
                    <td className="num text-right">
                      {p ? `₹${Number(p.entry_low).toLocaleString("en-IN")}–${Number(p.entry_high).toLocaleString("en-IN")}` : "—"}
                    </td>
                    <td className="num text-right text-(--color-loss)">
                      {p ? `₹${Number(p.stop).toLocaleString("en-IN")}` : "—"}
                    </td>
                    <td className="num text-right">
                      {p ? `₹${Number(p.t1).toLocaleString("en-IN")} / ₹${Number(p.t2).toLocaleString("en-IN")}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
