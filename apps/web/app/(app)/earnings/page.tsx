import { Badge, Card } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

import { AddEvent } from "../events/event-form";

export const dynamic = "force-dynamic";

/** Earnings calendar (brief §38). The scanner's earnings-risk rules read
 *  from this table; empty means "no data", never "no earnings". */
export default async function EarningsPage() {
  if (isDemoMode) {
    return (
      <Card title="Earnings" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">Connect Supabase first.</p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let rows;
  try {
    const { data, error } = await sb
      .from("earnings_events")
      .select("id, symbol, earnings_date, period, confirmed, source")
      .gte("earnings_date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
      .order("earnings_date")
      .limit(200);
    if (error) throw new Error(error.message);
    rows = data ?? [];
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0006_news_events.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  const daysUntil = (d: string) =>
    Math.round((new Date(d).getTime() - Date.now()) / 86400000);

  return (
    <div className="space-y-4">
      <Card title="Add earnings date (admin)">
        <AddEvent kind="earnings" />
      </Card>
      <Card title={`Earnings calendar (${rows.length})`}>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            No earnings dates recorded — add the ones for stocks you hold or watch.
          </p>
        ) : (
          <ul className="divide-y divide-(--color-border)">
            {rows.map((e) => {
              const d = daysUntil(e.earnings_date);
              return (
                <li key={e.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <span className="font-semibold">{e.symbol}</span>
                    {e.period ? (
                      <span className="ml-2 text-[12px] text-(--color-text-dim)">{e.period}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="num text-[12px] text-(--color-text-dim)">
                      {e.earnings_date}
                    </span>
                    {d >= 0 && d <= 2 ? (
                      <Badge tone="warn">EVENT RISK: HIGH ({d}d)</Badge>
                    ) : d >= 0 && d <= 5 ? (
                      <Badge tone="warn">in {d}d</Badge>
                    ) : d < 0 ? (
                      <Badge tone="neutral">past</Badge>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
