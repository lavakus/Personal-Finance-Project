"use client";

import { useState } from "react";

/** Click-through explainable score (brief §3 — the most important design
 *  principle). Components and weights come straight from the stored scan. */

const COMPONENT_LABELS: Record<string, string> = {
  market_regime: "Market regime",
  sector_strength: "Sector strength",
  relative_strength: "Relative strength",
  trend_structure: "Trend structure",
  setup_quality: "Setup quality",
  volume_confirmation: "Volume",
  momentum: "Momentum",
  risk_reward: "Risk/reward",
};

export function ScoreBreakdown({
  total,
  tier,
  components,
  weights,
  why,
  warnings,
}: {
  total: string;
  tier: string;
  components: Record<string, number>;
  weights: Record<string, number>;
  why: string[];
  warnings: string[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="num cursor-pointer rounded px-1.5 py-0.5 font-semibold text-(--color-accent) underline decoration-dotted underline-offset-4 hover:bg-(--color-accent)/10"
        title="Click for the full score breakdown"
      >
        {Number(total).toFixed(0)}
        <span className="ml-1 text-[10px] text-(--color-text-faint)">({tier})</span>
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 w-80 rounded-lg border border-(--color-border-strong) bg-(--color-surface) p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-(--color-text-faint)">
              Why this score
            </span>
            <button onClick={() => setOpen(false)} className="text-(--color-text-faint) hover:text-(--color-text)">
              ✕
            </button>
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {Object.entries(components).map(([k, v]) => (
                <tr key={k}>
                  <td className="py-0.5 text-(--color-text-dim)">
                    {COMPONENT_LABELS[k] ?? k}
                  </td>
                  <td className="num w-16 text-right">{v.toFixed(0)}</td>
                  <td className="w-24 pl-2">
                    <div className="h-1.5 rounded bg-(--color-surface-2)">
                      <div
                        className="h-1.5 rounded bg-(--color-accent)"
                        style={{ width: `${Math.min(100, Math.max(0, v))}%` }}
                      />
                    </div>
                  </td>
                  <td className="num w-14 pl-2 text-right text-(--color-text-faint)">
                    +{(weights[k] ?? 0).toFixed(1)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-(--color-border)">
                <td className="pt-1 font-semibold">Total</td>
                <td className="num pt-1 text-right font-semibold">{Number(total).toFixed(1)}</td>
                <td />
                <td className="num pt-1 text-right text-(--color-text-faint)">{tier}</td>
              </tr>
            </tbody>
          </table>

          {why.length > 0 ? (
            <div className="mt-2 border-t border-(--color-border) pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-(--color-gain)">
                Why selected
              </div>
              <ul className="mt-1 space-y-0.5 text-[11px] text-(--color-text-dim)">
                {why.map((w) => (
                  <li key={w}>✓ {w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="mt-2 border-t border-(--color-border) pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-(--color-warn)">
                Caution
              </div>
              <ul className="mt-1 space-y-0.5 text-[11px] text-(--color-warn)">
                {warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
