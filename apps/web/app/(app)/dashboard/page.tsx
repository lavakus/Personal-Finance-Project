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
import { isDemoMode } from "@/lib/env";

/**
 * Dashboard (brief §9). Phase 1 renders the full layout wired to demo data;
 * each card switches to live Supabase queries as its phase lands
 * (portfolio→P2, trades→P3, markets→P4, setups→P5, news/events→P6, bots→P8).
 * Demo values are always labeled; live and demo are never mixed.
 */
export default function DashboardPage() {
  const fmtINR = (v: string) => `₹${Number(v).toLocaleString("en-IN")}`;

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* portfolio summary */}
      <Card title="Total portfolio" className="col-span-12 xl:col-span-5"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Invested" value={fmtINR(demoPortfolio.invested)} />
          <Stat label="Current" value={fmtINR(demoPortfolio.currentValue)} />
          <Stat label="Realized" value={<PnL value={Number(demoPortfolio.realizedPnl)} />} />
          <Stat label="Unrealized" value={<PnL value={Number(demoPortfolio.unrealizedPnl)} />} />
          <Stat label="Return" value={<PnL value={Number(demoPortfolio.returnPct)} suffix="%" />} />
        </div>
      </Card>

      {/* market overview */}
      <Card title="Markets" className="col-span-12 xl:col-span-7"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
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
      </Card>

      {/* top setups */}
      <Card title="Top setups (scanner)" className="col-span-12 xl:col-span-7"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
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
      </Card>

      {/* active trades */}
      <Card title="Active trades" className="col-span-12 md:col-span-6 xl:col-span-5"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
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
      </Card>

      {/* news */}
      <Card title="Important news" className="col-span-12 md:col-span-6 xl:col-span-4"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
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
      </Card>

      {/* events */}
      <Card title="Upcoming events" className="col-span-12 md:col-span-6 xl:col-span-4"
            action={isDemoMode ? <Badge tone="demo">demo</Badge> : undefined}>
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
      </Card>

      {/* bots placeholder */}
      <Card title="Bots" className="col-span-12 md:col-span-6 xl:col-span-4">
        <p className="text-[13px] text-(--color-text-dim)">
          Bot ingestion API, equity curves and comparisons arrive in Phase 8.
        </p>
      </Card>
    </div>
  );
}
