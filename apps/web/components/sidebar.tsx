"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sidebar per brief §69. The full navigation skeleton ships up front;
 *  sections unlock as their phase lands (disabled ones say so). */
const LIVE_PHASE = 9;

const NAV: Array<{ group: string; items: Array<{ label: string; href: string; phase?: number }> }> = [
  { group: "", items: [{ label: "Dashboard", href: "/dashboard" }] },
  {
    group: "Portfolio",
    items: [
      { label: "Holdings", href: "/portfolio", phase: 2 },
      { label: "Transactions", href: "/transactions", phase: 2 },
      { label: "Trades", href: "/trades", phase: 3 },
    ],
  },
  {
    group: "Markets",
    items: [
      { label: "Indian Stocks", href: "/markets/india", phase: 4 },
      { label: "Crypto", href: "/markets/crypto", phase: 4 },
      { label: "Gold", href: "/markets/gold", phase: 4 },
      { label: "Global", href: "/markets/global", phase: 4 },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { label: "Screener", href: "/screener", phase: 5 },
      { label: "Stock Research", href: "/research", phase: 5 },
      { label: "Sectors", href: "/sectors", phase: 5 },
      { label: "News", href: "/news", phase: 6 },
      { label: "Events", href: "/events", phase: 6 },
      { label: "Earnings", href: "/earnings", phase: 6 },
    ],
  },
  {
    group: "Research",
    items: [
      { label: "Watchlists", href: "/watchlists", phase: 5 },
      { label: "Strategies", href: "/strategies", phase: 3 },
      { label: "Backtesting", href: "/backtesting", phase: 11 },
      { label: "Scan History", href: "/history", phase: 10 },
    ],
  },
  {
    group: "System",
    items: [
      { label: "Bots", href: "/bots", phase: 8 },
      { label: "Analytics", href: "/analytics", phase: 10 },
      { label: "Alerts", href: "/alerts", phase: 9 },
      { label: "Settings", href: "/settings" },
    ],
  },
];

export function Sidebar({ demoMode }: { demoMode: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface)">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-(--color-accent)/15 font-mono text-sm font-bold text-(--color-accent)">
          T
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight">TradeOS</div>
          <div className="text-[10px] uppercase tracking-widest text-(--color-text-faint)">
            personal terminal
          </div>
        </div>
      </div>

      {demoMode ? (
        <div className="mx-3 mb-2 rounded border border-(--color-demo)/40 bg-(--color-demo)/10 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-(--color-demo)">
          Demo mode
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {NAV.map((section) => (
          <div key={section.group || "root"} className="mt-3">
            {section.group ? (
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-(--color-text-faint)">
                {section.group}
              </div>
            ) : null}
            {section.items.map((item) => {
              const active = pathname?.startsWith(item.href);
              const pending = item.phase !== undefined && item.phase > LIVE_PHASE;
              return (
                <Link
                  key={item.href}
                  href={pending ? "#" : item.href}
                  aria-disabled={pending}
                  className={`flex items-center justify-between rounded px-2 py-1.5 text-[13px] transition-colors ${
                    active
                      ? "bg-(--color-accent)/10 font-medium text-(--color-accent)"
                      : pending
                        ? "cursor-default text-(--color-text-faint)"
                        : "text-(--color-text-dim) hover:bg-(--color-surface-2) hover:text-(--color-text)"
                  }`}
                >
                  {item.label}
                  {pending ? (
                    <span className="text-[9px] uppercase text-(--color-text-faint)">
                      P{item.phase}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
