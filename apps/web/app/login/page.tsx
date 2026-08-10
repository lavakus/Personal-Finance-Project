"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, Lock, Mail } from "lucide-react";

import { Badge } from "@/components/ui";
import { isDemoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

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
        setInfo(
          "Account created. Check your email if confirmation is enabled, then sign in."
        );
        setMode("signin");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg border border-(--color-border-strong) bg-(--color-bg) py-2.5 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-(--color-text-faint) focus:border-(--color-accent)";

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      {/* ambient glow — depth without an image asset */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-(--color-accent)/10 blur-[110px]"
      />

      <div className="rise relative w-full max-w-[380px]">
        {/* brand */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="elev-2 mb-3 grid h-11 w-11 place-items-center rounded-xl bg-linear-to-br from-(--color-accent) to-(--color-accent-dim) font-mono text-lg font-bold text-(--color-bg)">
            T
          </div>
          <h1 className="text-xl font-semibold tracking-tight">TradeOS</h1>
          <p className="mt-1 text-xs text-(--color-text-dim)">
            Personal investment &amp; trading terminal
          </p>
        </div>

        <div className="elev-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-6">
          {isDemoMode ? (
            <div className="space-y-4 text-center">
              <Badge tone="demo" dot>
                Demo mode — auth disabled
              </Badge>
              <p className="text-xs leading-relaxed text-(--color-text-dim)">
                Supabase is not configured, so the app runs with clearly labelled
                sample data and no sign-in. See supabase/README.md to go live.
              </p>
              <button
                onClick={() => router.push("/dashboard")}
                className="group inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-(--color-accent) py-2.5 text-sm font-semibold text-(--color-bg) transition-opacity hover:opacity-90"
              >
                Enter demo
                <ArrowRight
                  size={15}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <label htmlFor="email" className="label mb-1.5 block">
                  Email
                </label>
                <div className="relative">
                  <Mail
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-faint)"
                  />
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={field}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="label mb-1.5 block">
                  Password
                </label>
                <div className="relative">
                  <Lock
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-faint)"
                  />
                  <input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                    placeholder="at least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={field}
                  />
                </div>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="rounded-lg border border-(--color-loss)/30 bg-(--color-loss)/10 px-3 py-2 text-xs text-(--color-loss)"
                >
                  {error}
                </p>
              ) : null}
              {info ? (
                <p
                  role="status"
                  className="rounded-lg border border-(--color-gain)/30 bg-(--color-gain)/10 px-3 py-2 text-xs text-(--color-gain)"
                >
                  {info}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-(--color-accent) py-2.5 text-sm font-semibold text-(--color-bg) transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-50"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : null}
                {busy
                  ? "Working…"
                  : mode === "signin"
                    ? "Sign in"
                    : "Create account"}
              </button>

              <button
                type="button"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="w-full cursor-pointer text-center text-xs text-(--color-text-dim) transition-colors hover:text-(--color-text)"
              >
                {mode === "signin"
                  ? "New here? Create an account"
                  : "Have an account? Sign in"}
              </button>
            </form>
          )}
        </div>

        {!isDemoMode ? (
          <p className="mt-4 text-center text-[10px] leading-relaxed text-(--color-text-faint)">
            First account becomes ADMIN automatically.
            <br />
            Analysis and plans only — this platform never executes trades.
          </p>
        ) : null}
      </div>
    </div>
  );
}
