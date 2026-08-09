import { Badge, Card, PnL, Stat } from "@/components/ui";
import {
  demoActiveTrades,
  demoEvents,
  demoMarkets,
  demoNews,
  demoPortfolio,
  demoRegime,
  demoSetups,
} from "@/lib/demo-data";
import { getPortfolioSummary, isMigrationPending } from "@/lib/data/portfolio";
import { getTrades, type TradeComputed } from "@/lib/data/trades";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Dashboard (brief §9). Each card switches from demo to live Supabase data
 * as its phase lands (portfolio→P2 ✓, trades→P3, markets→P4, setups→P5,
 * news/events→P6, bots→P8). Demo values are always labeled; live and demo
 * are never mixed.
 */
export default async function DashboardPage() {
  const fmtINR = (v: string) => `₹${Number(v).toLocaleString("en-IN")}`;

  let live = null;
  let liveTrades: TradeComputed[] | null = null;
  let migrationNotice = false;
  if (!isDemoMode) {
    const sb = await createServerSupabase();
    try {
      live = await getPortfolioSummary(sb);
    } catch (e) {
      if (!isMigrationPending(e)) throw e;
      migrationNotice = true;
    }
    try {
      liveTrades = (await getTrades(sb)).filter((t) =>
        ["ACTIVE", "PARTIALLY_CLOSED"].includes(t.row.status)
      );
    } catch (e) {
      if (!isMigrationPending(e)) throw e;
      // 0003 pending — trades card falls back to its placeholder
    }
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {migrationNotice ? (
        <div className="col-span-12 rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
          Database migration <span className="font-mono font-semibold">0002_portfolio.sql</span> has
          not been applied yet — run it in the Supabase SQL editor to activate
          portfolio &amp; transactions.
        </div>
      ) : null}

      {/* portfolio summary — live from the transaction ledger since P2 */}
      <Card title="Total portfolio" className="col-span-12 xl:col-span-5"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
        {migrationNotice ? (
          <PhasePending phase={2} what="Ledger-derived totals (migration pending)" />
        ) : (
        <>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Invested" value={fmtINR(live ? live.invested : demoPortfolio.invested)} />
          <Stat
            label="Current"
            value={
              live ? (
                live.currentValue !== null ? (
                  fmtINR(live.currentValue)
                ) : (
                  <span className="text-(--color-text-faint)">—</span>
                )
              ) : (
                fmtINR(demoPortfolio.currentValue)
              )
            }
          />
          <Stat
            label="Realized"
            value={<PnL value={Number(live ? live.realizedPnl : demoPortfolio.realizedPnl)} />}
          />
          <Stat
            label="Unrealized"
            value={
              live ? (
                live.unrealizedPnl !== null ? (
                  <PnL value={Number(live.unrealizedPnl)} />
                ) : (
                  <span className="text-(--color-text-faint)">—</span>
                )
              ) : (
                <PnL value={Number(demoPortfolio.unrealizedPnl)} />
              )
            }
          />
          <Stat
            label="Return"
            value={
              live ? (
                live.returnPct !== null ? (
                  <PnL value={Number(live.returnPct)} suffix="%" />
                ) : (
                  <span className="text-(--color-text-faint)">—</span>
                )
              ) : (
                <PnL value={Number(demoPortfolio.returnPct)} suffix="%" />
              )
            }
          />
        </div>
        {live && live.currentValue === null ? (
          <p className="mt-3 border-t border-(--color-border) pt-2 text-[11px] text-(--color-text-faint)">
            Current value &amp; unrealized P&amp;L need market prices — they go live
            with Phase 4 market data. Nothing here is ever estimated.
          </p>
        ) : null}
        </>
        )}
      </Card>

      {/* market overview */}
      <Card title="Markets" className="col-span-12 xl:col-span-7"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
        {isDemoMode ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {demoMarkets.map((m) => (
                <div key={m.label}>
                  <div className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                    {m.label}
                  </div>
                  <div className="num mt-0.5 text-sm font-semibold">{m.value}</div>
                  <PnL value={m.changePct} suffix="%" />
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-(--color-border) pt-3">
              <span className="text-[11px] uppercase tracking-wider text-(--color-text-faint)">
                Market regime
              </span>
              <Badge tone={demoRegime.regime.includes("BULL") ? "gain" : "warn"}>
                {demoRegime.regime}
              </Badge>
              <span className="num text-xs text-(--color-text-dim)">
                score {demoRegime.score > 0 ? "+" : ""}{demoRegime.score} · breadth {demoRegime.breadth}%
              </span>
            </div>
          </>
        ) : (
          <PhasePending phase={4} what="Live index, crypto and gold quotes" />
        )}
      </Card>

      {/* top setups */}
      <Card title="Top setups (scanner)" className="col-span-12 xl:col-span-7"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
        {!isDemoMode ? (
          <PhasePending phase={5} what="The swingscan screener with explainable scores" />
        ) : (
        <>
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
              <th className="pb-2 font-medium">Symbol</th>
              <th className="pb-2 font-medium">Setup</th>
              <th className="pb-2 font-medium">Score</th>
              <th className="pb-2 font-medium">Entry zone</th>
              <th className="pb-2 font-medium">Stop</th>
              <th className="pb-2 font-medium">T1 / T2</th>
              <th className="pb-2 font-medium">R:R</th>
            </tr>
          </thead>
          <tbody>
            {demoSetups.map((s) => (
              <tr key={s.symbol} className="border-t border-(--color-border)">
                <td className="py-2 font-semibold">{s.symbol}</td>
                <td><Badge tone="accent">{s.setup}</Badge></td>
                <td className="num">{s.score} <span className="text-(--color-text-faint)">({s.tier})</span></td>
                <td className="num">₹{s.entry}</td>
                <td className="num text-(--color-loss)">₹{s.stop}</td>
                <td className="num">₹{s.t1} / ₹{s.t2}</td>
                <td className="num">{s.rr1.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-(--color-text-faint)">
          Scores are explainable — click-through breakdown ships with the
          screener (Phase 5). NO TRADE is always a valid scanner output.
        </p>
        </>
        )}
      </Card>

      {/* active trades — live from the journal since P3 */}
      <Card title="Active trades" className="col-span-12 md:col-span-6 xl:col-span-5"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
        {!isDemoMode ? (
          liveTrades === null ? (
            <PhasePending phase={3} what="Your trade journal's open positions (migration 0003 pending)" />
          ) : liveTrades.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-(--color-text-faint)">
              No active trades. NO TRADE is a position too.
            </p>
          ) : (
            <div className="space-y-2">
              {liveTrades.map((t) => (
                <div key={t.row.id}
                     className="flex items-center justify-between rounded border border-(--color-border) bg-(--color-surface-2) px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{t.row.assets?.symbol ?? "?"}</span>
                    <Badge tone="neutral">{t.row.direction}</Badge>
                    <Badge tone={t.row.status === "ACTIVE" ? "accent" : "warn"}>
                      {t.row.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="num text-xs text-(--color-text-dim)">
                      entry {Number(t.row.entry_price).toLocaleString("en-IN")} · SL{" "}
                      {Number(t.row.stop_loss).toLocaleString("en-IN")}
                    </span>
                    <span className="num text-xs text-(--color-text-dim)">{t.holdingDays}d</span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
        <div className="space-y-2">
          {demoActiveTrades.map((t) => (
            <div key={t.symbol}
                 className="flex items-center justify-between rounded border border-(--color-border) bg-(--color-surface-2) px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{t.symbol}</span>
                <Badge tone="neutral">{t.direction}</Badge>
              </div>
              <div className="flex items-center gap-4">
                <span className={`num text-sm ${t.pnl.startsWith("+") ? "text-(--color-gain)" : "text-(--color-loss)"}`}>
                  {t.pnl}
                </span>
                <span className="num text-xs text-(--color-text-dim)">{t.r}R</span>
              </div>
            </div>
          ))}
        </div>
        )}
      </Card>

      {/* news */}
      <Card title="Important news" className="col-span-12 md:col-span-6 xl:col-span-4"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
        {!isDemoMode ? (
          <PhasePending phase={6} what="News with sentiment and stock mapping" />
        ) : (
        <ul className="space-y-2.5">
          {demoNews.map((n) => (
            <li key={n.headline} className="flex items-start justify-between gap-3">
              <span className="text-[13px] leading-snug">{n.headline}</span>
              <Badge tone={n.sentiment === "POSITIVE" ? "gain" : n.sentiment === "NEGATIVE" ? "loss" : "neutral"}>
                {n.sentiment.slice(0, 3)}
              </Badge>
            </li>
          ))}
        </ul>
        )}
      </Card>

      {/* events */}
      <Card title="Upcoming events" className="col-span-12 md:col-span-6 xl:col-span-4"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
        {!isDemoMode ? (
          <PhasePending phase={6} what="Corporate events and earnings risk" />
        ) : (
        <ul className="space-y-2.5">
          {demoEvents.map((e) => (
            <li key={e.symbol + e.event} className="flex items-center justify-between">
              <div>
                <span className="font-semibold">{e.symbol}</span>
                <span className="ml-2 text-(--color-text-dim)">{e.event}</span>
                <span className="ml-2 text-xs text-(--color-text-faint)">{e.when}</span>
              </div>
              <Badge tone={e.risk === "HIGH" ? "warn" : "neutral"}>{e.risk}</Badge>
            </li>
          ))}
        </ul>
        )}
      </Card>

      {/* bots placeholder */}
      <Card title="Bots" className="col-span-12 md:col-span-6 xl:col-span-4">
        <PhasePending phase={8} what="Bot ingestion API, equity curves and comparisons" />
      </Card>
    </div>
  );
}

/** Honest placeholder for cards whose phase hasn't landed — live mode never
 *  renders demo numbers (brief §83). */
function PhasePending({ phase, what }: { phase: number; what: string }) {
  return (
    <p className="py-4 text-center text-[13px] text-(--color-text-faint)">
      {what} arrive{what.endsWith("s") ? "" : "s"} in Phase {phase}.
    </p>
  );
}
