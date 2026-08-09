import { describe, expect, it } from "vitest";

import {
  allocationPct,
  cagr,
  cashBalance,
  cashDelta,
  d,
  positionSize,
  returnPct,
  riskReward,
  rMultiple,
  strategyStats,
  unrealizedPnl,
  walkLedger,
} from "../src/index";

describe("positionSize (brief §32 example)", () => {
  it("capital 200k, risk 1%, entry 1420, SL 1385 -> qty 57", () => {
    const r = positionSize({
      accountSize: "200000",
      riskPct: "1",
      entry: "1420",
      stopLoss: "1385",
    });
    expect(r.maxRisk.toString()).toBe("2000");
    expect(r.riskPerShare.toString()).toBe("35");
    expect(r.quantity.toString()).toBe("57");
    expect(r.capitalRequired.toString()).toBe("80940");
  });

  it("zero risk distance -> zero quantity, no crash", () => {
    const r = positionSize({ accountSize: 100000, riskPct: 1, entry: 100, stopLoss: 100 });
    expect(r.quantity.toString()).toBe("0");
  });
});

describe("rMultiple / riskReward", () => {
  it("long win: entry 100, stop 95, exit 110 -> +2R", () => {
    expect(
      rMultiple({ direction: "LONG", entry: 100, exit: 110, stopLoss: 95 }).toString()
    ).toBe("2");
  });
  it("long loss at stop -> -1R", () => {
    expect(
      rMultiple({ direction: "LONG", entry: 100, exit: 95, stopLoss: 95 }).toString()
    ).toBe("-1");
  });
  it("short win: entry 100, stop 105, exit 90 -> +2R", () => {
    expect(
      rMultiple({ direction: "SHORT", entry: 100, exit: 90, stopLoss: 105 }).toString()
    ).toBe("2");
  });
  it("riskReward: entry 100, stop 95, target 110 -> 2", () => {
    expect(riskReward({ entry: 100, stopLoss: 95, target: 110 }).toString()).toBe("2");
  });
});

describe("walkLedger (weighted average cost)", () => {
  it("two buys re-weight the average", () => {
    const s = walkLedger([
      { type: "BUY", quantity: 10, price: 100 },
      { type: "BUY", quantity: 10, price: 120 },
    ]);
    expect(s.quantity.toString()).toBe("20");
    expect(s.averageCost.toString()).toBe("110");
    expect(s.investedValue.toString()).toBe("2200");
  });

  it("sell books realized P&L at average cost, net of fees", () => {
    const s = walkLedger([
      { type: "BUY", quantity: 10, price: 100, fees: 10 }, // avg = 101
      { type: "SELL", quantity: 5, price: 121, fees: 5 },  // (121-101)*5 - 5 = 95
    ]);
    expect(s.averageCost.toString()).toBe("101");
    expect(s.realizedPnl.toString()).toBe("95");
    expect(s.quantity.toString()).toBe("5");
  });

  it("floating-point trap case stays exact: 0.1 + 0.2 style quantities", () => {
    const s = walkLedger([
      { type: "BUY", quantity: "0.1", price: "3", fees: "0" },
      { type: "BUY", quantity: "0.2", price: "3", fees: "0" },
    ]);
    expect(s.quantity.toString()).toBe("0.3");        // NOT 0.30000000000000004
    expect(s.investedValue.toString()).toBe("0.9");
  });

  it("overselling throws instead of going negative", () => {
    expect(() =>
      walkLedger([
        { type: "BUY", quantity: 5, price: 10 },
        { type: "SELL", quantity: 6, price: 12 },
      ])
    ).toThrow(/exceeds/);
  });

  it("full exit resets average cost", () => {
    const s = walkLedger([
      { type: "BUY", quantity: 5, price: 10 },
      { type: "SELL", quantity: 5, price: 12 },
    ]);
    expect(s.quantity.toString()).toBe("0");
    expect(s.averageCost.toString()).toBe("0");
    expect(s.realizedPnl.toString()).toBe("10");
  });
});

describe("unrealized P&L / returns / allocation", () => {
  it("unrealized from holding state", () => {
    const s = walkLedger([{ type: "BUY", quantity: 10, price: 100 }]);
    expect(unrealizedPnl(s, 105).toString()).toBe("50");
  });
  it("returnPct handles zero invested", () => {
    expect(returnPct(0, 500).toString()).toBe("0");
    expect(returnPct(1000, 1150).toString()).toBe("15");
  });
  it("allocationPct", () => {
    expect(allocationPct(2500, 10000).toString()).toBe("25");
  });
});

describe("cagr", () => {
  it("doubles in 2 years -> ~41.42%", () => {
    const r = cagr({ begin: 100, end: 200, days: 730.5 });
    expect(r.toNumber()).toBeCloseTo(41.42, 1);
  });
  it("guards non-positive inputs", () => {
    expect(cagr({ begin: 0, end: 100, days: 365 }).toString()).toBe("0");
  });
});

describe("strategyStats", () => {
  it("computes core stats", () => {
    const s = strategyStats([
      { netPnl: 100, r: 2, holdingDays: 5 },
      { netPnl: -50, r: -1, holdingDays: 3 },
      { netPnl: 200, r: 3, holdingDays: 10 },
      { netPnl: -50, r: -1, holdingDays: 2 },
    ]);
    expect(s.trades).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.winRate.toString()).toBe("50");
    expect(s.profitFactor.toString()).toBe("3");       // 300 / 100
    expect(s.expectancy.toString()).toBe("50");        // 200/4
    expect(s.avgR.toString()).toBe("0.75");
    expect(s.avgHoldingDays.toString()).toBe("5");
  });
  it("empty input returns zeros", () => {
    expect(strategyStats([]).trades).toBe(0);
  });
});

describe("cash ledger (brief §11)", () => {
  it("signed deltas per transaction type", () => {
    expect(cashDelta({ type: "DEPOSIT", amount: 1000 }).toString()).toBe("1000");
    expect(cashDelta({ type: "WITHDRAWAL", amount: 400 }).toString()).toBe("-400");
    expect(cashDelta({ type: "BUY", amount: 500, fees: 5 }).toString()).toBe("-505");
    expect(cashDelta({ type: "SELL", amount: 600, fees: 6 }).toString()).toBe("594");
    expect(cashDelta({ type: "DIVIDEND", amount: 50 }).toString()).toBe("50");
    expect(cashDelta({ type: "FEE", amount: 20 }).toString()).toBe("-20");
    expect(cashDelta({ type: "TRANSFER", amount: 300 }).toString()).toBe("-300");
  });

  it("balance walks the full ledger with decimal precision", () => {
    const bal = cashBalance([
      { type: "DEPOSIT", amount: "100000" },
      { type: "BUY", amount: "80940", fees: "42.7" },
      { type: "SELL", amount: "20000.10", fees: "10.05" },
      { type: "FEE", amount: "99.95" },
    ]);
    expect(bal.toString()).toBe("38907.4");
  });

  it("0.1 + 0.2 style floats never corrupt the balance", () => {
    const bal = cashBalance([
      { type: "DEPOSIT", amount: "0.1" },
      { type: "DEPOSIT", amount: "0.2" },
    ]);
    expect(bal.toString()).toBe("0.3");
  });
});
