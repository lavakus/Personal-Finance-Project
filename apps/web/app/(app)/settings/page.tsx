import { Badge, Card } from "@/components/ui";
import { isDemoMode } from "@/lib/env";

function StatusRow({ name, status }: { name: string; status: "OK" | "DEMO" | "UNAVAILABLE" }) {
  const tone = status === "OK" ? "gain" : status === "DEMO" ? "demo" : "neutral";
  return (
    <div className="flex items-center justify-between border-b border-(--color-border) py-2 last:border-0">
      <span className="text-[13px]">{name}</span>
      <Badge tone={tone}>{status}</Badge>
    </div>
  );
}

export default function SettingsPage() {
  const db = isDemoMode ? "DEMO" : "OK";
  return (
    <div className="grid max-w-3xl grid-cols-1 gap-4">
      <Card title="System health">
        <StatusRow name="Database (Supabase)" status={db as "OK" | "DEMO"} />
        <StatusRow name="Market data" status={isDemoMode ? "DEMO" : "UNAVAILABLE"} />
        <StatusRow name="News" status={isDemoMode ? "DEMO" : "UNAVAILABLE"} />
        <StatusRow name="Scanner" status={isDemoMode ? "DEMO" : "UNAVAILABLE"} />
        <StatusRow name="Cron jobs" status={isDemoMode ? "DEMO" : "UNAVAILABLE"} />
        <StatusRow name="Notifications" status="UNAVAILABLE" />
        <p className="mt-3 text-[11px] text-(--color-text-faint)">
          Statuses are honest: nothing reports OK until its phase is wired.
          Provider freshness (LIVE / RECENT / STALE) appears here from Phase 4.
        </p>
      </Card>

      <Card title="Environment">
        <div className="space-y-1 text-[13px] text-(--color-text-dim)">
          <p>
            Mode: {isDemoMode ? (
              <Badge tone="demo">DEMO — Supabase env not configured</Badge>
            ) : (
              <Badge tone="gain">CONNECTED</Badge>
            )}
          </p>
          <p className="text-[11px] text-(--color-text-faint)">
            To go live: create a Supabase project, run the migrations in
            /supabase, and set NEXT_PUBLIC_SUPABASE_URL +
            NEXT_PUBLIC_SUPABASE_ANON_KEY. See supabase/README.md.
          </p>
        </div>
      </Card>

      <Card title="Data providers">
        <p className="text-[13px] text-(--color-text-dim)">
          Provider management (keys, limits, freshness, failover order) lands
          in Phase 4 with the provider abstraction layer.
        </p>
      </Card>
    </div>
  );
}
