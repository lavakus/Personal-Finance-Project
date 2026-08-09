"use client";

import { useState } from "react";

import { positionSize, riskReward } from "@tradeos/calculations";

/** Position-size calculator (brief §32). Pure decimal math from
 *  @tradeos/calculations — the same functions the API uses. */
export function PositionCalculator() {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState("200000");
  const [riskPct, setRiskPct] = useState("1");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");

  const input =
    "w-full rounded border border-(--color-border-strong) bg-(--color-surface-2) px-2.5 py-1.5 text-[13px] outline-none focus:border-(--color-accent)";
  const label =
    "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-(--color-text-faint)";

  let result: {
    maxRisk: string;
    riskPerShare: string;
    quantity: string;
    capital: string;
    rr: string | null;
  } | null = null;
  try {
    if (account && riskPct && entry && stop && Number(entry) !== Number(stop)) {
      const r = positionSize({ accountSize: account, riskPct, entry, stopLoss: stop });
      result = {
        maxRisk: r.maxRisk.toFixed(0),
        riskPerShare: r.riskPerShare.toFixed(2),
        quantity: r.quantity.toFixed(0),
        capital: r.capitalRequired.toFixed(0),
        rr: target ? riskReward({ entry, stopLoss: stop, target }).toFixed(2) : null,
      };
    }
  } catch {
    result = null;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-(--color-border-strong) px-3 py-1.5 text-[12px] text-(--color-text-dim) hover:text-(--color-text)"
      >
        Position size calculator
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--color-text-dim)">
          Position size (risk-first)
        </h3>
        <button onClick={() => setOpen(false)} className="text-(--color-text-faint) hover:text-(--color-text)">
          ✕
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div>
          <label className={label}>Account (₹)</label>
          <input className={input} inputMode="decimal" value={account} onChange={(e) => setAccount(e.target.value)} />
        </div>
        <div>
          <label className={label}>Risk %</label>
          <input className={input} inputMode="decimal" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
        </div>
        <div>
          <label className={label}>Entry</label>
          <input className={input} inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} />
        </div>
        <div>
          <label className={label}>Stop loss</label>
          <input className={input} inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} />
        </div>
        <div>
          <label className={label}>Target (optional)</label>
          <input className={input} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
      </div>
      {result ? (
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-(--color-border) pt-3 sm:grid-cols-5">
          <div>
            <div className={label}>Max risk</div>
            <div className="num text-lg font-semibold">₹{Number(result.maxRisk).toLocaleString("en-IN")}</div>
          </div>
          <div>
            <div className={label}>Risk / share</div>
            <div className="num text-lg font-semibold">₹{result.riskPerShare}</div>
          </div>
          <div>
            <div className={label}>Quantity</div>
            <div className="num text-lg font-semibold text-(--color-accent)">{result.quantity}</div>
          </div>
          <div>
            <div className={label}>Capital required</div>
            <div className="num text-lg font-semibold">₹{Number(result.capital).toLocaleString("en-IN")}</div>
          </div>
          <div>
            <div className={label}>R:R to target</div>
            <div className="num text-lg font-semibold">{result.rr ?? "—"}</div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-(--color-text-faint)">
          Fill account, risk %, entry and stop to compute.
        </p>
      )}
    </div>
  );
}
