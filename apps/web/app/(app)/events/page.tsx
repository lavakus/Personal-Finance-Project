import { Badge, Card } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

import { AddEvent } from "./event-form";

export const dynamic = "force-dynamic";

/** Corporate events (brief §37). Manually curated for now — an events
 *  provider adapter can replace the source without touching this page. */
export default async function EventsPage() {
  if (isDemoMode) {
    return (
      <Card title="Corporate events" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">Connect Supabase first.</p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let rows;
  try {
    const { data, error } = await sb
      .from("corporate_events")
      .select("id, symbol, event_type, event_date, title, source")
      .gte("event_date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
      .order("event_date")
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
      <Card title="Add event (admin)">
        <AddEvent kind="corporate" />
        <p className="mt-2 text-[11px] text-(--color-text-faint)">
          No free official corporate-events API exists for NSE, and scraping
          violates its terms — so events are curated manually. Data shown is
          only what has been entered; nothing is fabricated.
        </p>
      </Card>
      <Card title={`Upcoming & recent events (${rows.length})`}>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            No events recorded.
          </p>
        ) : (
          <ul className="divide-y divide-(--color-border)">
            {rows.map((e) => {
              const d = daysUntil(e.event_date);
              return (
                <li key={e.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <span className="font-semibold">{e.symbol}</span>
                    <Badge tone="accent">{e.event_type}</Badge>
                    <span className="ml-2 text-[13px] text-(--color-text-dim)">{e.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="num text-[12px] text-(--color-text-dim)">{e.event_date}</span>
                    {d >= 0 && d <= 2 ? (
                      <Badge tone="warn">EVENT RISK: HIGH ({d}d)</Badge>
                    ) : d >= 0 && d <= 5 ? (
                      <Badge tone="warn">in {d}d</Badge>
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
