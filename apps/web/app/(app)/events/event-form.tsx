"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const input =
  "rounded border border-(--color-border-strong) bg-(--color-surface-2) px-2.5 py-1.5 text-[13px] outline-none focus:border-(--color-accent)";

export function AddEvent({ kind }: { kind: "corporate" | "earnings" }) {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  const [date, setDate] = useState("");
  const [eventType, setEventType] = useState("EARNINGS");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        symbol,
        date,
        eventType: kind === "corporate" ? eventType : undefined,
        period: kind === "earnings" ? period || undefined : undefined,
      }),
    });
    if (!res.ok) setError((await res.json()).error ?? "failed");
    else {
      setSymbol("");
      setDate("");
      setPeriod("");
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={`${input} w-32`} placeholder="SYMBOL" value={symbol}
             onChange={(e) => setSymbol(e.target.value)} />
      <input className={input} type="date" value={date}
             onChange={(e) => setDate(e.target.value)} />
      {kind === "corporate" ? (
        <select className={input} value={eventType} onChange={(e) => setEventType(e.target.value)}>
          {["EARNINGS", "DIVIDEND", "SPLIT", "BONUS", "AGM", "M&A", "OTHER"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      ) : (
        <input className={`${input} w-24`} placeholder="Q1FY27" value={period}
               onChange={(e) => setPeriod(e.target.value)} />
      )}
      <button
        onClick={submit}
        disabled={busy || !symbol.trim() || !date}
        className="rounded bg-(--color-accent) px-3 py-1.5 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-50"
      >
        + Add
      </button>
      {error ? <span className="text-[12px] text-(--color-loss)">{error}</span> : null}
    </div>
  );
}
