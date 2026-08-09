"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Client forms for the trade journal (brief §14–16). All derived numbers
 *  (P&L, R, status transitions) are computed server-side. */

interface AssetHit {
  id: string;
  symbol: string;
  name: string;
}

interface StrategyOpt {
  id: string;
  label: string;
}

const input =
  "w-full rounded border border-(--color-border-strong) bg-(--color-surface-2) px-2.5 py-1.5 text-[13px] outline-none focus:border-(--color-accent)";
const label =
  "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-(--color-text-faint)";
const btnPrimary =
  "rounded bg-(--color-accent) px-4 py-1.5 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded border border-(--color-border-strong) px-4 py-1.5 text-[12px] text-(--color-text-dim) hover:text-(--color-text)";

export function NewTrade({ strategies }: { strategies: StrategyOpt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [symbol, setSymbol] = useState("");
  const [assetId, setAssetId] = useState<string | null>(null);
  const [hits, setHits] = useState<AssetHit[]>([]);
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [status, setStatus] = useState<"ACTIVE" | "PLANNED">("ACTIVE");
  const [entryPrice, setEntryPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [target1, setTarget1] = useState("");
  const [target2, setTarget2] = useState("");
  const [strategyVersionId, setStrategyVersionId] = useState("");
  const [setup, setSetup] = useState("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (symbol.trim().length < 1 || assetId) {
      setHits([]);
      return;
    }
    const h = setTimeout(async () => {
      const res = await fetch(`/api/assets?q=${encodeURIComponent(symbol.trim())}`);
      if (res.ok) setHits(await res.json());
    }, 250);
    return () => clearTimeout(h);
  }, [symbol, assetId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (!assetId) throw new Error("pick an asset (add it via Transactions first if new)");
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetId,
          direction,
          status,
          entryPrice,
          quantity,
          stopLoss,
          target1: target1 || null,
          target2: target2 || null,
          strategyVersionId: strategyVersionId || null,
          setup: setup || null,
          entryDate,
          reason: reason || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed");
      setOpen(false);
      setSymbol("");
      setAssetId(null);
      setEntryPrice("");
      setQuantity("");
      setStopLoss("");
      setTarget1("");
      setTarget2("");
      setReason("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={btnPrimary}>
        + New trade
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="relative">
          <label className={label}>Symbol</label>
          <input
            className={input}
            value={symbol}
            placeholder="search assets…"
            onChange={(e) => {
              setSymbol(e.target.value);
              setAssetId(null);
            }}
          />
          {hits.length > 0 ? (
            <div className="absolute z-10 mt-1 w-full rounded border border-(--color-border-strong) bg-(--color-surface-2) shadow-lg">
              {hits.map((h) => (
                <button
                  key={h.id}
                  className="block w-full px-2.5 py-1.5 text-left text-[12px] hover:bg-(--color-surface)"
                  onClick={() => {
                    setAssetId(h.id);
                    setSymbol(h.symbol);
                    setHits([]);
                  }}
                >
                  <span className="font-semibold">{h.symbol}</span>{" "}
                  <span className="text-(--color-text-faint)">{h.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <label className={label}>Direction</label>
          <select className={input} value={direction} onChange={(e) => setDirection(e.target.value as never)}>
            <option>LONG</option>
            <option>SHORT</option>
          </select>
        </div>
        <div>
          <label className={label}>Status</label>
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value as never)}>
            <option>ACTIVE</option>
            <option>PLANNED</option>
          </select>
        </div>
        <div>
          <label className={label}>Entry date</label>
          <input className={input} type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </div>
        <div>
          <label className={label}>Entry price</label>
          <input className={input} inputMode="decimal" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} />
        </div>
        <div>
          <label className={label}>Quantity</label>
          <input className={input} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className={label}>Stop loss</label>
          <input className={input} inputMode="decimal" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
        </div>
        <div>
          <label className={label}>Setup</label>
          <select className={input} value={setup} onChange={(e) => setSetup(e.target.value)}>
            <option value="">—</option>
            <option>PULLBACK</option>
            <option>BREAKOUT</option>
          </select>
        </div>
        <div>
          <label className={label}>Target 1</label>
          <input className={input} inputMode="decimal" value={target1} onChange={(e) => setTarget1(e.target.value)} />
        </div>
        <div>
          <label className={label}>Target 2</label>
          <input className={input} inputMode="decimal" value={target2} onChange={(e) => setTarget2(e.target.value)} />
        </div>
        <div>
          <label className={label}>Strategy</label>
          <select className={input} value={strategyVersionId} onChange={(e) => setStrategyVersionId(e.target.value)}>
            <option value="">—</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Reason</label>
          <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      {error ? (
        <p className="mt-3 rounded border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-[12px] text-(--color-loss)">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button onClick={submit} disabled={busy} className={btnPrimary}>
          {busy ? "Saving…" : "Save trade"}
        </button>
        <button onClick={() => setOpen(false)} className={btnGhost}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ExitTrade({ tradeId, remaining }: { tradeId: string; remaining: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exitPrice, setExitPrice] = useState("");
  const [quantity, setQuantity] = useState(remaining);
  const [fees, setFees] = useState("0");
  const [exitDate, setExitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [exitReason, setExitReason] = useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trades/${tradeId}/exit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exitPrice, quantity, fees: fees || "0", exitDate, exitReason: exitReason || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded border border-(--color-border-strong) px-2 py-1 text-[11px] text-(--color-text-dim) hover:text-(--color-text)">
        Exit
      </button>
    );
  }
  return (
    <div className="mt-2 rounded border border-(--color-border) bg-(--color-surface-2) p-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <div>
          <label className={label}>Exit price</label>
          <input className={input} inputMode="decimal" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} />
        </div>
        <div>
          <label className={label}>Qty (max {remaining})</label>
          <input className={input} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className={label}>Fees</label>
          <input className={input} inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} />
        </div>
        <div>
          <label className={label}>Date</label>
          <input className={input} type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
        </div>
        <div>
          <label className={label}>Reason</label>
          <select className={input} value={exitReason} onChange={(e) => setExitReason(e.target.value)}>
            <option value="">—</option>
            <option>TARGET</option>
            <option>STOP</option>
            <option>INVALIDATED</option>
            <option>TIME</option>
            <option>DISCRETIONARY</option>
          </select>
        </div>
      </div>
      {error ? <p className="mt-2 text-[12px] text-(--color-loss)">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button onClick={submit} disabled={busy} className={btnPrimary}>
          {busy ? "Saving…" : "Confirm exit"}
        </button>
        <button onClick={() => setOpen(false)} className={btnGhost}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const REVIEW_QUESTIONS: Array<{ key: string; text: string }> = [
  { key: "followedStrategy", text: "Followed the strategy?" },
  { key: "followedEntry", text: "Followed the entry plan?" },
  { key: "respectedStop", text: "Respected the stop loss?" },
  { key: "followedTarget", text: "Followed the target plan?" },
  { key: "exitedEarly", text: "Exited early?" },
  { key: "chasedEntry", text: "Chased the entry?" },
  { key: "movedStop", text: "Moved the stop loss?" },
];

export function ReviewTrade({ tradeId, done }: { tradeId: string; done: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, boolean | null>>({});
  const [emotion, setEmotion] = useState("");
  const [lessons, setLessons] = useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trades/${tradeId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...answers,
          emotion: emotion || undefined,
          lessons: lessons || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`rounded border px-2 py-1 text-[11px] ${
          done
            ? "border-(--color-gain)/40 text-(--color-gain)"
            : "border-(--color-border-strong) text-(--color-text-dim) hover:text-(--color-text)"
        }`}
      >
        {done ? "Reviewed ✓" : "Review"}
      </button>
    );
  }
  return (
    <div className="mt-2 rounded border border-(--color-border) bg-(--color-surface-2) p-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {REVIEW_QUESTIONS.map((q) => (
          <div key={q.key} className="flex items-center justify-between gap-2 rounded border border-(--color-border) px-2.5 py-1.5">
            <span className="text-[12px]">{q.text}</span>
            <div className="flex gap-1">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  onClick={() => setAnswers((a) => ({ ...a, [q.key]: a[q.key] === v ? null : v }))}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                    answers[q.key] === v
                      ? v
                        ? "bg-(--color-gain)/20 text-(--color-gain)"
                        : "bg-(--color-loss)/20 text-(--color-loss)"
                      : "bg-(--color-surface) text-(--color-text-faint)"
                  }`}
                >
                  {v ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <label className={label}>Emotion</label>
          <input className={input} placeholder="fear / greed / calm / fomo…" value={emotion} onChange={(e) => setEmotion(e.target.value)} />
        </div>
        <div>
          <label className={label}>Lessons</label>
          <input className={input} value={lessons} onChange={(e) => setLessons(e.target.value)} />
        </div>
      </div>
      {error ? <p className="mt-2 text-[12px] text-(--color-loss)">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button onClick={submit} disabled={busy} className={btnPrimary}>
          {busy ? "Saving…" : "Save review"}
        </button>
        <button onClick={() => setOpen(false)} className={btnGhost}>
          Cancel
        </button>
      </div>
    </div>
  );
}
