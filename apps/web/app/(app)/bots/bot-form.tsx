"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const input =
  "rounded border border-(--color-border-strong) bg-(--color-surface-2) px-2.5 py-1.5 text-[13px] outline-none focus:border-(--color-accent)";

export function NewBot() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [strategy, setStrategy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; apiKey: string } | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), strategy: strategy.trim() || undefined }),
    });
    const body = await res.json();
    if (!res.ok) setError(body.error ?? "failed");
    else {
      setIssued({ name: body.name, apiKey: body.apiKey });
      setName("");
      setStrategy("");
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} w-48`} placeholder="bot name" value={name}
               onChange={(e) => setName(e.target.value)} />
        <input className={`${input} w-48`} placeholder="strategy (optional)" value={strategy}
               onChange={(e) => setStrategy(e.target.value)} />
        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          className="rounded bg-(--color-accent) px-3 py-1.5 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-50"
        >
          + Register bot
        </button>
        {error ? <span className="text-[12px] text-(--color-loss)">{error}</span> : null}
      </div>

      {issued ? (
        <div className="rounded border border-(--color-warn)/50 bg-(--color-warn)/10 p-3">
          <p className="text-[12px] font-semibold text-(--color-warn)">
            API key for “{issued.name}” — copy it NOW, it is shown only once:
          </p>
          <code className="mt-1 block break-all rounded bg-(--color-surface-2) px-2 py-1.5 font-mono text-[12px]">
            {issued.apiKey}
          </code>
          <p className="mt-2 text-[11px] text-(--color-text-faint)">
            Sign requests with HMAC-SHA256(key, `timestamp.body`) in
            x-signature, plus x-api-key and x-timestamp (ms) headers, to
            POST /api/bots/trades · /equity · /heartbeat.
          </p>
          <button
            onClick={() => setIssued(null)}
            className="mt-2 rounded border border-(--color-border-strong) px-2.5 py-1 text-[11px] text-(--color-text-dim)"
          >
            I saved it — dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
