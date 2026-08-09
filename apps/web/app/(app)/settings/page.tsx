import { Badge, Card } from "@/components/ui";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

import { RefreshMarketData, RefreshNews } from "./refresh-button";

export const dynamic = "force-dynamic";

function StatusRow({
  name,
  status,
  detail,
}: {
  name: string;
  status: "OK" | "DEMO" | "UNAVAILABLE" | "STALE" | "ERROR";
  detail?: string;
}) {
  const tone =
    status === "OK"
      ? "gain"
      : status === "DEMO"
        ? "demo"
        : status === "ERROR" || status === "STALE"
          ? "warn"
          : "neutral";
  return (
    <div className="flex items-center justify-between border-b border-(--color-border) py-2 last:border-0">
      <span className="text-[13px]">{name}</span>
      <div className="flex items-center gap-2">
        {detail ? (
          <span className="text-[11px] text-(--color-text-faint)">{detail}</span>
        ) : null}
        <Badge tone={tone}>{status}</Badge>
      </div>
    </div>
  );
}

export default async function SettingsPage() {
  let marketStatus: "OK" | "DEMO" | "UNAVAILABLE" | "STALE" | "ERROR" = isDemoMode
    ? "DEMO"
    : "UNAVAILABLE";
  let marketDetail: string | undefined;

  if (!isDemoMode) {
    try {
      const sb = await createServerSupabase();
      const { data, error } = await sb
        .from("data_provider_status")
        .select("provider, last_success_at, last_error, last_error_at")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data?.last_success_at) {
        const ageH =
          (Date.now() - new Date(data.last_success_at).getTime()) / 3_600_000;
        marketStatus = ageH <= 30 ? "OK" : "STALE";
        marketDetail = `last update ${new Date(data.last_success_at).toLocaleString("en-IN")}`;
        if (data.last_error_at && data.last_error) {
          marketDetail += ` · last error: ${data.last_error.slice(0, 60)}`;
        }
      } else if (data?.last_error) {
        marketStatus = "ERROR";
        marketDetail = data.last_error.slice(0, 80);
      }
    } catch {
      marketStatus = "UNAVAILABLE";
      marketDetail = "migration 0004 pending or no runs yet";
    }
  }

  const db = isDemoMode ? "DEMO" : "OK";
  return (
    <div className="grid max-w-3xl grid-cols-1 gap-4">
      <Card title="System health">
        <StatusRow name="Database (Supabase)" status={db as "OK" | "DEMO"} />
        <StatusRow name="Market data" status={marketStatus} detail={marketDetail} />
        <StatusRow name="News" status={isDemoMode ? "DEMO" : "UNAVAILABLE"} />
        <StatusRow name="Scanner" status={isDemoMode ? "DEMO" : "UNAVAILABLE"} />
        <StatusRow name="Cron jobs" status={isDemoMode ? "DEMO" : "UNAVAILABLE"} />
        <StatusRow name="Notifications" status="UNAVAILABLE" />
        <p className="mt-3 text-[11px] text-(--color-text-faint)">
          Statuses are honest: nothing reports OK until its phase is wired.
        </p>
      </Card>

      {!isDemoMode ? (
        <Card title="Market data">
          <p className="mb-3 text-[13px] text-(--color-text-dim)">
            Refreshes cached quotes for all tracked indices and every asset in
            your portfolio/journal (Yahoo Finance + CoinGecko, free tiers —
            delayed data, labeled RECENT at best, never LIVE).
          </p>
          <RefreshMarketData />
          <div className="mt-3 border-t border-(--color-border) pt-3">
            <p className="mb-3 text-[13px] text-(--color-text-dim)">
              Pull the latest headlines from official RSS feeds (ET Markets,
              Moneycontrol, Mint, CoinDesk) with heuristic sentiment tags and
              automatic stock mapping.
            </p>
            <RefreshNews />
          </div>
        </Card>
      ) : null}

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
    </div>
  );
}
