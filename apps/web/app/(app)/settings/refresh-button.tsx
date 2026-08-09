"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** On-demand job trigger (admin session authorizes server-side). */
export function RunJob({
  endpoint,
  label,
  describe,
}: {
  endpoint: string;
  label: string;
  describe: (body: Record<string, unknown>) => string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "job failed");
      setResult(describe(body));
      router.refresh();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "job failed");
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
        {busy ? "Running… (30–60s)" : label}
      </button>
      {result ? (
        <p className="mt-2 text-[12px] text-(--color-text-dim)">{result}</p>
      ) : null}
    </div>
  );
}

export function RefreshMarketData() {
  return (
    <RunJob
      endpoint="/api/jobs/market-data"
      label="Refresh market data now"
      describe={(b) =>
        `Updated ${b.indices} indices, ${b.assets} assets` +
        (Array.isArray(b.errors) && b.errors.length
          ? ` — ${b.errors.length} errors: ${b.errors[0]}`
          : "")
      }
    />
  );
}

export function RefreshNews() {
  return (
    <RunJob
      endpoint="/api/jobs/news"
      label="Refresh news now"
      describe={(b) => `Fetched ${b.fetched}, inserted ${b.inserted}, mapped ${b.mapped} asset links`}
    />
  );
}
