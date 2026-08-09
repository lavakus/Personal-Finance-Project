import { describe, expect, it } from "vitest";

import {
  classifyImpact,
  classifySentiment,
  matchAssets,
  parseRss,
} from "../src/index";

describe("parseRss", () => {
  it("parses items with CDATA and entities", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title><![CDATA[Sensex &amp; Nifty surge 2%]]></title>
        <link>https://example.com/a</link>
        <pubDate>Fri, 08 Aug 2026 10:00:00 +0530</pubDate></item>
      <item><title>Second story</title><link>https://example.com/b</link></item>
    </channel></rss>`;
    const items = parseRss(xml);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("Sensex & Nifty surge 2%");
    expect(items[0]?.link).toBe("https://example.com/a");
    expect(items[1]?.pubDate).toBeNull();
  });

  it("ignores malformed items without title/link", () => {
    expect(parseRss("<rss><item><title>x</title></item></rss>")).toHaveLength(0);
  });
});

describe("heuristic classification (labeled, never an auto-signal)", () => {
  it("sentiment", () => {
    expect(classifySentiment("IT stocks surge on strong results")).toBe("POSITIVE");
    expect(classifySentiment("Bank shares plunge after fraud probe")).toBe("NEGATIVE");
    expect(classifySentiment("Company announces AGM date")).toBe("NEUTRAL");
    // mixed signals stay neutral
    expect(classifySentiment("Stock surges then crashes")).toBe("NEUTRAL");
  });
  it("impact", () => {
    expect(classifyImpact("RBI holds repo rate")).toBe("HIGH");
    expect(classifyImpact("Company wins order worth 500cr")).toBe("MEDIUM");
    expect(classifyImpact("Office relocation announced")).toBe("LOW");
  });
});

describe("matchAssets (brief §34 news → stock mapping)", () => {
  const assets = [
    { id: "1", symbol: "RELIANCE", name: "Reliance Industries" },
    { id: "2", symbol: "TCS", name: "Tata Consultancy Services" },
    { id: "3", symbol: "BTC", name: "Bitcoin" },
  ];
  it("matches by symbol token", () => {
    expect(matchAssets("RELIANCE hits record high", assets)).toEqual(["1"]);
  });
  it("matches by company name prefix", () => {
    expect(matchAssets("Reliance Industries Q1 beats estimates", assets)).toEqual(["1"]);
  });
  it("does not match substrings inside other words", () => {
    expect(matchAssets("SELF-RELIANCE in manufacturing", assets)).toEqual([]);
  });
  it("multiple hits", () => {
    const hits = matchAssets("TCS and Reliance Industries lead gains", assets);
    expect(hits.sort()).toEqual(["1", "2"]);
  });
});
