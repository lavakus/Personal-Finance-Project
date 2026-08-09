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
import Link from "next/link";

import { getIndexQuotes, type QuoteRow } from "@/lib/data/market";
import { getPortfolioSummary, isMigrationPending } from "@/lib/data/portfolio";
import {
  getLatestRegime,
  getLatestScan,
  type RegimeRow,
  type ScanRunRow,
} from "@/lib/data/scanner";
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
  let liveQuotes: QuoteRow[] | null = null;
  let liveScan: ScanRunRow | null = null;
  let liveRegime: RegimeRow | null = null;
  let scanReady = false;
  let migrationNotice = false;
  let liveNews: Array<{
    id: string;
    headline: string;
    url: string;
    sentiment: string;
    impact: string;
  }> | null = null;
  let liveEvents: Array<{
    id: string;
    symbol: string;
    event_type: string;
    event_date: string;
  }> | null = null;
  let liveBots: Array<{ id: string; name: string; online: boolean }> | null = null;
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
    try {
      liveQuotes = await getIndexQuotes(sb);
    } catch (e) {
      if (!isMigrationPending(e)) throw e;
      // 0004 pending — markets card falls back to its placeholder
    }
    try {
      [liveScan, liveRegime] = await Promise.all([
        getLatestScan(sb),
        getLatestRegime(sb),
      ]);
      scanReady = true;
    } catch (e) {
      if (!isMigrationPending(e)) throw e;
      // 0005 pending — setups card falls back to its placeholder
    }
    const [newsRes, eventsRes] = await Promise.all([
      sb
        .from("news_articles")
        .select("id, headline, url, sentiment, impact")
        .in("impact", ["HIGH", "MEDIUM"])
        .order("published_at", { ascending: false })
        .limit(6),
      sb
        .from("corporate_events")
        .select("id, symbol, event_type, event_date")
        .gte("event_date", new Date().toISOString().slice(0, 10))
        .order("event_date")
        .limit(6),
    ]);
    // errors here mean 0006 is pending — cards fall back to placeholders
    if (!newsRes.error) liveNews = newsRes.data;
    if (!eventsRes.error) liveEvents = eventsRes.data;

    const botsRes = await sb
      .from("bots")
      .select("id, name, last_heartbeat_at")
      .order("created_at")
      .limit(6);
    if (!botsRes.error) {
      liveBots = botsRes.data.map((b) => ({
        id: b.id,
        name: b.name,
        online: b.last_heartbeat_at
          ? Date.now() - new Date(b.last_heartbeat_at).getTime() < 30 * 60000
          : false,
      }));
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

      {/* market overview — live cached quotes since P4 */}
      <Card title="Markets" className="col-span-12 xl:col-span-7"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
        {!isDemoMode ? (
          liveQuotes === null ? (
            <PhasePending phase={4} what="Index quotes (migration 0004 pending)" />
          ) : liveQuotes.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-(--color-text-faint)">
              No quotes cached yet — run the market-data refresh from Settings.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {liveQuotes.map((q) => (
                <div key={q.index_code}>
                  <div className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                    {q.market_indices?.name ?? q.index_code}
                  </div>
                  <div className="num mt-0.5 text-sm font-semibold">
                    {Number(q.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <PnL value={Number(q.change_pct)} suffix="%" />
                    <Badge tone={q.freshness === "RECENT" ? "gain" : "warn"}>
                      {q.freshness.slice(0, 3)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : isDemoMode ? (
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
        ) : null}
      </Card>

      {/* top setups — live from the latest published scan since P5 */}
      <Card title="Top setups (scanner)" className="col-span-12 xl:col-span-7"
            action={
              isDemoMode ? (
                <Badge tone="demo">demo</Badge>
              ) : liveRegime ? (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                    regime
                  </span>
                  <Badge tone={liveRegime.label.includes("BULL") ? "gain" : liveRegime.label.includes("BEAR") ? "loss" : "warn"}>
                    {liveRegime.label}
                  </Badge>
                </div>
              ) : undefined
            }>
        {!isDemoMode ? (
          !scanReady ? (
            <PhasePending phase={5} what="The swingscan screener (migration 0005 pending)" />
          ) : !liveScan ? (
            <p className="py-4 text-center text-[13px] text-(--color-text-faint)">
              No scans published yet — trigger the daily-scan GitHub Action or
              run <span className="font-mono">python -m swingscan.publish</span>.
            </p>
          ) : liveScan.no_trade ? (
            <div className="py-4 text-center">
              <div className="font-bold tracking-wide text-(--color-warn)">
                NO HIGH-QUALITY SETUPS — {liveScan.run_date}
              </div>
              <p className="mt-1 text-[12px] text-(--color-text-dim)">
                {liveScan.no_trade_reason}
              </p>
            </div>
          ) : (
            <>
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                    <th className="pb-2 font-medium">Symbol</th>
                    <th className="pb-2 font-medium">Setup</th>
                    <th className="pb-2 font-medium">Score</th>
                    <th className="pb-2 text-right font-medium">Entry zone</th>
                    <th className="pb-2 text-right font-medium">Stop</th>
                    <th className="pb-2 text-right font-medium">T1 / T2</th>
                    <th className="pb-2 text-right font-medium">R:R</th>
                  </tr>
                </thead>
                <tbody>
                  {liveScan.stock_rankings.slice(0, 5).map((s) => {
                    const p = s.trade_plans;
                    return (
                      <tr key={s.id} className="border-t border-(--color-border)">
                        <td className="py-2 font-semibold">{s.symbol}</td>
                        <td><Badge tone="accent">{s.setup_type}</Badge></td>
                        <td className="num">
                          {Number(s.score_total).toFixed(0)}{" "}
                          <span className="text-(--color-text-faint)">({s.score_tier})</span>
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
                        <td className="num text-right">{p ? Number(p.rr1).toFixed(1) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-(--color-text-faint)">
                {liveScan.run_date} scan ·{" "}
                <Link href="/screener" className="text-(--color-accent) underline decoration-dotted">
                  full screener with explainable scores →
                </Link>
              </p>
            </>
          )
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

      {/* news — live since P6 */}
      <Card title="Important news" className="col-span-12 md:col-span-6 xl:col-span-4"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
        {!isDemoMode ? (
          liveNews === null ? (
            <PhasePending phase={6} what="News (migration 0006 pending)" />
          ) : liveNews.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-(--color-text-faint)">
              No high-impact news cached — refresh from Settings.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {liveNews.map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-3">
                  <a href={n.url} target="_blank" rel="noopener noreferrer"
                     className="text-[13px] leading-snug hover:text-(--color-accent)">
                    {n.headline}
                  </a>
                  <Badge tone={n.sentiment === "POSITIVE" ? "gain" : n.sentiment === "NEGATIVE" ? "loss" : "neutral"}>
                    {n.sentiment.slice(0, 3)}
                  </Badge>
                </li>
              ))}
            </ul>
          )
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

      {/* events — live since P6 */}
      <Card title="Upcoming events" className="col-span-12 md:col-span-6 xl:col-span-4"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
        {!isDemoMode ? (
          liveEvents === null ? (
            <PhasePending phase={6} what="Events (migration 0006 pending)" />
          ) : liveEvents.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-(--color-text-faint)">
              No upcoming events recorded — add them on the Events page.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {liveEvents.map((e) => {
                const d = Math.round(
                  (new Date(e.event_date).getTime() - Date.now()) / 86400000
                );
                return (
                  <li key={e.id} className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold">{e.symbol}</span>
                      <span className="ml-2 text-(--color-text-dim)">{e.event_type}</span>
                      <span className="ml-2 text-xs text-(--color-text-faint)">{e.event_date}</span>
                    </div>
                    <Badge tone={d <= 2 ? "warn" : "neutral"}>
                      {d <= 2 ? "HIGH" : `${d}d`}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )
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

      {/* bots — live since P8 */}
      <Card title="Bots" className="col-span-12 md:col-span-6 xl:col-span-4">
        {!isDemoMode ? (
          liveBots === null ? (
            <PhasePending phase={8} what="Bots (migration 0007 pending)" />
          ) : liveBots.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-(--color-text-faint)">
              No bots registered — set one up on the Bots page.
            </p>
          ) : (
            <ul className="space-y-2">
              {liveBots.map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded border border-(--color-border) bg-(--color-surface-2) px-3 py-2 text-[13px]">
                  <span className="font-semibold">{b.name}</span>
                  <Badge tone={b.online ? "gain" : "warn"}>
                    {b.online ? "ONLINE" : "STALE"}
                  </Badge>
                </li>
              ))}
            </ul>
          )
        ) : (
          <PhasePending phase={8} what="Bot ingestion API, equity curves and comparisons" />
        )}
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
