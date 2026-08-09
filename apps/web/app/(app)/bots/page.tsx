import { d, strategyStats } from "@tradeos/calculations";

import { Badge, Card, PnL } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

import { NewBot } from "./bot-form";

export const dynamic = "force-dynamic";

interface BotRow {
  id: string;
  name: string;
  strategy: string | null;
  is_active: boolean;
  last_heartbeat_at: string | null;
  bot_trades: Array<{
    status: string;
    pnl: string | null;
    fees: string;
    opened_at: string;
    closed_at: string | null;
  }>;
  bot_equity_snapshots: Array<{ equity: string; as_of: string }>;
}

/** Bots + analytics (brief §63, §65). All stats derive from ingested
 *  trades — never self-reported summaries. */
export default async function BotsPage() {
  if (isDemoMode) {
    return (
      <Card title="Bots" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">Connect Supabase first.</p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let bots: BotRow[];
  try {
    const { data, error } = await sb
      .from("bots")
      .select(
        `id, name, strategy, is_active, last_heartbeat_at,
         bot_trades (status, pnl, fees, opened_at, closed_at),
         bot_equity_snapshots (equity, as_of)`
      )
      .order("created_at");
    if (error) throw new Error(error.message);
    bots = data as unknown as BotRow[];
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0007_bots_alerts.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  const now = Date.now();

  return (
    <div className="space-y-4">
      <Card title="Register a bot">
        <NewBot />
      </Card>

      {bots.length === 0 ? (
        <Card title="Bots">
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            No bots registered yet.
          </p>
        </Card>
      ) : (
        <Card title={`Bot comparison (${bots.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                  <th className="pb-2 font-medium">Bot</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Trades</th>
                  <th className="pb-2 text-right font-medium">Win rate</th>
                  <th className="pb-2 text-right font-medium">Total P&L</th>
                  <th className="pb-2 text-right font-medium">Profit factor</th>
                  <th className="pb-2 text-right font-medium">Expectancy</th>
                  <th className="pb-2 text-right font-medium">Latest equity</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((b) => {
                  const closed = b.bot_trades.filter(
                    (t) => t.status === "CLOSED" && t.pnl !== null
                  );
                  const stats = strategyStats(
                    closed.map((t) => {
                      const days =
                        t.closed_at && t.opened_at
                          ? Math.max(
                              0,
                              Math.round(
                                (new Date(t.closed_at).getTime() -
                                  new Date(t.opened_at).getTime()) /
                                  86400000
                              )
                            )
                          : 0;
                      return { netPnl: t.pnl as string, r: 0, holdingDays: days };
                    })
                  );
                  const totalPnl = closed.reduce(
                    (a, t) => a.plus(d(t.pnl as string)),
                    d(0)
                  );
                  const heartbeatAge = b.last_heartbeat_at
                    ? (now - new Date(b.last_heartbeat_at).getTime()) / 60000
                    : null;
                  const online = heartbeatAge !== null && heartbeatAge < 30;
                  const latestEquity = [...b.bot_equity_snapshots].sort((x, y) =>
                    y.as_of.localeCompare(x.as_of)
                  )[0];
                  return (
                    <tr key={b.id} className="border-t border-(--color-border)">
                      <td className="py-2">
                        <div className="font-semibold">{b.name}</div>
                        <div className="text-[11px] text-(--color-text-faint)">
                          {b.strategy ?? "—"}
                        </div>
                      </td>
                      <td>
                        <Badge tone={online ? "gain" : "warn"}>
                          {online
                            ? "ONLINE"
                            : b.last_heartbeat_at
                              ? "STALE"
                              : "NO HEARTBEAT"}
                        </Badge>
                      </td>
                      <td className="num text-right">
                        {closed.length}
                        <span className="text-(--color-text-faint)">
                          {" "}
                          ({b.bot_trades.length - closed.length} open)
                        </span>
                      </td>
                      <td className="num text-right">
                        {closed.length ? `${stats.winRate.toFixed(0)}%` : "—"}
                      </td>
                      <td className="num text-right">
                        {closed.length ? <PnL value={totalPnl.toNumber()} /> : "—"}
                      </td>
                      <td className="num text-right">
                        {closed.length ? stats.profitFactor.toFixed(2) : "—"}
                      </td>
                      <td className="num text-right">
                        {closed.length ? <PnL value={stats.expectancy.toNumber()} /> : "—"}
                      </td>
                      <td className="num text-right">
                        {latestEquity
                          ? Number(latestEquity.equity).toLocaleString("en-IN")
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-(--color-text-faint)">
            Stats are computed from ingested closed trades only. Sharpe and
            drawdown activate once equity snapshots accumulate.
          </p>
        </Card>
      )}
    </div>
  );
}
