import Link from "next/link";

import { Badge, Card } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

import { AddSymbol, NewWatchlist, RemoveItem } from "./watchlist-forms";

export const dynamic = "force-dynamic";

interface WatchlistRow {
  id: string;
  name: string;
  watchlist_items: Array<{ id: string; symbol: string; note: string | null }>;
}

/** Custom watchlists (brief §49). */
export default async function WatchlistsPage() {
  if (isDemoMode) {
    return (
      <Card title="Watchlists" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">
          Connect Supabase to create watchlists.
        </p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let lists: WatchlistRow[];
  try {
    const { data, error } = await sb
      .from("watchlists")
      .select("id, name, watchlist_items (id, symbol, note)")
      .is("deleted_at", null)
      .order("created_at");
    if (error) throw new Error(error.message);
    lists = data as unknown as WatchlistRow[];
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0005_intelligence.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <NewWatchlist />
      {lists.length === 0 ? (
        <Card title="Watchlists">
          <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
            No watchlists yet — create one above (e.g. Breakouts, High Conviction,
            Long-term, Research).
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lists.map((l) => (
            <Card key={l.id} title={l.name} action={<AddSymbol watchlistId={l.id} />}>
              {l.watchlist_items.length === 0 ? (
                <p className="py-3 text-center text-[12px] text-(--color-text-faint)">
                  empty — add a symbol
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {l.watchlist_items.map((it) => (
                    <li key={it.id} className="flex items-center justify-between rounded border border-(--color-border) bg-(--color-surface-2) px-2.5 py-1.5 text-[13px]">
                      <Link
                        href={`/research?symbol=${it.symbol}`}
                        className="font-semibold hover:text-(--color-accent)"
                      >
                        {it.symbol}
                      </Link>
                      <RemoveItem watchlistId={l.id} itemId={it.id} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
