import { Badge, Card, PnL } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { getStrategies, getTrades, type TradeComputed } from "@/lib/data/trades";
import { demoActiveTrades } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

import { ExitTrade, NewTrade, ReviewTrade } from "./trade-forms";

export const dynamic = "force-dynamic";

/** Trade journal (brief §14–16). P&L and R are derived server-side from
 *  entry + exits; behavioral reviews build the personal trading database. */
export default async function TradesPage() {
  if (isDemoMode) {
    return (
      <Card title="Trades" action={<Badge tone="demo">demo</Badge>}>
        <ul className="space-y-2">
          {demoActiveTrades.map((t) => (
            <li key={t.symbol} className="flex items-center justify-between rounded border border-(--color-border) bg-(--color-surface-2) px-3 py-2 text-[13px]">
              <span className="font-semibold">{t.symbol}</span>
              <span>{t.pnl}</span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let trades: TradeComputed[];
  let strategies;
  try {
    [trades, strategies] = await Promise.all([getTrades(sb), getStrategies(sb)]);
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0003_trading.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  const strategyOpts = strategies.flatMap((s) =>
    (s.strategy_versions ?? []).map((v) => ({
      id: v.id,
      label: `${s.name} v${v.version}`,
    }))
  );

  const open = trades.filter((t) =>
    ["PLANNED", "ACTIVE", "PARTIALLY_CLOSED"].includes(t.row.status)
  );
  const closed = trades.filter(
    (t) => !["PLANNED", "ACTIVE", "PARTIALLY_CLOSED"].includes(t.row.status)
  );

  return (
    <div className="space-y-4">
      <NewTrade strategies={strategyOpts} />

      <Card title={`Open positions (${open.length})`}>
        {open.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            No open trades. NO TRADE is a position too.
          </p>
        ) : (
          <TradeTable trades={open} showActions />
        )}
      </Card>

      <Card title={`Closed (${closed.length})`}>
        {closed.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            Closed trades appear here with realized P&L, R multiples and reviews.
          </p>
        ) : (
          <TradeTable trades={closed} showActions />
        )}
      </Card>
    </div>
  );
}

function statusTone(s: string) {
  if (s === "ACTIVE") return "accent" as const;
  if (s === "PARTIALLY_CLOSED") return "warn" as const;
  if (s === "CLOSED") return "neutral" as const;
  if (s === "PLANNED") return "demo" as const;
  return "loss" as const;
}

function TradeTable({ trades, showActions }: { trades: TradeComputed[]; showActions?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
            <th className="pb-2 font-medium">Symbol</th>
            <th className="pb-2 font-medium">Dir</th>
            <th className="pb-2 font-medium">Status</th>
            <th className="pb-2 text-right font-medium">Entry</th>
            <th className="pb-2 text-right font-medium">Qty (rem.)</th>
            <th className="pb-2 text-right font-medium">Stop</th>
            <th className="pb-2 text-right font-medium">T1 / T2</th>
            <th className="pb-2 font-medium">Strategy</th>
            <th className="pb-2 text-right font-medium">Realized P&L</th>
            <th className="pb-2 text-right font-medium">R</th>
            <th className="pb-2 font-medium">Days</th>
            {showActions ? <th className="pb-2 font-medium">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const r = t.row;
            const canExit = ["ACTIVE", "PARTIALLY_CLOSED", "PLANNED"].includes(r.status);
            return (
              <tr key={r.id} className="border-t border-(--color-border) align-top">
                <td className="py-2">
                  <div className="font-semibold">{r.assets?.symbol ?? "?"}</div>
                  {r.setup ? <Badge tone="accent">{r.setup}</Badge> : null}
                </td>
                <td>
                  <Badge tone={r.direction === "LONG" ? "gain" : "loss"}>{r.direction}</Badge>
                </td>
                <td>
                  <Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge>
                </td>
                <td className="num py-2 text-right">{Number(r.entry_price).toLocaleString("en-IN")}</td>
                <td className="num py-2 text-right">
                  {r.quantity}
                  {t.remainingQty !== r.quantity ? (
                    <span className="text-(--color-text-faint)"> ({t.remainingQty})</span>
                  ) : null}
                </td>
                <td className="num py-2 text-right text-(--color-loss)">
                  {Number(r.stop_loss).toLocaleString("en-IN")}
                </td>
                <td className="num py-2 text-right">
                  {r.target1 ? Number(r.target1).toLocaleString("en-IN") : "—"}
                  {" / "}
                  {r.target2 ? Number(r.target2).toLocaleString("en-IN") : "—"}
                </td>
                <td className="py-2 text-[12px] text-(--color-text-dim)">
                  {r.strategy_versions
                    ? `${r.strategy_versions.strategies?.name ?? "?"} v${r.strategy_versions.version}`
                    : "—"}
                </td>
                <td className="num py-2 text-right">
                  {t.row.trade_exits.length > 0 ? <PnL value={Number(t.realizedPnl)} /> : "—"}
                </td>
                <td className="num py-2 text-right">
                  {t.row.trade_exits.length > 0 ? t.realizedR : "—"}
                </td>
                <td className="num py-2">{t.holdingDays}</td>
                {showActions ? (
                  <td className="py-2">
                    <div className="flex gap-1.5">
                      {canExit ? <ExitTrade tradeId={r.id} remaining={t.remainingQty} /> : null}
                      {r.status === "CLOSED" ? (
                        <ReviewTrade tradeId={r.id} done={Boolean(r.trade_reviews)} />
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
