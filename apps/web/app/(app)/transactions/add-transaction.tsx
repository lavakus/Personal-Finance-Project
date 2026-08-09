"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { PortfolioAccount } from "@tradeos/types";

/**
 * Add-transaction form (brief §11). BUY/SELL amounts are computed on the
 * server with decimal math — this form only collects raw inputs.
 */

const TYPES = ["BUY", "SELL", "DEPOSIT", "WITHDRAWAL", "DIVIDEND", "FEE", "TRANSFER"] as const;
const ASSET_TYPES = new Set(["BUY", "SELL", "DIVIDEND"]);
const CLASSES = ["EQUITY_IN", "CRYPTO", "GOLD", "CASH", "GLOBAL_INDEX", "OTHER"] as const;
const CURRENCIES = ["INR", "OMR", "USD"] as const;

interface AssetHit {
  id: string;
  symbol: string;
  name: string;
  asset_class: string;
}

export function AddTransaction({ accounts }: { accounts: PortfolioAccount[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<(typeof TYPES)[number]>("BUY");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [symbol, setSymbol] = useState("");
  const [assetName, setAssetName] = useState("");
  const [assetClass, setAssetClass] = useState<(typeof CLASSES)[number]>("EQUITY_IN");
  const [assetId, setAssetId] = useState<string | null>(null);
  const [hits, setHits] = useState<AssetHit[]>([]);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [fees, setFees] = useState("0");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("INR");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const needsAsset = ASSET_TYPES.has(type);
  const isTrade = type === "BUY" || type === "SELL";

  // debounce asset search
  useEffect(() => {
    if (!needsAsset || symbol.trim().length < 1) {
      setHits([]);
      return;
    }
    const h = setTimeout(async () => {
      const res = await fetch(`/api/assets?q=${encodeURIComponent(symbol.trim())}`);
      if (res.ok) setHits(await res.json());
    }, 250);
    return () => clearTimeout(h);
  }, [symbol, needsAsset]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let finalAssetId = assetId;
      if (needsAsset && !finalAssetId) {
        // create-if-missing (idempotent upsert server-side)
        const res = await fetch("/api/assets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            symbol: symbol.trim().toUpperCase(),
            name: assetName.trim() || symbol.trim().toUpperCase(),
            assetClass,
            currency,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "asset create failed");
        finalAssetId = body.id;
      }

      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          assetId: needsAsset ? finalAssetId : null,
          type,
          quantity: isTrade ? quantity : null,
          price: isTrade ? price : null,
          amount: isTrade ? undefined : amount,
          currency,
          fees: fees || "0",
          executedAt: new Date(`${date}T12:00:00Z`).toISOString(),
          notes: notes || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed");

      setOpen(false);
      setQuantity("");
      setPrice("");
      setAmount("");
      setNotes("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded border border-(--color-border-strong) bg-(--color-surface-2) px-2.5 py-1.5 text-[13px] outline-none focus:border-(--color-accent)";
  const label = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-(--color-text-faint)";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-(--color-accent) px-3 py-1.5 text-[12px] font-semibold text-black hover:opacity-90"
      >
        + Add transaction
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className={label}>Type</label>
          <select className={input} value={type} onChange={(e) => setType(e.target.value as never)}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Account</label>
          <select className={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Currency</label>
          <select className={input} value={currency} onChange={(e) => setCurrency(e.target.value as never)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Date</label>
          <input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {needsAsset ? (
          <>
            <div className="relative">
              <label className={label}>Symbol</label>
              <input
                className={input}
                placeholder="RELIANCE / BTC / GOLD"
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value);
                  setAssetId(null);
                }}
              />
              {hits.length > 0 && !assetId ? (
                <div className="absolute z-10 mt-1 w-full rounded border border-(--color-border-strong) bg-(--color-surface-2) shadow-lg">
                  {hits.map((h) => (
                    <button
                      key={h.id}
                      className="block w-full px-2.5 py-1.5 text-left text-[12px] hover:bg-(--color-surface)"
                      onClick={() => {
                        setAssetId(h.id);
                        setSymbol(h.symbol);
                        setAssetName(h.name);
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
              <label className={label}>Asset name (new assets)</label>
              <input
                className={input}
                placeholder="autofilled if found"
                value={assetName}
                onChange={(e) => setAssetName(e.target.value)}
              />
            </div>
            <div>
              <label className={label}>Asset class</label>
              <select
                className={input}
                value={assetClass}
                onChange={(e) => setAssetClass(e.target.value as never)}
              >
                {CLASSES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        {isTrade ? (
          <>
            <div>
              <label className={label}>Quantity</label>
              <input className={input} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <label className={label}>Price</label>
              <input className={input} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </>
        ) : (
          <div>
            <label className={label}>Amount</label>
            <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        )}

        <div>
          <label className={label}>Fees</label>
          <input className={input} inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className={label}>Notes</label>
          <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-[12px] text-(--color-loss)">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          onClick={submit}
          disabled={busy || !accountId}
          className="rounded bg-(--color-accent) px-4 py-1.5 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded border border-(--color-border-strong) px-4 py-1.5 text-[12px] text-(--color-text-dim) hover:text-(--color-text)"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
