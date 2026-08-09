import { Badge, Card } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { getLatestScan, type ScanRunRow } from "@/lib/data/scanner";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

import { ScoreBreakdown } from "./score-breakdown";

export const dynamic = "force-dynamic";

/** Screener (brief §18, §31, §51). Renders the latest published swingscan
 *  run. NO TRADE is a first-class, prominently displayed result. */
export default async function ScreenerPage() {
  if (isDemoMode) {
    return (
      <Card title="Screener" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">
          Connect Supabase and run the daily scan (GitHub Actions or
          `python -m swingscan.publish`) to see qualified setups here.
        </p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let run: ScanRunRow | null;
  try {
    run = await getLatestScan(sb);
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0005_intelligence.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  if (!run) {
    return (
      <Card title="Screener">
        <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
          No scans published yet. Run{" "}
          <span className="font-mono">uv run python -m swingscan.publish</span>{" "}
          locally or trigger the daily-scan GitHub Action.
        </p>
      </Card>
    );
  }

  const f = run.funnel ?? {};

  return (
    <div className="space-y-4">
      <Card
        title={`Scan — ${run.run_date}`}
        action={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{run.universe}</Badge>
            <Badge tone={run.regime_label.includes("BULL") ? "gain" : run.regime_label.includes("BEAR") ? "loss" : "warn"}>
              {run.regime_label}
            </Badge>
            <span className="num text-xs text-(--color-text-dim)">
              regime {Number(run.regime_score) > 0 ? "+" : ""}
              {Number(run.regime_score).toFixed(0)}
            </span>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-(--color-text-dim)">
          {[
            ["scanned", f.scanned],
            ["quality", f.quality],
            ["liquidity", f.liquidity],
            ["trend", f.trend],
            ["rel. strength", f.relative_strength],
            ["setup", f.setup],
            ["risk/reward", f.risk_reward],
            ["score", f.score],
            ["final", f.final],
          ].map(([label, v], i) => (
            <span key={String(label)} className="flex items-center gap-1.5">
              {i > 0 ? <span className="text-(--color-text-faint)">→</span> : null}
              <span className="text-(--color-text-faint)">{label}</span>
              <span className="num font-semibold text-(--color-text)">{v ?? 0}</span>
            </span>
          ))}
        </div>
      </Card>

      {run.no_trade ? (
        <Card title="Result">
          <div className="py-8 text-center">
            <div className="text-lg font-bold tracking-wide text-(--color-warn)">
              NO HIGH-QUALITY SETUPS
            </div>
            <p className="mt-2 text-[13px] text-(--color-text-dim)">
              {run.no_trade_reason ?? "No candidate met all quality gates."}
            </p>
            <p className="mt-1 text-[11px] text-(--color-text-faint)">
              The scanner never forces recommendations — cash is a position.
            </p>
          </div>
        </Card>
      ) : (
        <Card title={`Qualified setups (${run.stock_rankings.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                  <th className="pb-2 font-medium">#</th>
                  <th className="pb-2 font-medium">Symbol</th>
                  <th className="pb-2 font-medium">Sector</th>
                  <th className="pb-2 font-medium">Setup</th>
                  <th className="pb-2 font-medium">Score</th>
                  <th className="pb-2 text-right font-medium">Price</th>
                  <th className="pb-2 text-right font-medium">Entry zone</th>
                  <th className="pb-2 text-right font-medium">Stop</th>
                  <th className="pb-2 text-right font-medium">T1 / T2</th>
                  <th className="pb-2 text-right font-medium">R:R</th>
                  <th className="pb-2 text-right font-medium">No-chase above</th>
                </tr>
              </thead>
              <tbody>
                {run.stock_rankings.map((s) => {
                  const p = s.trade_plans;
                  return (
                    <tr key={s.id} className="relative border-t border-(--color-border)">
                      <td className="num py-2">{s.rank}</td>
                      <td className="py-2">
                        <div className="font-semibold">{s.symbol}</div>
                        <div className="text-[11px] text-(--color-text-faint)">{s.name}</div>
                      </td>
                      <td className="py-2 text-[12px] text-(--color-text-dim)">
                        {s.sector ?? "—"}
                        {s.sector_rank ? (
                          <span className="text-(--color-text-faint)"> #{s.sector_rank}</span>
                        ) : null}
                      </td>
                      <td>
                        <Badge tone="accent">{s.setup_type}</Badge>
                      </td>
                      <td className="py-2">
                        <ScoreBreakdown
                          total={s.score_total}
                          tier={s.score_tier}
                          components={s.score_components}
                          weights={s.score_weights}
                          why={s.why}
                          warnings={s.warnings}
                        />
                      </td>
                      <td className="num py-2 text-right">
                        ₹{Number(s.price).toLocaleString("en-IN")}
                      </td>
                      <td className="num py-2 text-right">
                        {p ? `₹${Number(p.entry_low).toLocaleString("en-IN")}–${Number(p.entry_high).toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="num py-2 text-right text-(--color-loss)">
                        {p ? `₹${Number(p.stop).toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="num py-2 text-right">
                        {p
                          ? `₹${Number(p.t1).toLocaleString("en-IN")} / ₹${Number(p.t2).toLocaleString("en-IN")}`
                          : "—"}
                      </td>
                      <td className="num py-2 text-right">
                        {p ? `${Number(p.rr1).toFixed(1)} / ${Number(p.rr2).toFixed(1)}` : "—"}
                      </td>
                      <td className="num py-2 text-right text-(--color-warn)">
                        {p?.do_not_chase_above
                          ? `₹${Number(p.do_not_chase_above).toLocaleString("en-IN")}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-(--color-text-faint)">
            Click any score for its full component breakdown, reasons and
            warnings. Plans are analysis, not guarantees — max hold 15 trading
            days, exit earlier on target/stop/invalidation/momentum failure.
          </p>
        </Card>
      )}

      {run.near_misses?.length ? (
        <Card title={`Near misses (${run.near_misses.length})`}>
          <ul className="grid grid-cols-1 gap-1 text-[12px] text-(--color-text-dim) md:grid-cols-2">
            {run.near_misses.slice(0, 20).map((n) => (
              <li key={n.symbol + n.reason}>
                <span className="font-semibold">{n.symbol}</span>
                <span className="text-(--color-text-faint)"> — {n.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
