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

      <RiskCard summary={summary} />
    </div>
  );
}

/** Portfolio risk (brief §48). Warnings only — nothing is ever blocked. */
function RiskCard({
  summary,
}: {
  summary: {
    holdings: Array<{
      symbol: string;
      assetClass: string;
      quantity: string;
      allocationPct: string | null;
      currentValue: string | null;
    }>;
    cashByAccount: Array<{ accountName: string; balance: string; currency: string }>;
  };
}) {
  const open = summary.holdings.filter((h) => Number(h.quantity) > 0);
  const priced = open.filter((h) => h.allocationPct !== null);

  const warnings: string[] = [];
  for (const h of priced) {
    const a = Number(h.allocationPct);
    if (a >= 30) warnings.push(`${h.symbol} is ${a.toFixed(0)}% of the priced portfolio — very high concentration.`);
    else if (a >= 20) warnings.push(`${h.symbol} is ${a.toFixed(0)}% of the priced portfolio — high concentration.`);
  }
  const classTotals = new Map<string, number>();
  for (const h of priced) {
    classTotals.set(
      h.assetClass,
      (classTotals.get(h.assetClass) ?? 0) + Number(h.allocationPct)
    );
  }
  for (const [cls, pct] of classTotals) {
    if (pct >= 70 && classTotals.size > 1) {
      warnings.push(`${cls.replace("_IN", "")} is ${pct.toFixed(0)}% of the priced portfolio — heavy asset-class tilt.`);
    }
  }
  for (const c of summary.cashByAccount) {
    if (Number(c.balance) < 0) {
      warnings.push(`Account "${c.accountName}" cash is negative (${c.balance} ${c.currency}) — the ledger is missing a DEPOSIT.`);
    }
  }
  const unpriced = open.length - priced.length;

  return (
    <Card title="Risk">
      {priced.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-(--color-text-dim)">
          {[...classTotals.entries()].map(([cls, pct]) => (
            <span key={cls}>
              <span className="text-(--color-text-faint)">{cls.replace("_IN", "")}</span>{" "}
              <span className="num font-semibold text-(--color-text)">{pct.toFixed(1)}%</span>
            </span>
          ))}
        </div>
      ) : null}
      {warnings.length === 0 ? (
        <p className="text-[13px] text-(--color-text-dim)">
          No concentration warnings{unpriced > 0 ? ` (${unpriced} unpriced holding${unpriced > 1 ? "s" : ""} excluded — refresh market data)` : ""}.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {warnings.map((w) => (
            <li key={w} className="rounded border border-(--color-warn)/40 bg-(--color-warn)/10 px-3 py-2 text-[12px] text-(--color-warn)">
              ⚠ {w}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-(--color-text-faint)">
        Warnings are informational — nothing is blocked (brief §48). Sector
        exposure and correlation checks activate as sector mapping and price
        history accumulate.
      </p>
    </Card>
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
    currentPrice?: string | null;
    currentValue?: string | null;
    unrealizedPnl?: string | null;
    returnPct?: string | null;
    allocationPct?: string | null;
    priceFreshness?: string;
  }>;
}) {
  const freshTone = (f?: string) =>
    f === "RECENT" ? ("gain" as const) : f === "STALE" ? ("warn" as const) : ("neutral" as const);
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
            <th className="pb-2 text-right font-medium">Price (INR)</th>
            <th className="pb-2 text-right font-medium">Value</th>
            <th className="pb-2 text-right font-medium">Unrealized</th>
            <th className="pb-2 text-right font-medium">Realized</th>
            <th className="pb-2 text-right font-medium">Alloc</th>
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
                {h.currentPrice ? (
                  <div>
                    {Number(h.currentPrice).toLocaleString("en-IN")}
                    <div>
                      <Badge tone={freshTone(h.priceFreshness)}>
                        {(h.priceFreshness ?? "UNAVAILABLE").slice(0, 5)}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <Badge tone="neutral">unavailable</Badge>
                )}
              </td>
              <td className="num text-right">
                {h.currentValue ? Number(h.currentValue).toLocaleString("en-IN") : "—"}
              </td>
              <td className="num text-right">
                {h.unrealizedPnl ? (
                  <div>
                    <PnL value={Number(h.unrealizedPnl)} />
                    {h.returnPct ? (
                      <div className="text-[11px]">
                        <PnL value={Number(h.returnPct)} suffix="%" />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="num text-right">
                <PnL value={Number(h.realizedPnl)} />
              </td>
              <td className="num text-right">
                {h.allocationPct ? `${h.allocationPct}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-(--color-text-faint)">
        INR valuation: Indian equity direct; crypto USD × USD/INR; gold COMEX
        per-gram × USD/INR (assumes gold quantity in grams). Unpriced assets
        stay UNAVAILABLE — values are never estimated.
      </p>
    </div>
  );
}
