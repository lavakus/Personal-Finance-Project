import { Badge, Card, PnL } from "@/components/ui";
import { gatherAnalystSnapshot } from "@/lib/data/analyst";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

import { GenerateAnalysis } from "./analyst-client";

export const dynamic = "force-dynamic";

/** AI market analyst (brief §61–62). The structured snapshot renders
 *  always; the Claude-written narrative is opt-in per click. */
export default async function AnalystPage() {
  if (isDemoMode) {
    return (
      <Card title="AI Market Analyst" action={<Badge tone="demo">demo</Badge>}>
        <p className="text-[13px] text-(--color-text-dim)">Connect Supabase first.</p>
      </Card>
    );
  }

  const sb = await createServerSupabase();
  const snap = await gatherAnalystSnapshot(sb);
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <div className="space-y-4">
      <Card title="AI Market Analyst">
        <GenerateAnalysis configured={configured} />
      </Card>

      <Card title="What the analyst sees (verified snapshot)">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-(--color-text-faint)">
              Market regime
            </div>
            {snap.regime ? (
              <div className="flex items-center gap-2">
                <Badge tone={snap.regime.label.includes("BULL") ? "gain" : "warn"}>
                  {snap.regime.label}
                </Badge>
                <span className="num text-[12px] text-(--color-text-dim)">
                  score {snap.regime.score > 0 ? "+" : ""}{snap.regime.score.toFixed(0)}
                  {snap.regime.breadth !== null ? ` · breadth ${snap.regime.breadth.toFixed(0)}%` : ""}
                </span>
              </div>
            ) : (
              <Badge tone="neutral">no data</Badge>
            )}
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-(--color-text-faint)">
              Top sectors (20d RS)
            </div>
            {snap.sectors.top.length === 0 ? (
              <Badge tone="neutral">no data</Badge>
            ) : (
              <ul className="space-y-0.5 text-[12px]">
                {snap.sectors.top.map((s) => (
                  <li key={s.sector} className="flex justify-between gap-2">
                    <span>#{s.rank} {s.sector}</span>
                    {s.rs20 !== null ? <PnL value={s.rs20} suffix="%" /> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-(--color-text-faint)">
              Latest scan ({snap.scan?.date ?? "none"})
            </div>
            {!snap.scan ? (
              <Badge tone="neutral">no scans published</Badge>
            ) : snap.scan.noTrade ? (
              <Badge tone="warn">NO TRADE</Badge>
            ) : (
              <ul className="space-y-0.5 text-[12px]">
                {snap.scan.setups.map((s) => (
                  <li key={s.symbol}>
                    <span className="font-semibold">{s.symbol}</span>{" "}
                    <span className="text-(--color-text-faint)">
                      {s.setup} · {s.score.toFixed(0)} ({s.tier})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-(--color-text-faint)">
              Portfolio
            </div>
            <div className="text-[12px] text-(--color-text-dim)">
              invested ₹{Number(snap.portfolio.invested).toLocaleString("en-IN")} ·{" "}
              {snap.portfolio.unrealizedPnl !== null ? (
                <PnL value={Number(snap.portfolio.unrealizedPnl)} />
              ) : (
                "unrealized n/a"
              )}{" "}
              · {snap.portfolio.holdings.length} holdings
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-(--color-text-faint)">
              Open trades
            </div>
            <div className="num text-[12px]">{snap.openTrades.length}</div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-(--color-text-faint)">
              Earnings within 5 days
            </div>
            {snap.earningsSoon.length === 0 ? (
              <span className="text-[12px] text-(--color-text-faint)">none recorded</span>
            ) : (
              <ul className="text-[12px]">
                {snap.earningsSoon.map((e) => (
                  <li key={e.symbol}>
                    <span className="font-semibold">{e.symbol}</span>{" "}
                    <span className="text-(--color-text-faint)">{e.date}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
