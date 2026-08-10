/** Small UI primitives for the terminal look. No component framework —
 *  dense financial UI needs full control and near-zero bundle weight. */

import type { ReactNode } from "react";

export function Card({
  title,
  action,
  children,
  className = "",
  delay,
  flush = false,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Stagger index for the entrance animation. */
  delay?: number;
  /** Drop the body padding — for tables that should meet the card edge. */
  flush?: boolean;
}) {
  return (
    <section
      style={delay ? ({ "--d": `${delay * 45}ms` } as React.CSSProperties) : undefined}
      className={`elev-1 rise rounded-xl border border-(--color-border) bg-(--color-surface) ${className}`}
    >
      {title ? (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-(--color-border) px-4 py-2.5">
          <h2 className="label truncate">{title}</h2>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </header>
      ) : null}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

const TONES: Record<string, string> = {
  gain: "text-(--color-gain) border-(--color-gain)/30 bg-(--color-gain)/10",
  loss: "text-(--color-loss) border-(--color-loss)/30 bg-(--color-loss)/10",
  warn: "text-(--color-warn) border-(--color-warn)/30 bg-(--color-warn)/10",
  demo: "text-(--color-demo) border-(--color-demo)/30 bg-(--color-demo)/10",
  accent: "text-(--color-accent) border-(--color-accent)/30 bg-(--color-accent)/10",
  neutral: "text-(--color-text-dim) border-(--color-border-strong) bg-(--color-surface-2)",
};

export function Badge({
  tone = "neutral",
  children,
  dot = false,
}: {
  tone?: "gain" | "loss" | "warn" | "demo" | "neutral" | "accent";
  children: ReactNode;
  /** Leading status dot — reads faster than colour alone. */
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TONES[tone]}`}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/** Signed value. The arrow means direction is never conveyed by colour alone. */
export function PnL({
  value,
  suffix = "",
  prefix = "",
  arrow = false,
  className = "",
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  arrow?: boolean;
  className?: string;
}) {
  const cls =
    value > 0
      ? "text-(--color-gain)"
      : value < 0
        ? "text-(--color-loss)"
        : "text-(--color-text-dim)";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`num ${cls} ${className}`}>
      {arrow ? (value > 0 ? "▲ " : value < 0 ? "▼ " : "· ") : null}
      {sign}
      {prefix}
      {Math.abs(value) >= 1000
        ? Math.round(value).toLocaleString("en-IN")
        : value.toFixed(2)}
      {suffix}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  size = "md",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** `lg` is for the two or three numbers that matter most on a page. */
  size?: "md" | "lg";
}) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div
        className={`display mt-1 truncate ${
          size === "lg" ? "text-[26px] leading-tight" : "text-lg"
        }`}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-(--color-text-dim)">{sub}</div> : null}
    </div>
  );
}

/** Placeholder for a value we genuinely do not have. Never show a zero or a
 *  guess in its place (brief §90). */
export function NoData({ hint }: { hint?: string }) {
  return (
    <span
      className="text-(--color-text-faint)"
      title={hint ?? "No data available"}
    >
      —
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-8 text-center text-[13px] leading-relaxed text-(--color-text-faint)">
      {children}
    </p>
  );
}

/** Proportion bar — for allocation, score components, breadth. */
export function Meter({
  pct,
  tone = "accent",
  className = "",
}: {
  pct: number;
  tone?: "accent" | "gain" | "loss" | "warn";
  className?: string;
}) {
  const fill = {
    accent: "bg-(--color-accent)",
    gain: "bg-(--color-gain)",
    loss: "bg-(--color-loss)",
    warn: "bg-(--color-warn)",
  }[tone];
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-(--color-surface-3) ${className}`}
      role="img"
      aria-label={`${clamped.toFixed(0)} percent`}
    >
      <div
        className={`h-full rounded-full ${fill} transition-[width] duration-500`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/**
 * Sparkline. Deliberately dependency-free inline SVG — a chart library for a
 * 60×20 polyline would cost more than the rest of the page.
 */
export function Sparkline({
  points,
  width = 68,
  height = 22,
  tone,
}: {
  points: number[];
  width?: number;
  height?: number;
  tone?: "gain" | "loss";
}) {
  if (points.length < 2) return <NoData hint="Not enough history" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const pad = 2;
  const usable = height - pad * 2;
  const d = points
    .map((p, i) => {
      const x = i * step;
      const y = pad + usable - ((p - min) / span) * usable;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const up = points[points.length - 1]! >= points[0]!;
  const stroke =
    (tone ?? (up ? "gain" : "loss")) === "gain"
      ? "var(--color-gain)"
      : "var(--color-loss)";
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden
      className="overflow-visible"
    >
      <path d={d} stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Table shell so every table on every page shares one rhythm. */
export function Table({
  head,
  children,
}: {
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-(--color-border) [&>th]:label [&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:pb-2 [&>th]:pt-3 [&>th]:font-semibold">
            {head}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-(--color-border)/60 [&>tr:last-child]:border-0 [&>tr]:transition-colors [&>tr:hover]:bg-(--color-surface-2)/60 [&_td]:px-4 [&_td]:py-2.5">
          {children}
        </tbody>
      </table>
    </div>
  );
}
