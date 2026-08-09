import { Badge, Card, PnL } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { getStrategies, getTrades, strategyPerformance } from "@/lib/data/trades";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Strategies + versions (brief §17) and per-strategy performance from
 *  CLOSED trades only (brief §56). Backtests are labeled separately —
 *  this page shows real journal results. */
export default async function StrategiesPage() {
  if (isDemoMode) {
    return (
      <Card title="Strategies" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">
          Connect Supabase to manage strategies and see live performance.
        </p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let strategies, trades;
  try {
    [strategies, trades] = await Promise.all([getStrategies(sb), getTrades(sb)]);
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0003_trading.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  const perf = strategyPerformance(trades);

  return (
    <div className="space-y-4">
      <Card title="Strategies & versions">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {strategies.map((s) => (
            <div key={s.id} className="rounded border border-(--color-border) bg-(--color-surface-2) p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{s.name}</span>
                <Badge tone={s.user_id ? "accent" : "neutral"}>
                  {s.user_id ? "personal" : "system"}
                </Badge>
              </div>
              {s.description ? (
                <p className="mt-1 text-[12px] text-(--color-text-dim)">{s.description}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(s.strategy_versions ?? [])
                  .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
                  .map((v) => (
                    <Badge key={v.id} tone="neutral">v{v.version}</Badge>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Performance by strategy (closed trades)">
        {perf.size === 0 ? (
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            Close trades with a strategy attached and per-strategy stats appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                  <th className="pb-2 font-medium">Strategy</th>
                  <th className="pb-2 text-right font-medium">Trades</th>
                  <th className="pb-2 text-right font-medium">Win rate</th>
                  <th className="pb-2 text-right font-medium">Avg winner</th>
                  <th className="pb-2 text-right font-medium">Avg loser</th>
                  <th className="pb-2 text-right font-medium">Profit factor</th>
                  <th className="pb-2 text-right font-medium">Expectancy</th>
                  <th className="pb-2 text-right font-medium">Avg R</th>
                  <th className="pb-2 text-right font-medium">Avg days</th>
                </tr>
              </thead>
              <tbody>
                {[...perf.values()].map(({ name, stats }) => (
                  <tr key={name} className="border-t border-(--color-border)">
                    <td className="py-2 font-semibold">{name}</td>
                    <td className="num text-right">
                      {stats.trades}
                      <span className="text-(--color-text-faint)"> ({stats.wins}W/{stats.losses}L)</span>
                    </td>
                    <td className="num text-right">{stats.winRate.toFixed(0)}%</td>
                    <td className="num text-right"><PnL value={stats.avgWinner.toNumber()} /></td>
                    <td className="num text-right"><PnL value={stats.avgLoser.toNumber()} /></td>
                    <td className="num text-right">{stats.profitFactor.toFixed(2)}</td>
                    <td className="num text-right"><PnL value={stats.expectancy.toNumber()} /></td>
                    <td className="num text-right">{stats.avgR.toFixed(2)}</td>
                    <td className="num text-right">{stats.avgHoldingDays.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
