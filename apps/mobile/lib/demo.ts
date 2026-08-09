/** DEMO MODE sample data — labeled, never mixed with live values. */

export const demo = {
  portfolio: { value: "₹13,87,400", changePct: "+10.99%" },
  markets: [
    { label: "NIFTY", change: "+0.42%", up: true },
    { label: "BTC", change: "+1.82%", up: true },
    { label: "GOLD", change: "+0.34%", up: true },
  ],
  regime: "BULLISH",
  topSectors: ["Auto", "IT", "Healthcare"],
  topSetups: [
    { symbol: "EMCURE", score: 77, setup: "PULLBACK" },
  ],
  importantNews: 3,
  events: 2,
  activeTrades: 2,
  botPnl: "—",
};
