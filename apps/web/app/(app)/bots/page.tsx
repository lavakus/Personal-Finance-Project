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

/** One executed trade. The bots table above shows only aggregates, which made
 *  a live bot look idle: you could see "3 trades, 33% win" but not what it
 *  bought, when, or why it closed. Every field below is already stored by the
 *  sink -- this just renders it. */
interface TradeRow {
  id: string;
  symbol: string;
  direction: string;
  status: string;
  entry_price: string;
  exit_price: string | null;
  quantity: string;
  pnl: string | null;
  opened_at: string;
  closed_at: string | null;
  raw: {
    setup?: string;
    reason?: string;
    exit_reason?: string;
    r_multiple?: number;
    risk_usd?: number;
    initial_stop?: number;
  } | null;
  bots: { name: string } | null;
}

function heldFor(openedAt: string, closedAt: string | null): string {
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const hours = (end - new Date(openedAt).getTime()) / 3_600_000;
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
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

  // Separate query: the nested bot_trades above is unordered and unlimited,
  // which is fine for aggregates but wrong for a log.
  let trades: TradeRow[] = [];
  try {
    const { data, error } = await sb
      .from("bot_trades")
      .select(
        `id, symbol, direction, status, entry_price, exit_price, quantity,
         pnl, opened_at, closed_at, raw, bots (name)`
      )
      .order("opened_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    trades = data as unknown as TradeRow[];
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
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

      {trades.length > 0 && (
        <Card title={`Trade log (${trades.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-(--color-text-faint)">
                  <th className="pb-2 font-medium">Opened</th>
                  <th className="pb-2 font-medium">Symbol</th>
                  <th className="pb-2 font-medium">Setup</th>
                  <th className="pb-2 font-medium">Dir</th>
                  <th className="pb-2 text-right font-medium">Entry</th>
                  <th className="pb-2 text-right font-medium">Stop</th>
                  <th className="pb-2 text-right font-medium">Exit</th>
                  <th className="pb-2 text-right font-medium">Lots</th>
                  <th className="pb-2 text-right font-medium">Held</th>
                  <th className="pb-2 text-right font-medium">R</th>
                  <th className="pb-2 text-right font-medium">P&L</th>
                  <th className="pb-2 font-medium">Closed by</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const open = t.status !== "CLOSED";
                  const r = t.raw?.r_multiple;
                  return (
                    <tr key={t.id} className="border-t border-(--color-border)">
                      <td className="py-2 whitespace-nowrap text-[12px] text-(--color-text-dim)">
                        {new Date(t.opened_at).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="font-semibold">{t.symbol}</td>
                      <td className="text-[12px] text-(--color-text-dim)">
                        {t.raw?.setup ?? "—"}
                      </td>
                      <td>
                        <Badge tone={t.direction === "LONG" ? "gain" : "loss"}>
                          {t.direction}
                        </Badge>
                      </td>
                      <td className="num text-right">{Number(t.entry_price)}</td>
                      <td className="num text-right text-(--color-text-faint)">
                        {t.raw?.initial_stop
                          ? Number(t.raw.initial_stop).toFixed(2)
                          : "—"}
                      </td>
                      <td className="num text-right">
                        {t.exit_price !== null ? Number(t.exit_price) : "—"}
                      </td>
                      <td className="num text-right">{Number(t.quantity)}</td>
                      <td className="num text-right text-(--color-text-dim)">
                        {heldFor(t.opened_at, t.closed_at)}
                      </td>
                      <td className="num text-right">
                        {typeof r === "number" ? (
                          <PnL value={r} suffix="R" />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num text-right">
                        {t.pnl !== null ? <PnL value={Number(t.pnl)} /> : "—"}
                      </td>
                      <td className="text-[12px]">
                        {open ? (
                          <Badge tone="warn">OPEN</Badge>
                        ) : (
                          <span className="text-(--color-text-dim)">
                            {t.raw?.exit_reason ?? "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-(--color-text-faint)">
            Last 50 trades as reported by the bots. R is measured against the
            initial stop; an open trade shows no R or P&L until it closes.
          </p>
        </Card>
      )}
    </div>
  );
}
