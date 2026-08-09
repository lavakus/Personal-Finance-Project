"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const input =
  "rounded border border-(--color-border-strong) bg-(--color-surface-2) px-2.5 py-1.5 text-[13px] outline-none focus:border-(--color-accent)";

export function NewPriceAlert() {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [level, setLevel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol, direction, level: Number(level) }),
    });
    if (!res.ok) setError((await res.json()).error ?? "failed");
    else {
      setSymbol("");
      setLevel("");
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={`${input} w-32`} placeholder="SYMBOL" value={symbol}
             onChange={(e) => setSymbol(e.target.value)} />
      <select className={input} value={direction}
              onChange={(e) => setDirection(e.target.value as never)}>
        <option value="above">crosses above</option>
        <option value="below">crosses below</option>
      </select>
      <input className={`${input} w-28`} inputMode="decimal" placeholder="price"
             value={level} onChange={(e) => setLevel(e.target.value)} />
      <button
        onClick={submit}
        disabled={busy || !symbol.trim() || !Number(level)}
        className="rounded bg-(--color-accent) px-3 py-1.5 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-50"
      >
        + Alert
      </button>
      {error ? <span className="text-[12px] text-(--color-loss)">{error}</span> : null}
    </div>
  );
}

export function MarkAllRead() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/alerts?read=all", { method: "PATCH" });
        router.refresh();
      }}
      className="rounded border border-(--color-border-strong) px-2.5 py-1 text-[11px] text-(--color-text-dim) hover:text-(--color-text)"
    >
      Mark all read
    </button>
  );
}

export function DisableRule({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch(`/api/alerts?id=${id}`, { method: "PATCH" });
        router.refresh();
      }}
      className="text-(--color-text-faint) hover:text-(--color-loss)"
      title="disable rule"
    >
      ✕
    </button>
  );
}
