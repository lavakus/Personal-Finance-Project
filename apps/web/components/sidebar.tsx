"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bell,
  Bitcoin,
  Bot,
  CandlestickChart,
  Coins,
  FlaskConical,
  Gauge,
  Globe2,
  History,
  LayoutDashboard,
  Layers,
  LineChart,
  Newspaper,
  NotebookPen,
  Receipt,
  Search,
  Settings,
  Sparkles,
  Star,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Sidebar per brief §69. The full navigation skeleton ships up front;
 *  sections unlock as their phase lands (disabled ones say so). */
const LIVE_PHASE = 12;

interface Item {
  label: string;
  href: string;
  icon: LucideIcon;
  phase?: number;
}

const NAV: Array<{ group: string; items: Item[] }> = [
  { group: "", items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }] },
  {
    group: "Portfolio",
    items: [
      { label: "Holdings", href: "/portfolio", icon: Wallet, phase: 2 },
      { label: "Transactions", href: "/transactions", icon: Receipt, phase: 2 },
      { label: "Trades", href: "/trades", icon: CandlestickChart, phase: 3 },
    ],
  },
  {
    group: "Markets",
    items: [
      { label: "Indian Stocks", href: "/markets/india", icon: LineChart, phase: 4 },
      { label: "Crypto", href: "/markets/crypto", icon: Bitcoin, phase: 4 },
      { label: "Gold", href: "/markets/gold", icon: Coins, phase: 4 },
      { label: "Global", href: "/markets/global", icon: Globe2, phase: 4 },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { label: "Screener", href: "/screener", icon: Search, phase: 5 },
      { label: "Momentum core", href: "/momentum", icon: TrendingUp, phase: 5 },
      { label: "Stock Research", href: "/research", icon: Activity, phase: 5 },
      { label: "Sectors", href: "/sectors", icon: Layers, phase: 5 },
      { label: "AI Analyst", href: "/analyst", icon: Sparkles, phase: 12 },
      { label: "News", href: "/news", icon: Newspaper, phase: 6 },
      { label: "Events", href: "/events", icon: Bell, phase: 6 },
      { label: "Earnings", href: "/earnings", icon: Gauge, phase: 6 },
    ],
  },
  {
    group: "Research",
    items: [
      { label: "Watchlists", href: "/watchlists", icon: Star, phase: 5 },
      { label: "Strategies", href: "/strategies", icon: BarChart3, phase: 3 },
      { label: "Backtesting", href: "/backtesting", icon: FlaskConical, phase: 11 },
      { label: "Scan History", href: "/history", icon: History, phase: 10 },
    ],
  },
  {
    group: "System",
    items: [
      { label: "Bots", href: "/bots", icon: Bot, phase: 8 },
      { label: "Paper book", href: "/paper", icon: NotebookPen, phase: 11 },
      { label: "Analytics", href: "/analytics", icon: BarChart3, phase: 10 },
      { label: "Alerts", href: "/alerts", icon: Bell, phase: 9 },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export function Sidebar({ demoMode }: { demoMode: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-dvh w-[228px] shrink-0 flex-col border-r border-(--color-border) bg-(--color-bg-accent)">
      {/* brand lockup */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="elev-1 flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-(--color-accent) to-(--color-accent-dim) font-mono text-sm font-bold text-(--color-bg)">
          T
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold leading-tight tracking-tight">
            TradeOS
          </div>
          <div className="label">personal terminal</div>
        </div>
      </div>

      {demoMode ? (
        <div className="mx-3 mb-1 flex items-center justify-center gap-1.5 rounded-md border border-(--color-demo)/40 bg-(--color-demo)/10 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-(--color-demo)">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          Demo mode
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-2 pb-6">
        {NAV.map((section) => (
          <div key={section.group || "root"} className="mt-4 first:mt-2">
            {section.group ? (
              <div className="label px-2 pb-1.5">{section.group}</div>
            ) : null}
            {section.items.map((item) => {
              const active =
                pathname === item.href || pathname?.startsWith(`${item.href}/`);
              const pending = item.phase !== undefined && item.phase > LIVE_PHASE;
              const Icon = item.icon;

              if (pending) {
                return (
                  <span
                    key={item.href}
                    aria-disabled
                    title={`Arrives in phase ${item.phase}`}
                    className="flex cursor-default items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] text-(--color-text-faint)/70"
                  >
                    <Icon size={15} strokeWidth={1.75} className="shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <span className="text-[9px] font-semibold uppercase">
                      P{item.phase}
                    </span>
                  </span>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] transition-colors duration-150 ${
                    active
                      ? "bg-(--color-accent)/12 font-medium text-(--color-accent)"
                      : "text-(--color-text-dim) hover:bg-(--color-surface-2) hover:text-(--color-text)"
                  }`}
                >
                  {/* active rail — position, not just colour */}
                  <span
                    className={`absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-(--color-accent) transition-opacity ${
                      active ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <Icon
                    size={15}
                    strokeWidth={active ? 2.15 : 1.75}
                    className="shrink-0"
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-(--color-border) px-4 py-2.5">
        <p className="text-[10px] leading-relaxed text-(--color-text-faint)">
          Analysis only — never auto-executes
        </p>
      </div>
    </aside>
  );
}
