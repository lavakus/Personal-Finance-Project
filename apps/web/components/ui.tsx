/** Small UI primitives for the terminal look. No component framework —
 *  dense financial UI needs full control and near-zero bundle weight. */

import type { ReactNode } from "react";

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-(--color-border) bg-(--color-surface) ${className}`}
    >
      {title ? (
        <header className="flex items-center justify-between border-b border-(--color-border) px-4 py-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--color-text-dim)">
            {title}
          </h2>
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "gain" | "loss" | "warn" | "demo" | "neutral" | "accent";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    gain: "text-(--color-gain) border-(--color-gain)/40 bg-(--color-gain)/10",
    loss: "text-(--color-loss) border-(--color-loss)/40 bg-(--color-loss)/10",
    warn: "text-(--color-warn) border-(--color-warn)/40 bg-(--color-warn)/10",
    demo: "text-(--color-demo) border-(--color-demo)/40 bg-(--color-demo)/10",
    accent: "text-(--color-accent) border-(--color-accent)/40 bg-(--color-accent)/10",
    neutral: "text-(--color-text-dim) border-(--color-border-strong) bg-(--color-surface-2)",
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function PnL({ value, suffix = "" }: { value: number; suffix?: string }) {
  const cls =
    value > 0
      ? "text-(--color-gain)"
      : value < 0
        ? "text-(--color-loss)"
        : "text-(--color-text-dim)";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`num ${cls}`}>
      {sign}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-(--color-text-faint)">
        {label}
      </div>
      <div className="num mt-1 text-lg font-semibold">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-(--color-text-dim)">{sub}</div> : null}
    </div>
  );
}
