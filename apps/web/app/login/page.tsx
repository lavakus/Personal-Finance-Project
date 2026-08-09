"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/env";
import { Badge } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const supabase = createClient();
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/dashboard");
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo("Account created. Check your email if confirmation is enabled, then sign in.");
        setMode("signin");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-(--color-border) bg-(--color-surface) p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded bg-(--color-accent)/15 font-mono text-lg font-bold text-(--color-accent)">
            T
          </div>
          <h1 className="text-lg font-bold">TradeOS</h1>
          <p className="text-xs text-(--color-text-dim)">
            Personal investment &amp; trading terminal
          </p>
        </div>

        {isDemoMode ? (
          <div className="space-y-3 text-center">
            <Badge tone="demo">Demo mode — auth disabled</Badge>
            <p className="text-xs text-(--color-text-dim)">
              Supabase is not configured, so the app runs with labeled sample
              data and no sign-in. See supabase/README.md to go live.
            </p>
            <button
              onClick={() => router.push("/dashboard")}
              className="w-full rounded bg-(--color-accent)/15 py-2 text-sm font-semibold text-(--color-accent) hover:bg-(--color-accent)/25"
            >
              Enter demo →
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-(--color-border-strong) bg-(--color-bg) px-3 py-2 text-sm outline-none focus:border-(--color-accent)"
            />
            <input
              type="password"
              required
              minLength={8}
              placeholder="password (min 8 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-(--color-border-strong) bg-(--color-bg) px-3 py-2 text-sm outline-none focus:border-(--color-accent)"
            />
            {error ? <p className="text-xs text-(--color-loss)">{error}</p> : null}
            {info ? <p className="text-xs text-(--color-gain)">{info}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-(--color-accent)/15 py-2 text-sm font-semibold text-(--color-accent) hover:bg-(--color-accent)/25 disabled:opacity-50"
            >
              {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="w-full text-center text-xs text-(--color-text-dim) hover:text-(--color-text)"
            >
              {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
            </button>
            <p className="pt-1 text-center text-[10px] text-(--color-text-faint)">
              First account becomes ADMIN automatically.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
