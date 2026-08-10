"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "./ui";

/** Page titles, keyed by route prefix (longest match wins). */
const TITLES: Array<[string, string]> = [
  ["/dashboard", "Dashboard"],
  ["/portfolio", "Holdings"],
  ["/transactions", "Transactions"],
  ["/trades", "Trade journal"],
  ["/markets/india", "Indian market"],
  ["/markets/crypto", "Crypto"],
  ["/markets/gold", "Gold"],
  ["/markets/global", "Global markets"],
  ["/screener", "Screener"],
  ["/research", "Stock research"],
  ["/sectors", "Sector rotation"],
  ["/analyst", "AI analyst"],
  ["/news", "News"],
  ["/events", "Corporate events"],
  ["/earnings", "Earnings calendar"],
  ["/watchlists", "Watchlists"],
  ["/strategies", "Strategies"],
  ["/backtesting", "Backtesting"],
  ["/history", "Scan history"],
  ["/bots", "Bots"],
  ["/analytics", "Performance analytics"],
  ["/alerts", "Alerts"],
  ["/settings", "Settings"],
];

function titleFor(pathname: string): string {
  const hit = TITLES.filter(([p]) => pathname.startsWith(p)).sort(
    (a, b) => b[0].length - a[0].length
  )[0];
  return hit?.[1] ?? "TradeOS";
}

/**
 * NSE session state from the wall clock (09:15–15:30 IST, Mon–Fri).
 * Exchange holidays are NOT checked, so this is labelled as a clock readout
 * rather than presented as authoritative — a wrong "OPEN" badge on a holiday
 * would be worse than no badge.
 */
function nseState(now: Date): { label: string; tone: "gain" | "neutral" } {
  const ist = new Date(now.getTime() + (330 - -now.getTimezoneOffset()) * 0);
  // Compute IST parts directly to avoid host-timezone drift.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(ist);
  const get = (t: string) => fmt.find((p) => p.type === t)?.value ?? "";
  const day = get("weekday");
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  const weekend = day === "Sat" || day === "Sun";
  const open = !weekend && mins >= 555 && mins <= 930;
  return open
    ? { label: "NSE open", tone: "gain" }
    : { label: weekend ? "NSE weekend" : "NSE closed", tone: "neutral" };
}

export function Topbar({
  name,
  demoMode,
}: {
  name: string;
  demoMode: boolean;
}) {
  const pathname = usePathname() ?? "";
  const [now, setNow] = useState<Date | null>(null);

  // Mounted-only so server and client markup agree (no hydration mismatch).
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const session = now ? nseState(now) : null;
  const clock = now
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now)
    : null;

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-(--color-border) bg-(--color-bg)/85 px-5 backdrop-blur-md">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate text-[15px] font-semibold tracking-tight">
          {titleFor(pathname)}
        </h1>
        <span className="hidden truncate text-xs text-(--color-text-faint) lg:inline">
          Data → Analysis → Setup → Plan →{" "}
          <span className="font-medium text-(--color-text-dim)">your decision</span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {session ? (
          <span
            className="hidden items-center gap-2 sm:flex"
            title="From the clock in IST — exchange holidays are not checked"
          >
            <Badge tone={session.tone} dot>
              {session.label}
            </Badge>
            <span className="num text-xs text-(--color-text-faint)">{clock} IST</span>
          </span>
        ) : null}
        {demoMode ? (
          <Badge tone="demo" dot>
            Demo data
          </Badge>
        ) : (
          <Badge tone="accent" dot>
            Live
          </Badge>
        )}
        <span
          className="grid h-7 w-7 place-items-center rounded-full border border-(--color-border-strong) bg-(--color-surface-2) text-[11px] font-semibold uppercase text-(--color-text-dim)"
          title={name}
        >
          {name.slice(0, 2)}
        </span>
      </div>
    </header>
  );
}
