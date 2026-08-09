import { Badge, Card } from "@/components/ui";
import { getAccounts, getTransactions, isMigrationPending } from "@/lib/data/portfolio";
import { demoTransactions } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

import { AddTransaction } from "./add-transaction";

export const dynamic = "force-dynamic";

/** Transaction ledger (brief §11) — the source of truth for the portfolio. */
export default async function TransactionsPage() {
  if (isDemoMode) {
    return (
      <Card title="Transactions" action={<Badge tone="demo">demo</Badge>}>
        <Table
          rows={demoTransactions.map((t, i) => ({
            id: String(i),
            date: t.date,
            type: t.type,
            symbol: t.symbol,
            quantity: t.qty,
            price: t.price,
            amount: t.amount,
            fees: t.fees,
            currency: "INR",
            notes: null,
          }))}
        />
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let accounts, txns;
  try {
    [accounts, txns] = await Promise.all([getAccounts(sb), getTransactions(sb)]);
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0002_portfolio.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }
  const rows = [...txns].reverse().map((t) => ({
    id: t.id,
    date: t.executed_at.slice(0, 10),
    type: t.type as string,
    symbol: t.assets?.symbol ?? null,
    quantity: t.quantity,
    price: t.price,
    amount: t.amount,
    fees: t.fees,
    currency: t.currency as string,
    notes: t.notes,
  }));

  return (
    <div className="space-y-4">
      <AddTransaction accounts={accounts} />
      <Card title={`Transactions (${rows.length})`}>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            No transactions yet. Start with a DEPOSIT, then record your BUYs.
          </p>
        ) : (
          <Table rows={rows} />
        )}
      </Card>
    </div>
  );
}

function Table({
  rows,
}: {
  rows: Array<{
    id: string;
    date: string;
    type: string;
    symbol: string | null;
    quantity: string | null;
    price: string | null;
    amount: string;
    fees: string;
    currency: string;
    notes: string | null;
  }>;
}) {
  const toneFor = (t: string) =>
    t === "BUY" || t === "DEPOSIT" || t === "DIVIDEND"
      ? ("gain" as const)
      : t === "SELL" || t === "WITHDRAWAL"
        ? ("warn" as const)
        : ("neutral" as const);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
            <th className="pb-2 font-medium">Date</th>
            <th className="pb-2 font-medium">Type</th>
            <th className="pb-2 font-medium">Asset</th>
            <th className="pb-2 text-right font-medium">Qty</th>
            <th className="pb-2 text-right font-medium">Price</th>
            <th className="pb-2 text-right font-medium">Amount</th>
            <th className="pb-2 text-right font-medium">Fees</th>
            <th className="pb-2 font-medium">Ccy</th>
            <th className="pb-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-t border-(--color-border)">
              <td className="num py-2">{t.date}</td>
              <td>
                <Badge tone={toneFor(t.type)}>{t.type}</Badge>
              </td>
              <td className="font-semibold">{t.symbol ?? "—"}</td>
              <td className="num text-right">{t.quantity ?? "—"}</td>
              <td className="num text-right">
                {t.price ? Number(t.price).toLocaleString("en-IN") : "—"}
              </td>
              <td className="num text-right">{Number(t.amount).toLocaleString("en-IN")}</td>
              <td className="num text-right">{Number(t.fees) ? t.fees : "—"}</td>
              <td className="text-(--color-text-dim)">{t.currency}</td>
              <td className="max-w-48 truncate text-(--color-text-faint)">{t.notes ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
