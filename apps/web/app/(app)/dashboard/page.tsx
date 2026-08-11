import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import {
  Badge,
  Card,
  Empty,
  Meter,
  NoData,
  PnL,
  Stat,
  Table,
} from "@/components/ui";
import { getIndexQuotes, type QuoteRow } from "@/lib/data/market";
import { getPortfolioSummary, isMigrationPending } from "@/lib/data/portfolio";
import {
  getLatestRegime,
  getLatestScan,
  type RegimeRow,
  type ScanRunRow,
} from "@/lib/data/scanner";
import { getTrades, type TradeComputed } from "@/lib/data/trades";
import {
  demoActiveTrades,
  demoEvents,
  demoMarkets,
  demoNews,
  demoPortfolio,
  demoRegime,
  demoSetups,
} from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const inr = (v: string | number) =>
  `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * Dashboard (brief §9). Each card switches from demo to live Supabase data
 * as its phase lands. Demo values are always labeled; live and demo are
 * never mixed, and a value we don't have renders as NoData rather than 0.
 */
export default async function DashboardPage() {
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
  let scanError: string | null = null;

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
    }
    try {
      liveQuotes = await getIndexQuotes(sb);
    } catch (e) {
      if (!isMigrationPending(e)) throw e;
    }
    try {
      [liveScan, liveRegime] = await Promise.all([
        getLatestScan(sb),
        getLatestRegime(sb),
      ]);
      scanReady = true;
    } catch (e) {
      if (!isMigrationPending(e)) throw e;
      // Keep the reason. A bare "apply a migration" notice once hid a real
      // regression (the query asked for a column that no migration provided)
      // and the dashboard silently showed a placeholder over live scan data.
      scanError = e instanceof Error ? e.message : String(e);
    }
    const [newsRes, eventsRes, botsRes] = await Promise.all([
      sb
        .from("news_articles")
        .select("id, headline, url, sentiment, impact")
        .in("impact", ["HIGH", "MEDIUM"])
        .order("published_at", { ascending: false })
        .limit(5),
      sb
        .from("corporate_events")
        .select("id, symbol, event_type, event_date")
        .gte("event_date", new Date().toISOString().slice(0, 10))
        .order("event_date")
        .limit(5),
      sb.from("bots").select("id, name, last_heartbeat_at").order("created_at").limit(6),
    ]);
    if (!newsRes.error) liveNews = newsRes.data;
    if (!eventsRes.error) liveEvents = eventsRes.data;
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

  const p = live ?? null;
  const regimeLabel = liveRegime?.label ?? (isDemoMode ? demoRegime.regime : null);
  const regimeTone = regimeLabel?.includes("BULL")
    ? "gain"
    : regimeLabel?.includes("BEAR")
      ? "loss"
      : "warn";

  return (
    <div className="space-y-4">
      {migrationNotice ? (
        <div className="rise rounded-xl border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
          Database migration{" "}
          <span className="font-mono font-semibold">0002_portfolio.sql</span> has not
          been applied yet — run it in the Supabase SQL editor to activate portfolio
          &amp; transactions.
        </div>
      ) : null}

      {/* ── HERO: the numbers that answer "where is my money" ──────────── */}
      <section
        className="elev-2 rise relative overflow-hidden rounded-xl border border-(--color-border) bg-linear-to-br from-(--color-surface) via-(--color-surface) to-(--color-surface-2) p-5"
        style={{ "--d": "0ms" } as React.CSSProperties}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="label">Total portfolio</h2>
            {isDemoMode ? <Badge tone="demo">demo</Badge> : null}
          </div>
          <div className="flex items-center gap-2">
            {regimeLabel ? (
              <>
                <span className="label">Market regime</span>
                <Badge tone={regimeTone} dot>
                  {regimeLabel}
                </Badge>
              </>
            ) : null}
            <Link
              href="/portfolio"
              className="group inline-flex items-center gap-1 text-[11px] font-medium text-(--color-accent) transition-opacity hover:opacity-80"
            >
              Holdings
              <ArrowUpRight
                size={12}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </div>
        </div>

        {migrationNotice ? (
          <Empty>Ledger-derived totals activate once migration 0002 is applied.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-5">
              <Stat
                size="lg"
                label="Invested"
                value={inr(p ? p.invested : demoPortfolio.invested)}
              />
              <Stat
                size="lg"
                label="Current value"
                value={
                  p ? (
                    p.currentValue !== null ? (
                      inr(p.currentValue)
                    ) : (
                      <NoData hint="Needs market prices" />
                    )
                  ) : (
                    inr(demoPortfolio.currentValue)
                  )
                }
              />
              <Stat
                size="lg"
                label="Unrealized"
                value={
                  p ? (
                    p.unrealizedPnl !== null ? (
                      <PnL value={Number(p.unrealizedPnl)} arrow />
                    ) : (
                      <NoData hint="Needs market prices" />
                    )
                  ) : (
                    <PnL value={Number(demoPortfolio.unrealizedPnl)} arrow />
                  )
                }
              />
              <Stat
                size="lg"
                label="Realized"
                value={<PnL value={Number(p ? p.realizedPnl : demoPortfolio.realizedPnl)} />}
              />
              <Stat
                size="lg"
                label="Return"
                value={
                  p ? (
                    p.returnPct !== null ? (
                      <PnL value={Number(p.returnPct)} suffix="%" arrow />
                    ) : (
                      <NoData hint="Needs market prices" />
                    )
                  ) : (
                    <PnL value={Number(demoPortfolio.returnPct)} suffix="%" arrow />
                  )
                }
              />
            </div>
            {p && p.currentValue === null ? (
              <p className="mt-4 border-t border-(--color-border) pt-3 text-[11px] text-(--color-text-faint)">
                Current value &amp; unrealized P&amp;L need market prices — run the
                refresh in Settings. Nothing here is ever estimated.
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* ── MARKET STRIP ───────────────────────────────────────────────── */}
      <Card title="Markets" delay={1} action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
        {isDemoMode ? (
          <QuoteGrid
            items={demoMarkets.map((m) => ({
              key: m.label,
              name: m.label,
              value: m.value,
              changePct: m.changePct,
              freshness: m.freshness,
            }))}
          />
        ) : liveQuotes === null ? (
          <Empty>Index quotes activate once migration 0004 is applied.</Empty>
        ) : liveQuotes.length === 0 ? (
          <Empty>
            No quotes cached yet — run “Refresh market data” in Settings.
          </Empty>
        ) : (
          <QuoteGrid
            items={liveQuotes.map((q) => ({
              key: q.index_code ?? "",
              name: q.market_indices?.name ?? q.index_code ?? "?",
              value: Number(q.price).toLocaleString("en-IN", {
                maximumFractionDigits: 2,
              }),
              changePct: Number(q.change_pct),
              freshness: q.freshness,
            }))}
          />
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* ── TOP SETUPS (widest — it's the product's core output) ──────── */}
        <Card
          title="Top setups"
          delay={2}
          flush
          className="xl:col-span-2"
          action={
            isDemoMode ? (
              <Badge tone="demo">demo</Badge>
            ) : liveScan && !liveScan.no_trade ? (
              <Link
                href="/screener"
                className="text-[11px] font-medium text-(--color-accent) hover:opacity-80"
              >
                Full screener →
              </Link>
            ) : undefined
          }
        >
          {!isDemoMode && !scanReady ? (
            <Empty>
              Scan read failed — apply pending migrations in the Supabase SQL
              editor, then reload.
              {scanError ? (
                <span className="mt-1 block font-mono text-[11px] opacity-70">
                  {scanError}
                </span>
              ) : null}
            </Empty>
          ) : !isDemoMode && !liveScan ? (
            <Empty>
              No scans published yet — trigger the daily-scan action or run{" "}
              <span className="font-mono">python -m swingscan.publish</span>.
            </Empty>
          ) : !isDemoMode && liveScan?.no_trade ? (
            <div className="px-4 py-10 text-center">
              <div className="text-base font-semibold tracking-wide text-(--color-warn)">
                NO HIGH-QUALITY SETUPS
              </div>
              <p className="mx-auto mt-2 max-w-md text-[13px] text-(--color-text-dim)">
                {liveScan.no_trade_reason}
              </p>
              <p className="mt-2 text-[11px] text-(--color-text-faint)">
                Cash is a position — the scanner never forces a recommendation.
              </p>
            </div>
          ) : (
            <>
              <Table
                head={
                  <>
                    <th>Symbol</th>
                    <th>Setup</th>
                    <th>Score</th>
                    <th className="text-right">Entry zone</th>
                    <th className="text-right">Stop</th>
                    <th className="text-right">T1 / T2</th>
                    <th className="text-right">R:R</th>
                  </>
                }
              >
                {(isDemoMode
                  ? demoSetups.map((s) => ({
                      id: s.symbol,
                      symbol: s.symbol,
                      setup: s.setup,
                      score: s.score,
                      tier: s.tier,
                      entry: `₹${s.entry}`,
                      stop: `₹${s.stop}`,
                      targets: `₹${s.t1} / ₹${s.t2}`,
                      rr: s.rr1.toFixed(1),
                    }))
                  : (liveScan?.stock_rankings ?? []).slice(0, 6).map((s) => {
                      const pl = s.trade_plans;
                      return {
                        id: s.id,
                        symbol: s.symbol,
                        setup: s.setup_type,
                        score: Number(s.score_total),
                        tier: s.score_tier,
                        entry: pl
                          ? `₹${Number(pl.entry_low).toLocaleString("en-IN")}–${Number(pl.entry_high).toLocaleString("en-IN")}`
                          : "—",
                        stop: pl ? `₹${Number(pl.stop).toLocaleString("en-IN")}` : "—",
                        targets: pl
                          ? `₹${Number(pl.t1).toLocaleString("en-IN")} / ₹${Number(pl.t2).toLocaleString("en-IN")}`
                          : "—",
                        rr: pl ? Number(pl.rr1).toFixed(1) : "—",
                      };
                    })
                ).map((s) => (
                  <tr key={s.id}>
                    <td className="font-semibold">{s.symbol}</td>
                    <td>
                      <Badge tone="accent">{s.setup}</Badge>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="num w-7 font-semibold">{s.score.toFixed(0)}</span>
                        <Meter
                          pct={s.score}
                          tone={s.score >= 75 ? "gain" : s.score >= 60 ? "accent" : "warn"}
                          className="w-14"
                        />
                        <span className="text-[10px] text-(--color-text-faint)">{s.tier}</span>
                      </div>
                    </td>
                    <td className="num text-right">{s.entry}</td>
                    <td className="num text-right text-(--color-loss)">{s.stop}</td>
                    <td className="num text-right">{s.targets}</td>
                    <td className="num text-right">{s.rr}</td>
                  </tr>
                ))}
              </Table>
              <p className="px-4 py-3 text-[11px] text-(--color-text-faint)">
                Scores are explainable — open the screener for the component
                breakdown. Plans are analysis, not instructions.
              </p>
            </>
          )}
        </Card>

        {/* ── ACTIVE TRADES ────────────────────────────────────────────── */}
        <Card
          title="Active trades"
          delay={3}
          action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}
        >
          {isDemoMode ? (
            <ul className="space-y-2">
              {demoActiveTrades.map((t) => (
                <li
                  key={t.symbol}
                  className="flex items-center justify-between rounded-lg border border-(--color-border) bg-(--color-surface-2) px-3 py-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{t.symbol}</span>
                    <Badge tone="neutral">{t.direction}</Badge>
                  </span>
                  <span className="flex items-center gap-3">
                    <span
                      className={`num text-sm ${t.pnl.startsWith("+") ? "text-(--color-gain)" : "text-(--color-loss)"}`}
                    >
                      {t.pnl}
                    </span>
                    <span className="num text-xs text-(--color-text-dim)">{t.r}R</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : liveTrades === null ? (
            <Empty>Activates once migration 0003 is applied.</Empty>
          ) : liveTrades.length === 0 ? (
            <Empty>No open trades. NO TRADE is a position too.</Empty>
          ) : (
            <ul className="space-y-2">
              {liveTrades.map((t) => (
                <li
                  key={t.row.id}
                  className="rounded-lg border border-(--color-border) bg-(--color-surface-2) px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold">{t.row.assets?.symbol ?? "?"}</span>
                      <Badge tone={t.row.direction === "LONG" ? "gain" : "loss"}>
                        {t.row.direction}
                      </Badge>
                    </span>
                    <span className="num text-xs text-(--color-text-faint)">
                      {t.holdingDays}d / 15
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-(--color-text-dim)">
                    <span className="num">
                      entry {Number(t.row.entry_price).toLocaleString("en-IN")} · SL{" "}
                      {Number(t.row.stop_loss).toLocaleString("en-IN")}
                    </span>
                    <Badge tone={t.row.status === "ACTIVE" ? "accent" : "warn"}>
                      {t.row.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <Meter
                    pct={(t.holdingDays / 15) * 100}
                    tone={t.holdingDays >= 13 ? "warn" : "accent"}
                    className="mt-2"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* ── NEWS ─────────────────────────────────────────────────────── */}
        <Card
          title="Important news"
          delay={4}
          action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}
        >
          {isDemoMode ? (
            <NewsList
              items={demoNews.map((n, i) => ({
                id: String(i),
                headline: n.headline,
                url: null,
                sentiment: n.sentiment,
                impact: n.impact,
              }))}
            />
          ) : liveNews === null ? (
            <Empty>Activates once migration 0006 is applied.</Empty>
          ) : liveNews.length === 0 ? (
            <Empty>No high-impact news cached — refresh from Settings.</Empty>
          ) : (
            <NewsList items={liveNews} />
          )}
        </Card>

        {/* ── EVENTS ───────────────────────────────────────────────────── */}
        <Card
          title="Upcoming events"
          delay={5}
          action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}
        >
          {isDemoMode ? (
            <ul className="space-y-2.5">
              {demoEvents.map((e) => (
                <li key={e.symbol + e.event} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-semibold">{e.symbol}</span>
                    <span className="ml-2 text-(--color-text-dim)">{e.event}</span>
                    <span className="ml-2 text-xs text-(--color-text-faint)">{e.when}</span>
                  </span>
                  <Badge tone={e.risk === "HIGH" ? "warn" : "neutral"}>{e.risk}</Badge>
                </li>
              ))}
            </ul>
          ) : liveEvents === null ? (
            <Empty>Activates once migration 0006 is applied.</Empty>
          ) : liveEvents.length === 0 ? (
            <Empty>No upcoming events recorded — add them on the Events page.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {liveEvents.map((e) => {
                const days = Math.round(
                  (new Date(e.event_date).getTime() - Date.now()) / 86400000
                );
                return (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{e.symbol}</span>
                      <span className="ml-2 text-(--color-text-dim)">{e.event_type}</span>
                      <span className="num ml-2 text-xs text-(--color-text-faint)">
                        {e.event_date}
                      </span>
                    </span>
                    <Badge tone={days <= 2 ? "warn" : "neutral"}>
                      {days <= 0 ? "today" : `${days}d`}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ── BOTS ─────────────────────────────────────────────────────── */}
        <Card
          title="Bots"
          delay={6}
          action={
            !isDemoMode && liveBots?.length ? (
              <Link
                href="/bots"
                className="text-[11px] font-medium text-(--color-accent) hover:opacity-80"
              >
                Analytics →
              </Link>
            ) : undefined
          }
        >
          {isDemoMode ? (
            <Empty>Bot ingestion, equity curves and comparisons arrive in Phase 8.</Empty>
          ) : liveBots === null ? (
            <Empty>Activates once migration 0007 is applied.</Empty>
          ) : liveBots.length === 0 ? (
            <Empty>No bots registered — set one up on the Bots page.</Empty>
          ) : (
            <ul className="space-y-2">
              {liveBots.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between rounded-lg border border-(--color-border) bg-(--color-surface-2) px-3 py-2"
                >
                  <span className="truncate font-medium">{b.name}</span>
                  <Badge tone={b.online ? "gain" : "warn"} dot>
                    {b.online ? "online" : "idle"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function QuoteGrid({
  items,
}: {
  items: Array<{
    key: string;
    name: string;
    value: string;
    changePct: number;
    freshness: string;
  }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 xl:grid-cols-8">
      {items.map((m) => (
        <div key={m.key} className="min-w-0">
          <div className="label truncate" title={m.name}>
            {m.name}
          </div>
          <div className="num mt-1 truncate text-[15px] font-semibold">{m.value}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <PnL value={m.changePct} suffix="%" arrow className="text-xs" />
            {m.freshness !== "RECENT" ? (
              <span
                className="text-[9px] uppercase text-(--color-warn)"
                title="Delayed or stale — refresh market data"
              >
                {m.freshness.slice(0, 5)}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewsList({
  items,
}: {
  items: Array<{
    id: string;
    headline: string;
    url: string | null;
    sentiment: string;
    impact: string;
  }>;
}) {
  return (
    <ul className="space-y-3">
      {items.map((n) => (
        <li key={n.id} className="flex items-start justify-between gap-3">
          {n.url ? (
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] leading-snug transition-colors hover:text-(--color-accent)"
            >
              {n.headline}
            </a>
          ) : (
            <span className="text-[13px] leading-snug">{n.headline}</span>
          )}
          <span className="flex shrink-0 flex-col items-end gap-1">
            <Badge
              tone={
                n.sentiment === "POSITIVE"
                  ? "gain"
                  : n.sentiment === "NEGATIVE"
                    ? "loss"
                    : "neutral"
              }
            >
              {n.sentiment.slice(0, 3)}
            </Badge>
            {n.impact === "HIGH" ? <Badge tone="warn">high</Badge> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
