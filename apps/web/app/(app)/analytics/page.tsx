import { Badge, Card, PnL } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { getTrades, strategyPerformance } from "@/lib/data/trades";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Personal trading behavior analytics (brief §54–55). Everything here is
 *  computed ONLY from the user's real journal + reviews — no samples. */
export default async function AnalyticsPage() {
  if (isDemoMode) {
    return (
      <Card title="Analytics" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">Connect Supabase first.</p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let trades, reviews, regimes;
  try {
    [trades] = await Promise.all([getTrades(sb)]);
    const [r, g] = await Promise.all([
      sb
        .from("trade_reviews")
        .select(
          "trade_id, followed_strategy, followed_entry, respected_stop, followed_target, exited_early, chased_entry, moved_stop, emotion, lessons"
        ),
      sb.from("market_regime_history").select("date, label"),
    ]);
    reviews = r.data ?? [];
    regimes = g.data ?? [];
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Migrations 0003/0005 are not applied yet — run them in the Supabase SQL editor.
      </div>
    );
  }

  const closed = trades.filter((t) => t.row.status === "CLOSED");

  if (closed.length === 0 && reviews.length === 0) {
    return (
      <Card title="Personal trading behavior">
        <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
          Close trades and fill their reviews — behavior analytics compute
          only from your real trading data (brief §54), so there is nothing
          to show yet.
        </p>
      </Card>
    );
  }

  // behavior rates from reviews
  const rate = (key: string) => {
    const answered = reviews.filter(
      (r) => (r as Record<string, unknown>)[key] !== null
    );
    if (answered.length === 0) return null;
    const yes = answered.filter((r) => (r as Record<string, unknown>)[key] === true).length;
    return { pct: (yes / answered.length) * 100, n: answered.length };
  };
  const behaviors: Array<{ label: string; key: string; bad: boolean }> = [
    { label: "Followed the strategy", key: "followed_strategy", bad: false },
    { label: "Followed the entry plan", key: "followed_entry", bad: false },
    { label: "Respected the stop loss", key: "respected_stop", bad: false },
    { label: "Followed the target plan", key: "followed_target", bad: false },
    { label: "Exited early", key: "exited_early", bad: true },
    { label: "Chased the entry", key: "chased_entry", bad: true },
    { label: "Moved the stop loss", key: "moved_stop", bad: true },
  ];

  // performance by market regime at entry (brief §55)
  const regimeByDate = new Map(regimes.map((r) => [r.date, r.label]));
  const byRegime = new Map<string, { pnl: number; n: number; wins: number }>();
  for (const t of closed) {
    const label = regimeByDate.get(t.row.entry_date) ?? "UNKNOWN";
    const g = byRegime.get(label) ?? { pnl: 0, n: 0, wins: 0 };
    g.pnl += Number(t.realizedPnl);
    g.n += 1;
    if (Number(t.realizedPnl) > 0) g.wins += 1;
    byRegime.set(label, g);
  }

  const perf = strategyPerformance(trades);

  return (
    <div className="space-y-4">
      <Card title={`Your trading behavior (${reviews.length} reviewed trades)`}>
        {reviews.length === 0 ? (
          <p className="text-[13px] text-(--color-text-faint)">
            No reviews yet — review closed trades on the Trades page.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {behaviors.map((b) => {
              const r = rate(b.key);
              if (!r) return null;
              const alarming = b.bad ? r.pct >= 25 : r.pct <= 60;
              return (
                <div key={b.key} className="flex items-center justify-between rounded border border-(--color-border) bg-(--color-surface-2) px-3 py-2">
                  <span className="text-[13px]">{b.label}</span>
                  <span className={`num text-sm font-semibold ${alarming ? "text-(--color-warn)" : "text-(--color-text)"}`}>
                    {r.pct.toFixed(0)}%
                    <span className="ml-1 text-[10px] text-(--color-text-faint)">of {r.n}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Performance by market regime at entry">
        {byRegime.size === 0 ? (
          <p className="text-[13px] text-(--color-text-faint)">
            Needs closed trades + published regime history for their entry dates.
          </p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                <th className="pb-2 font-medium">Regime</th>
                <th className="pb-2 text-right font-medium">Trades</th>
                <th className="pb-2 text-right font-medium">Win rate</th>
                <th className="pb-2 text-right font-medium">Net P&L</th>
              </tr>
            </thead>
            <tbody>
              {[...byRegime.entries()].map(([label, g]) => (
                <tr key={label} className="border-t border-(--color-border)">
                  <td className="py-2">
                    <Badge tone={label.includes("BULL") ? "gain" : label === "UNKNOWN" ? "neutral" : "warn"}>
                      {label}
                    </Badge>
                  </td>
                  <td className="num text-right">{g.n}</td>
                  <td className="num text-right">{((g.wins / g.n) * 100).toFixed(0)}%</td>
                  <td className="num text-right"><PnL value={g.pnl} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Strategy expectancy (closed trades)">
        {perf.size === 0 ? (
          <p className="text-[13px] text-(--color-text-faint)">
            Attach strategies to trades to see which ones actually make money.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {[...perf.values()].map(({ name, stats }) => (
              <div key={name} className="rounded border border-(--color-border) bg-(--color-surface-2) p-3">
                <div className="font-semibold">{name}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-[12px] text-(--color-text-dim)">
                  <span>{stats.trades} trades</span>
                  <span>{stats.winRate.toFixed(0)}% win</span>
                  <span>PF {stats.profitFactor.toFixed(2)}</span>
                  <span>
                    exp <PnL value={stats.expectancy.toNumber()} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
