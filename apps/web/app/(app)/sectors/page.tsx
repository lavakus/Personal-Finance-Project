import { Badge, Card, PnL } from "@/components/ui";
import { isMigrationPending } from "@/lib/data/portfolio";
import { getLatestSectorRankings } from "@/lib/data/scanner";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Sector rotation (brief §20) — computed from constituents by swingscan
 *  (the stale ^CNX* Yahoo sector indices are deliberately not used). */
export default async function SectorsPage() {
  if (isDemoMode) {
    return (
      <Card title="Sector rotation" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">
          Connect Supabase and publish a scan to see sector rankings.
        </p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  let rows;
  try {
    rows = await getLatestSectorRankings(sb);
  } catch (e) {
    if (!isMigrationPending(e)) throw e;
    return (
      <div className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-3 text-[13px] text-(--color-warn)">
        Database migration <span className="font-mono font-semibold">0005_intelligence.sql</span> has
        not been applied yet — run it in the Supabase SQL editor, then reload.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card title="Sector rotation">
        <p className="py-6 text-center text-[13px] text-(--color-text-faint)">
          No sector rankings yet — publish a scan first.
        </p>
      </Card>
    );
  }

  const heat = (v: string | null) => {
    const n = Number(v ?? 0);
    if (n >= 3) return "bg-(--color-gain)/30";
    if (n >= 1) return "bg-(--color-gain)/15";
    if (n <= -3) return "bg-(--color-loss)/30";
    if (n <= -1) return "bg-(--color-loss)/15";
    return "";
  };

  return (
    <Card title={`Sector relative strength vs NIFTY — ${rows[0]?.date}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-(--color-text-faint)">
              <th className="pb-2 font-medium">#</th>
              <th className="pb-2 font-medium">Sector</th>
              <th className="pb-2 text-right font-medium">5D</th>
              <th className="pb-2 text-right font-medium">10D</th>
              <th className="pb-2 text-right font-medium">20D</th>
              <th className="pb-2 text-right font-medium">60D</th>
              <th className="pb-2 text-right font-medium">Blend</th>
              <th className="pb-2 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sector} className="border-t border-(--color-border)">
                <td className="num py-2">{r.rank}</td>
                <td className="py-2 font-semibold">{r.sector}</td>
                {(["rs5", "rs10", "rs20", "rs60"] as const).map((k) => (
                  <td key={k} className={`num py-2 text-right ${heat(r[k])}`}>
                    <PnL value={Number(r[k] ?? 0)} suffix="%" />
                  </td>
                ))}
                <td className="num py-2 text-right">
                  <PnL value={Number(r.rs_blend ?? 0)} suffix="%" />
                </td>
                <td className="num py-2 text-right">{Number(r.score ?? 0).toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-(--color-text-faint)">
        Relative strength = sector composite return minus NIFTY return over the
        window. Composites are built from constituent stocks (equal weight).
      </p>
    </Card>
  );
}
