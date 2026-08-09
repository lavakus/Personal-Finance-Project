"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const input =
  "rounded border border-(--color-border-strong) bg-(--color-surface-2) px-2.5 py-1.5 text-[13px] outline-none focus:border-(--color-accent)";
const btn =
  "rounded bg-(--color-accent) px-3 py-1.5 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-50";

export function NewWatchlist() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/watchlists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) setError((await res.json()).error ?? "failed");
    else {
      setName("");
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        className={input}
        placeholder="new watchlist name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button onClick={submit} disabled={busy || !name.trim()} className={btn}>
        + Create
      </button>
      {error ? <span className="text-[12px] text-(--color-loss)">{error}</span> : null}
    </div>
  );
}

export function AddSymbol({ watchlistId }: { watchlistId: string }) {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!symbol.trim()) return;
    setBusy(true);
    await fetch(`/api/watchlists/${watchlistId}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: symbol.trim().toUpperCase() }),
    });
    setSymbol("");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        className={`${input} w-32`}
        placeholder="add symbol"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button onClick={submit} disabled={busy || !symbol.trim()} className={btn}>
        +
      </button>
    </div>
  );
}

export function RemoveItem({ watchlistId, itemId }: { watchlistId: string; itemId: string }) {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch(`/api/watchlists/${watchlistId}/items?itemId=${itemId}`, {
          method: "DELETE",
        });
        router.refresh();
      }}
      className="text-(--color-text-faint) hover:text-(--color-loss)"
      title="remove"
    >
      ✕
    </button>
  );
}
