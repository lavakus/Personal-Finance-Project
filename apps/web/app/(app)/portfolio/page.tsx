import { Badge, Card, PnL, Stat } from "@/components/ui";
import { getPortfolioSummary, isMigrationPending } from "@/lib/data/portfolio";
import { demoHoldings, demoPortfolio } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const fmt = (v: string, currency = "₹") =>
  `${currency}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Holdings (brief §10). Everything on this page is DERIVED from the
 * transaction ledger. Price-dependent columns show UNAVAILABLE until
 * Phase 4 market data lands — never a fabricated number.
 */
export default async function PortfolioPage() {
  if (isDemoMode) {
    return (
      <div className="space-y-4">
        <Card title="Holdings" action={<Badge tone="demo">demo</Badge>}>
          <HoldingsTable
            rows={demoHoldings.map((h) => ({
              symbol: h.symbol,
              name: h.name,
              assetClass: h.assetClass,
              quantity: h.qty,
              averageCost: h.avg,
              investedValue: h.invested,
              realizedPnl: h.realized,
            }))}
          />
        </Card>
        <Card title="Summary" action={<Badge tone="demo">demo</Badge>}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Invested" value={fmt(demoPortfolio.invested)} />
            <Stat label="Current" value={fmt(demoPortfolio.currentValue)} />
            <Stat label="Realized" value={<PnL value={Number(demoPortfolio.realizedPnl)} />} />
            <Stat label="Return" value={<PnL value={Number(demoPortfolio.returnPct)} suffix="%" />} />
          </div>
        </Card>
      </div>
    );
  }

  const sb = await createServerSupabase();
  let summary;
  try {
    summary = await getPortfolioSummary(sb);
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return <MigrationPendingNotice />;
  }

  return (
    <div className="space-y-4">
      <Card title="Summary">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Invested" value={fmt(summary.invested)} />
          <Stat
            label="Current value"
            value={
              summary.currentValue !== null ? (
                fmt(summary.currentValue)
              ) : (
                <span className="text-(--color-text-faint)">—</span>
              )
            }
            sub={
              summary.currentValue === null ? (
                <Badge tone="neutral">prices in phase 4</Badge>
              ) : undefined
            }
          />
          <Stat label="Realized P&L" value={<PnL value={Number(summary.realizedPnl)} />} />
          <Stat
            label="Unrealized P&L"
            value={
              summary.unrealizedPnl !== null ? (
                <PnL value={Number(summary.unrealizedPnl)} />
              ) : (
                <span className="text-(--color-text-faint)">—</span>
              )
            }
          />
        </div>
      </Card>

      <Card title="Cash">
        {summary.cashByAccount.length === 0 ? (
          <Empty text="No accounts yet." />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {summary.cashByAccount.map((c) => (
              <Stat
                key={c.accountId}
                label={`${c.accountName} (${c.currency})`}
                value={fmt(c.balance, c.currency === "INR" ? "₹" : `${c.currency} `)}
              />
            ))}
          </div>
        )}
      </Card>

      <Card title="Holdings">
        {summary.holdings.length === 0 ? (
          <Empty text="No holdings yet — add BUY transactions on the Transactions page." />
        ) : (
          <HoldingsTable rows={summary.holdings} />
        )}
      </Card>
    </div>
  );
}

function MigrationPendingNotice() {
  return (
    <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
      Database migration <span className="font-mono font-semibold">0002_portfolio.sql</span> has
      not been applied yet — run it in the Supabase SQL editor, then reload.
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-[13px] text-(--color-text-faint)">{text}</p>;
}

function HoldingsTable({
  rows,
}: {
  rows: Array<{
    symbol: string;
    name: string;
    assetClass: string;
    quantity: string;
    averageCost: string;
    investedValue: string;
    realizedPnl: string;
  }>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
            <th className="pb-2 font-medium">Asset</th>
            <th className="pb-2 font-medium">Class</th>
            <th className="pb-2 text-right font-medium">Qty</th>
            <th className="pb-2 text-right font-medium">Avg cost</th>
            <th className="pb-2 text-right font-medium">Invested</th>
            <th className="pb-2 text-right font-medium">Realized P&L</th>
            <th className="pb-2 text-right font-medium">Current / Unrealized</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.symbol} className="border-t border-(--color-border)">
              <td className="py-2">
                <div className="font-semibold">{h.symbol}</div>
                <div className="text-[11px] text-(--color-text-faint)">{h.name}</div>
              </td>
              <td>
                <Badge tone="neutral">{h.assetClass.replace("_IN", "")}</Badge>
              </td>
              <td className="num text-right">{h.quantity}</td>
              <td className="num text-right">{Number(h.averageCost).toLocaleString("en-IN")}</td>
              <td className="num text-right">{Number(h.investedValue).toLocaleString("en-IN")}</td>
              <td className="num text-right">
                <PnL value={Number(h.realizedPnl)} />
              </td>
              <td className="text-right">
                <Badge tone="neutral">unavailable</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
