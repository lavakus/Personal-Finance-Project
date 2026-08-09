import { Badge, Card } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

import { DisableRule, MarkAllRead, NewPriceAlert } from "./alert-forms";

export const dynamic = "force-dynamic";

/** Alerts & notifications (brief §66–67). Rules are evaluated by the
 *  alert job against CACHED quotes — alert latency is bounded by the
 *  refresh cadence, and that is stated, not hidden. */
export default async function AlertsPage() {
  if (isDemoMode) {
    return (
      <Card title="Alerts" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">Connect Supabase first.</p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let notifications, rules;
  try {
    const [n, r] = await Promise.all([
      sb
        .from("notifications")
        .select("id, type, title, body, symbol, is_read, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      sb
        .from("alerts")
        .select("id, type, symbol, condition, is_active, created_at")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
    ]);
    if (n.error) throw new Error(n.error.message);
    if (r.error) throw new Error(r.error.message);
    notifications = n.data ?? [];
    rules = r.data ?? [];
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0007_bots_alerts.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-4">
      <Card title="New price alert">
        <NewPriceAlert />
        <p className="mt-2 text-[11px] text-(--color-text-faint)">
          Evaluated by the alert job against cached quotes (delayed data) —
          this is an EOD/periodic system, not a tick-by-tick feed.
        </p>
      </Card>

      {rules.length > 0 ? (
        <Card title={`Active rules (${rules.length})`}>
          <ul className="space-y-1.5">
            {rules.map((r) => {
              const cond = r.condition as { above?: number; below?: number };
              return (
                <li key={r.id} className="flex items-center justify-between rounded border border-(--color-border) bg-(--color-surface-2) px-3 py-2 text-[13px]">
                  <span>
                    <Badge tone="accent">{r.type}</Badge>
                    <span className="ml-2 font-semibold">{r.symbol}</span>
                    <span className="ml-2 text-(--color-text-dim)">
                      {cond.above !== undefined ? `above ${cond.above}` : `below ${cond.below}`}
                    </span>
                  </span>
                  <DisableRule id={r.id} />
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card
        title={`Notifications (${unread} unread)`}
        action={unread > 0 ? <MarkAllRead /> : undefined}
      >
        {notifications.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            Nothing yet — notifications appear when alert rules trigger,
            earnings approach for your holdings, or bots misbehave.
          </p>
        ) : (
          <ul className="divide-y divide-(--color-border)">
            {notifications.map((n) => (
              <li key={n.id} className={`flex items-start justify-between gap-3 py-2.5 ${n.is_read ? "opacity-60" : ""}`}>
                <div>
                  <div className="flex items-center gap-2">
                    {!n.is_read ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-(--color-accent)" />
                    ) : null}
                    <Badge tone={n.type === "BOT" || n.type === "EARNINGS" ? "warn" : "accent"}>
                      {n.type}
                    </Badge>
                    <span className="text-[13px] font-semibold">{n.title}</span>
                  </div>
                  {n.body ? (
                    <p className="mt-0.5 text-[12px] text-(--color-text-dim)">{n.body}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-[11px] text-(--color-text-faint)">
                  {new Date(n.created_at).toLocaleString("en-IN")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
