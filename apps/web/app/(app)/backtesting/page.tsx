import { Badge, Card } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface BacktestRow {
  id: string;
  label: string;
  kind: string;
  start_date: string;
  end_date: string;
  universe: string;
  capital: string;
  metrics: Record<string, unknown>;
  created_at: string;
}

const METRIC_LABELS: Array<[string, string]> = [
  ["total_trades", "Trades"],
  ["win_rate", "Win rate"],
  ["profit_factor", "Profit factor"],
  ["expectancy_r", "Expectancy (R)"],
  ["avg_r", "Avg R"],
  ["cagr", "CAGR"],
  ["max_drawdown", "Max drawdown"],
  ["sharpe", "Sharpe"],
];

/** Backtest results (brief §59–60). Everything here is labeled BACKTEST /
 *  OUT-OF-SAMPLE — never presented as (or mixed with) live performance. */
export default async function BacktestingPage() {
  if (isDemoMode) {
    return (
      <Card title="Backtesting" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">Connect Supabase first.</p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let rows: BacktestRow[];
  try {
    const { data, error } = await sb
      .from("backtests")
      .select("id, label, kind, start_date, end_date, universe, capital, metrics, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    rows = data as unknown as BacktestRow[];
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0008_research.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  const fmt = (k: string, v: unknown) => {
    if (typeof v !== "number") return String(v ?? "—");
    if (["win_rate", "cagr", "max_drawdown"].includes(k)) {
      return `${(v * 100).toFixed(1)}%`;
    }
    return v.toFixed(2);
  };

  return (
    <div className="space-y-4">
      <Card title="Run a backtest">
        <p className="text-[13px] text-(--color-text-dim)">
          Backtests run locally or in CI (they are too heavy for the web tier):
        </p>
        <code className="mt-2 block rounded bg-(--color-surface-2) px-3 py-2 font-mono text-[12px]">
          uv run python -m swingscan.publish_backtest --start 2023-01-01 --end 2024-12-31
        </code>
        <p className="mt-2 text-[11px] text-(--color-text-faint)">
          Results appear here automatically. Add <span className="font-mono">--oos</span> for
          out-of-sample runs. Caveat baked into every run: the universe is the
          CURRENT NIFTY 500 list (survivorship bias) — treat results as relative
          evidence, never as a return forecast.
        </p>
      </Card>

      {rows.length === 0 ? (
        <Card title="Backtests">
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            No backtests stored yet.
          </p>
        </Card>
      ) : (
        rows.map((bt) => (
          <Card
            key={bt.id}
            title={bt.label}
            action={
              <div className="flex items-center gap-2">
                <Badge tone={bt.kind === "BACKTEST" ? "warn" : "accent"}>{bt.kind}</Badge>
                <span className="num text-xs text-(--color-text-dim)">
                  {bt.start_date} → {bt.end_date}
                </span>
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {METRIC_LABELS.map(([key, label]) =>
                bt.metrics[key] !== undefined ? (
                  <div key={key}>
                    <div className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
                      {label}
                    </div>
                    <div className="num mt-0.5 text-sm font-semibold">
                      {fmt(key, bt.metrics[key])}
                    </div>
                  </div>
                ) : null
              )}
            </div>
            {typeof bt.metrics.survivorship_caveat === "string" ? (
              <p className="mt-3 border-t border-(--color-border) pt-2 text-[11px] text-(--color-warn)">
                ⚠ {bt.metrics.survivorship_caveat}
              </p>
            ) : null}
          </Card>
        ))
      )}
    </div>
  );
}
