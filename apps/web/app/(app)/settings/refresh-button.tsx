"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** On-demand market-data refresh (admin session authorizes server-side). */
export function RefreshMarketData() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/jobs/market-data", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "refresh failed");
      setResult(
        `Updated ${body.indices} indices, ${body.assets} assets` +
          (body.errors?.length ? ` — ${body.errors.length} errors: ${body.errors[0]}` : "")
      );
      router.refresh();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "refresh failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={busy}
        className="rounded bg-(--color-accent) px-3 py-1.5 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Refreshing… (30–60s)" : "Refresh market data now"}
      </button>
      {result ? (
        <p className="mt-2 text-[12px] text-(--color-text-dim)">{result}</p>
      ) : null}
    </div>
  );
}
