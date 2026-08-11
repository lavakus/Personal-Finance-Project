import { Badge, Card, Empty, PnL, Stat } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PositionRow {
  id: string;
  symbol: string;
  setup_type: string;
  status: string;
  entry_date: string;
  entry_price: string;
  shares: number;
  remaining: number;
  stop: string;
  score: string | null;
  sector: string | null;
  exit_date: string | null;
  exit_reason: string | null;
  net_pnl: string | null;
  charges: string | null;
  r_multiple: string | null;
  holding_days: number | null;
  t1_hit: boolean;
  last_close: string | null;
  unrealized: string | null;
}

interface AccountRow {
  id: string;
  name: string;
  starting_capital: string;
  per_position: string;
  min_score: string;
  max_open: number;
  start_date: string;
  cash: string | null;
  equity: string | null;
  last_run_at: string | null;
  data_through: string | null;
  paper_positions: PositionRow[];
}

const inr = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * Paper book: the swing scanner run as a funded ₹10L portfolio.
 *
 * Labelled PAPER everywhere on purpose. These rows come from a deterministic
 * replay of the engine, not from a broker, and must never be read as fills or
 * folded into portfolio totals (brief §12: live / paper / backtest stay apart).
 */
export default async function PaperPage() {
  if (isDemoMode) {
    return (
      <Card title="Paper book" action={<Badge tone="demo">demo</Badge>}>
        <Empty>Connect Supabase and run the paper job to see the book.</Empty>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let accounts: AccountRow[] = [];
  try {
    const { data, error } = await sb
      .from("paper_accounts")
      .select(
        `id, name, starting_capital, per_position, min_score, max_open,
         start_date, cash, equity, last_run_at, data_through,
         paper_positions (
           id, symbol, setup_type, status, entry_date, entry_price, shares,
           remaining, stop, score, sector, exit_date, exit_reason, net_pnl,
           charges, r_multiple, holding_days, t1_hit, last_close, unrealized
         )`
      )
      .order("created_at");
    if (error) throw new Error(error.message);
    accounts = data as unknown as AccountRow[];
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration{" "}
        <span className="font-mono font-semibold">0010_paper_trading.sql</span>{" "}
        has not been applied yet — run it in the Supabase SQL editor, then
        reload.
        <span className="mt-1 block font-mono text-[11px] opacity-70">
          {e instanceof Error ? e.message : String(e)}
        </span>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <Card title="Paper book">
        <Empty>
          No paper account yet — run{" "}
          <span className="font-mono">
            uv run python -m swingscan.publish_paper
          </span>
          .
        </Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {accounts.map((a) => {
        const positions = [...a.paper_positions];
        const open = positions
          .filter((p) => p.status === "OPEN")
          .sort((x, y) => y.entry_date.localeCompare(x.entry_date));
        const closed = positions
          .filter((p) => p.status === "CLOSED")
          .sort((x, y) =>
            (y.exit_date ?? "").localeCompare(x.exit_date ?? "")
          );

        const capital = Number(a.starting_capital);
        const equity = a.equity !== null ? Number(a.equity) : capital;
        const realized = closed.reduce((s, p) => s + Number(p.net_pnl ?? 0), 0);
        const unrealized = open.reduce(
          (s, p) => s + Number(p.unrealized ?? 0),
          0
        );
        const wins = closed.filter((p) => Number(p.net_pnl ?? 0) > 0).length;
        const charges = closed.reduce((s, p) => s + Number(p.charges ?? 0), 0);

        return (
          <div key={a.id} className="space-y-4">
            <Card
              title={a.name}
              action={<Badge tone="warn">paper — not real fills</Badge>}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Book value" value={`₹${inr(equity)}`} />
                <Stat
                  label="Return"
                  value={`${(100 * (equity / capital - 1)).toFixed(2)}%`}
                />
                <Stat label="Realised" value={`₹${inr(realized)}`} />
                <Stat label="Unrealised" value={`₹${inr(unrealized)}`} />
                <Stat
                  label="Cash"
                  value={`₹${inr(a.cash !== null ? Number(a.cash) : capital)}`}
                />
                <Stat
                  label="Positions"
                  value={`${open.length} / ${a.max_open}`}
                />
              </div>
              <p className="mt-3 text-[11px] text-(--color-text-faint)">
                ₹{inr(Number(a.per_position))} per name · score ≥{" "}
                {Number(a.min_score)} · entries and exits decided by the same
                rules as the backtest · costs charged.{" "}
                {a.data_through
                  ? `Marked to ${a.data_through}.`
                  : null}{" "}
                {closed.length > 0
                  ? `${wins}/${closed.length} closed trades profitable, ₹${inr(charges)} paid in charges.`
                  : "No closed trades yet."}
              </p>
            </Card>

            <Card title={`Open positions (${open.length})`}>
              {open.length === 0 ? (
                <Empty>Fully in cash — no signal met the entry rules.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-(--color-text-faint)">
                        <th className="pb-2 font-medium">Entered</th>
                        <th className="pb-2 font-medium">Symbol</th>
                        <th className="pb-2 font-medium">Setup</th>
                        <th className="pb-2 text-right font-medium">Qty</th>
                        <th className="pb-2 text-right font-medium">Entry</th>
                        <th className="pb-2 text-right font-medium">Stop</th>
                        <th className="pb-2 text-right font-medium">Last</th>
                        <th className="pb-2 text-right font-medium">Score</th>
                        <th className="pb-2 text-right font-medium">Days</th>
                        <th className="pb-2 text-right font-medium">Unreal.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {open.map((p) => (
                        <tr
                          key={p.id}
                          className="border-t border-(--color-border)"
                        >
                          <td className="py-2 whitespace-nowrap text-[12px] text-(--color-text-dim)">
                            {p.entry_date}
                          </td>
                          <td className="font-semibold">{p.symbol}</td>
                          <td className="text-[12px] text-(--color-text-dim)">
                            {p.setup_type}
                            {p.t1_hit ? (
                              <span className="ml-1 text-(--color-accent)">
                                T1✓
                              </span>
                            ) : null}
                          </td>
                          <td className="num text-right">{p.remaining}</td>
                          <td className="num text-right">
                            {Number(p.entry_price).toFixed(2)}
                          </td>
                          <td className="num text-right text-(--color-text-faint)">
                            {Number(p.stop).toFixed(2)}
                          </td>
                          <td className="num text-right">
                            {p.last_close !== null
                              ? Number(p.last_close).toFixed(2)
                              : "—"}
                          </td>
                          <td className="num text-right">
                            {p.score !== null ? Number(p.score).toFixed(1) : "—"}
                          </td>
                          <td className="num text-right text-(--color-text-dim)">
                            {p.holding_days ?? "—"}
                          </td>
                          <td className="num text-right">
                            {p.unrealized !== null ? (
                              <PnL value={Number(p.unrealized)} prefix="₹" />
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title={`Closed trades (${closed.length})`}>
              {closed.length === 0 ? (
                <Empty>Nothing has closed yet.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-(--color-text-faint)">
                        <th className="pb-2 font-medium">Entered</th>
                        <th className="pb-2 font-medium">Exited</th>
                        <th className="pb-2 font-medium">Symbol</th>
                        <th className="pb-2 font-medium">Setup</th>
                        <th className="pb-2 text-right font-medium">Qty</th>
                        <th className="pb-2 text-right font-medium">Entry</th>
                        <th className="pb-2 text-right font-medium">Days</th>
                        <th className="pb-2 text-right font-medium">R</th>
                        <th className="pb-2 text-right font-medium">Net P&L</th>
                        <th className="pb-2 font-medium">Closed by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closed.map((p) => (
                        <tr
                          key={p.id}
                          className="border-t border-(--color-border)"
                        >
                          <td className="py-2 whitespace-nowrap text-[12px] text-(--color-text-dim)">
                            {p.entry_date}
                          </td>
                          <td className="whitespace-nowrap text-[12px] text-(--color-text-dim)">
                            {p.exit_date}
                          </td>
                          <td className="font-semibold">{p.symbol}</td>
                          <td className="text-[12px] text-(--color-text-dim)">
                            {p.setup_type}
                          </td>
                          <td className="num text-right">{p.shares}</td>
                          <td className="num text-right">
                            {Number(p.entry_price).toFixed(2)}
                          </td>
                          <td className="num text-right text-(--color-text-dim)">
                            {p.holding_days ?? "—"}
                          </td>
                          <td className="num text-right">
                            {p.r_multiple !== null ? (
                              <PnL value={Number(p.r_multiple)} suffix="R" />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="num text-right">
                            {p.net_pnl !== null ? (
                              <PnL value={Number(p.net_pnl)} prefix="₹" />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="text-[12px] text-(--color-text-dim)">
                            {p.exit_reason ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-[11px] text-(--color-text-faint)">
                R is measured against the entry stop. Under fixed-notional
                sizing R varies with stop width, so book return — not average R
                — is the figure that matters here.
              </p>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
