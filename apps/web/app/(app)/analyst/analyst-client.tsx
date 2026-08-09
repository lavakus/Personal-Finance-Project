"use client";

import { useState } from "react";

export function GenerateAnalysis({ configured }: { configured: boolean }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/analyst", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed");
      setText(body.analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-[13px] text-(--color-text-dim)">
        Set <span className="font-mono">ANTHROPIC_API_KEY</span> in the server
        environment to enable Claude-written briefings. The structured summary
        below works without it.
      </p>
    );
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={busy}
        className="rounded bg-(--color-accent) px-4 py-1.5 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Analyzing… (10–30s)" : "Generate today's briefing"}
      </button>
      {error ? (
        <p className="mt-3 rounded border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-[12px] text-(--color-loss)">
          {error}
        </p>
      ) : null}
      {text ? (
        <pre className="mt-4 whitespace-pre-wrap rounded border border-(--color-border) bg-(--color-surface-2) p-4 font-sans text-[13px] leading-relaxed">
          {text}
        </pre>
      ) : null}
      <p className="mt-3 text-[11px] text-(--color-text-faint)">
        The analyst only reads verified database values — it cannot invent
        prices or results. This is analysis, never a trading instruction.
      </p>
    </div>
  );
}
