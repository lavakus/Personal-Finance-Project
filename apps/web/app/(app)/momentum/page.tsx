import Link from "next/link";

import { Badge, Card, Empty, Meter, NoData, PnL, Stat, Table } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { getLatestMomentum, type ScanRunRow } from "@/lib/data/scanner";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Momentum core screener (cross-sectional 12-1).
 *
 * Structurally different from /screener: that engine times entries into
 * pullbacks and breakouts and holds ~11 days; this one ranks the whole
 * universe on 12-month momentum and holds the top slice for months with no
 * entry timing and no stop. The validation banner is deliberately prominent —
 * this strategy earned more raw return than a passive benchmark but LOWER
 * risk-adjusted return, and hiding that would make the page misleading.
 */
export default async function MomentumPage() {
  if (isDemoMode) {
    return (
      <Card title="Momentum core" action={<Badge tone="demo">demo</Badge>}>
        <Empty>
          Connect Supabase and publish a rebalance to see the momentum book.
        </Empty>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let run: ScanRunRow | null;
  try {
    run = await getLatestMomentum(sb);
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-xl border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration{" "}
        <span className="font-mono font-semibold">0009_momentum_core.sql</span> has not
        been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  const f = (run?.funnel ?? {}) as Record<string, number>;
  const holdUntil = run?.stock_rankings?.[0]?.hold_until ?? null;

  return (
    <div className="space-y-4">
      {/* Honest header: what this is and what the evidence says. */}
      <Card
        title="Momentum core — 12-1 cross-sectional"
        delay={0}
        action={
          run ? (
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{run.universe}</Badge>
              <span className="num text-xs text-(--color-text-dim)">
                rebalanced {run.run_date}
              </span>
            </div>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-6">
          <Stat label="Holdings" value={run ? run.stock_rankings.length : <NoData />} />
          <Stat label="Eligible universe" value={f.eligible ?? <NoData />} />
          <Stat label="Rebalance" value={f.hold_months ? `${f.hold_months} months` : <NoData />} />
          <Stat label="Max per sector" value={f.max_per_sector ?? <NoData />} />
          <Stat
            label="Hold until"
            value={holdUntil ? <span className="num">{holdUntil}</span> : <NoData />}
          />
          <Stat
            label="Regime (context)"
            value={
              run?.regime_label ? (
                <Badge tone={run.regime_label.includes("BULL") ? "gain" : "warn"}>
                  {run.regime_label}
                </Badge>
              ) : (
                <NoData hint="Factor engine does not gate on regime" />
              )
            }
          />
        </div>

        <div className="mt-4 rounded-lg border border-(--color-warn)/30 bg-(--color-warn)/5 px-3 py-2.5 text-[12px] leading-relaxed text-(--color-text-dim)">
          <span className="font-semibold text-(--color-warn)">
            Measured, not proven.
          </span>{" "}
          Walk-forward 2022-08 → 2026-08: this book returned{" "}
          <span className="num">35.5%</span> CAGR against{" "}
          <span className="num">26.0%</span> for an equal-weight universe — but with
          a deeper drawdown (<span className="num">−31%</span> vs{" "}
          <span className="num">−19%</span>), so its risk-adjusted return was{" "}
          <em>worse</em> (Sharpe <span className="num">0.95</span> vs{" "}
          <span className="num">1.24</span>). It beat that passive benchmark on a
          drawdown-adjusted basis in only 1 of 3 out-of-sample folds. The sample is
          one bull market and carries survivorship bias. Treat this as a candidate
          under live observation, not a validated edge.
        </div>
      </Card>

      {!run ? (
        <Card title="Holdings" delay={1}>
          <Empty>
            No rebalance published yet — run{" "}
            <span className="font-mono">python -m swingscan.publish_factor</span> or
            trigger the momentum-rebalance action.
          </Empty>
        </Card>
      ) : run.no_trade ? (
        <Card title="Holdings" delay={1}>
          <div className="py-10 text-center">
            <div className="text-base font-semibold tracking-wide text-(--color-warn)">
              NO BOOK THIS REBALANCE
            </div>
            <p className="mx-auto mt-2 max-w-md text-[13px] text-(--color-text-dim)">
              {run.no_trade_reason}
            </p>
            <p className="mt-2 text-[11px] text-(--color-text-faint)">
              Cash is a valid position — no name cleared the momentum floor.
            </p>
          </div>
        </Card>
      ) : (
        <Card title={`Holdings (${run.stock_rankings.length})`} delay={1} flush>
          <Table
            head={
              <>
                <th>#</th>
                <th>Symbol</th>
                <th>Sector</th>
                <th>12-1 momentum</th>
                <th className="text-right">Percentile</th>
                <th className="text-right">Weight</th>
                <th className="text-right">Realised vol</th>
                <th className="text-right">Price</th>
              </>
            }
          >
            {run.stock_rankings.map((s) => {
              const mom = s.momentum_pct !== null ? Number(s.momentum_pct) : null;
              const vol = s.vol_annual_pct !== null ? Number(s.vol_annual_pct) : null;
              return (
                <tr key={s.id}>
                  <td className="num">{s.rank}</td>
                  <td>
                    <Link
                      href={`/research?symbol=${s.symbol}`}
                      className="font-semibold hover:text-(--color-accent)"
                    >
                      {s.symbol}
                    </Link>
                    <div className="text-[11px] text-(--color-text-faint)">{s.name}</div>
                  </td>
                  <td className="text-[12px] text-(--color-text-dim)">
                    {s.sector ?? "—"}
                  </td>
                  <td>
                    {mom !== null ? (
                      <div className="flex items-center gap-2">
                        <PnL value={mom} suffix="%" className="w-16" />
                        <Meter pct={Math.min(100, mom / 3)} tone="gain" className="w-14" />
                      </div>
                    ) : (
                      <NoData />
                    )}
                  </td>
                  <td className="num text-right">
                    {Number(s.score_total).toFixed(0)}%
                    <span className="ml-1 text-[10px] text-(--color-text-faint)">
                      {s.score_tier}
                    </span>
                  </td>
                  <td className="num text-right">
                    {s.weight_pct !== null ? `${Number(s.weight_pct).toFixed(1)}%` : <NoData />}
                  </td>
                  <td className="num text-right">
                    {vol !== null ? (
                      <span className={vol >= 50 ? "text-(--color-warn)" : undefined}>
                        {vol.toFixed(0)}%
                      </span>
                    ) : (
                      <NoData />
                    )}
                  </td>
                  <td className="num text-right">
                    ₹{Number(s.price).toLocaleString("en-IN")}
                  </td>
                </tr>
              );
            })}
          </Table>
          <p className="px-4 py-3 text-[11px] leading-relaxed text-(--color-text-faint)">
            Equal weight, held to the next rebalance — there is no stop and no
            target, which is the strategy, not an omission. High realised vol is
            normal for a momentum book; names above 50% are flagged. This is
            analysis, not an instruction to trade.
          </p>
        </Card>
      )}
    </div>
  );
}
