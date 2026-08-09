import { Badge, Card, PnL } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface HistoryRow {
  run_date: string;
  no_trade: boolean;
  regime_label: string;
  stock_rankings: Array<{
    id: string;
    rank: number;
    symbol: string;
    setup_type: string;
    score_total: string;
    trade_outcomes: {
      outcome: string;
      r_multiple: string | null;
      mfe_pct: string | null;
      mae_pct: string | null;
      holding_days: number | null;
      t1_hit: boolean;
    } | null;
  }>;
}

/** Scan history + signal outcomes (brief §57–58). Every scan is kept
 *  forever; outcomes come from the evaluation job (no lookahead). */
export default async function HistoryPage() {
  if (isDemoMode) {
    return (
      <Card title="Scan history" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">Connect Supabase first.</p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let runs: HistoryRow[];
  try {
    const { data, error } = await sb
      .from("scan_runs")
      .select(
        `run_date, no_trade, regime_label,
         stock_rankings (id, rank, symbol, setup_type, score_total,
           trade_outcomes (outcome, r_multiple, mfe_pct, mae_pct, holding_days, t1_hit))`
      )
      .order("run_date", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    runs = data as unknown as HistoryRow[];
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Migrations 0005/0008 are not applied yet — run them in the Supabase SQL editor.
      </div>
    );
  }

  // aggregate outcome stats across all evaluated signals
  const evaluated = runs
    .flatMap((r) => r.stock_rankings)
    .map((s) => s.trade_outcomes)
    .filter((o): o is NonNullable<typeof o> => Boolean(o))
    .filter((o) => !["OPEN", "NOT_TRIGGERED"].includes(o.outcome));
  const winners = evaluated.filter((o) => Number(o.r_multiple ?? 0) > 0).length;

  const outcomeTone = (o: string) =>
    o === "T2" || o === "T1"
      ? ("gain" as const)
      : o === "STOP"
        ? ("loss" as const)
        : o === "OPEN" || o === "NOT_TRIGGERED"
          ? ("neutral" as const)
          : ("warn" as const);

  return (
    <div className="space-y-4">
      {evaluated.length > 0 ? (
        <Card title="Evaluated signal record">
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">Signals resolved</div>
              <div className="num text-lg font-semibold">{evaluated.length}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">Winners</div>
              <div className="num text-lg font-semibold text-(--color-gain)">{winners}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">Losers</div>
              <div className="num text-lg font-semibold text-(--color-loss)">{evaluated.length - winners}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">Avg R</div>
              <div className="num text-lg font-semibold">
                {(
                  evaluated.reduce((a, o) => a + Number(o.r_multiple ?? 0), 0) /
                  evaluated.length
                ).toFixed(2)}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {runs.map((run) => (
        <Card
          key={run.run_date}
          title={`${run.run_date}`}
          action={
            <div className="flex items-center gap-2">
              <Badge tone={run.regime_label.includes("BULL") ? "gain" : "warn"}>
                {run.regime_label}
              </Badge>
              {run.no_trade ? <Badge tone="warn">NO TRADE</Badge> : null}
            </div>
          }
        >
          {run.stock_rankings.length === 0 ? (
            <p className="text-[13px] text-(--color-text-faint)">
              No qualified setups this day.
            </p>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                  <th className="pb-1.5 font-medium">#</th>
                  <th className="pb-1.5 font-medium">Symbol</th>
                  <th className="pb-1.5 font-medium">Setup</th>
                  <th className="pb-1.5 text-right font-medium">Score</th>
                  <th className="pb-1.5 font-medium">Outcome</th>
                  <th className="pb-1.5 text-right font-medium">R</th>
                  <th className="pb-1.5 text-right font-medium">MFE / MAE</th>
                  <th className="pb-1.5 text-right font-medium">Days</th>
                </tr>
              </thead>
              <tbody>
                {[...run.stock_rankings]
                  .sort((a, b) => a.rank - b.rank)
                  .map((s) => {
                    const o = s.trade_outcomes;
                    return (
                      <tr key={s.id} className="border-t border-(--color-border)">
                        <td className="num py-1.5">{s.rank}</td>
                        <td className="py-1.5 font-semibold">{s.symbol}</td>
                        <td><Badge tone="accent">{s.setup_type}</Badge></td>
                        <td className="num py-1.5 text-right">{Number(s.score_total).toFixed(0)}</td>
                        <td className="py-1.5">
                          {o ? (
                            <Badge tone={outcomeTone(o.outcome)}>
                              {o.outcome}{o.t1_hit && o.outcome === "STOP" ? " (after T1)" : ""}
                            </Badge>
                          ) : (
                            <Badge tone="neutral">PENDING EVAL</Badge>
                          )}
                        </td>
                        <td className="num py-1.5 text-right">
                          {o?.r_multiple ? <PnL value={Number(o.r_multiple)} /> : "—"}
                        </td>
                        <td className="num py-1.5 text-right text-[12px] text-(--color-text-dim)">
                          {o?.mfe_pct != null ? `+${Number(o.mfe_pct).toFixed(1)}% / ${Number(o.mae_pct).toFixed(1)}%` : "—"}
                        </td>
                        <td className="num py-1.5 text-right">{o?.holding_days ?? "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </Card>
      ))}

      {runs.length === 0 ? (
        <Card title="Scan history">
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            No scans yet — history accumulates as the daily scan publishes.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
