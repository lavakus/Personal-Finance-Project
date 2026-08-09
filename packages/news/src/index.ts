/**
 * @tradeos/news — NewsProvider abstraction (brief §73) with an RSS adapter.
 *
 * Sources are official RSS feeds published for syndication — headline,
 * link, timestamp and source only; article bodies are never scraped.
 * Sentiment/impact are keyword HEURISTICS and are labeled as such in the
 * UI; they are inputs to research, never auto-signals (brief §35).
 */

export interface NewsItem {
  headline: string;
  url: string;
  source: string;
  publishedAt: string; // ISO
  category: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  impact: "HIGH" | "MEDIUM" | "LOW";
}

export interface NewsProvider {
  id: string;
  getLatestNews(): Promise<NewsItem[]>;
}

export interface FeedSpec {
  url: string;
  source: string;
  category: string;
}

/** Official syndication feeds — extend freely; each entry is one source. */
export const DEFAULT_FEEDS: FeedSpec[] = [
  {
    url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    source: "Economic Times Markets",
    category: "INDIAN_MARKET",
  },
  {
    url: "https://www.moneycontrol.com/rss/marketreports.xml",
    source: "Moneycontrol Markets",
    category: "INDIAN_MARKET",
  },
  {
    url: "https://www.livemint.com/rss/markets",
    source: "Mint Markets",
    category: "INDIAN_MARKET",
  },
  {
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    source: "CoinDesk",
    category: "CRYPTO",
  },
];

// ───────────────────────────────────────── tiny dependency-free RSS parse

function textBetween(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return null;
  return m[1]!
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

export function parseRss(xml: string): Array<{
  title: string;
  link: string;
  pubDate: string | null;
}> {
  const items: Array<{ title: string; link: string; pubDate: string | null }> = [];
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  for (const chunk of chunks) {
    const item = chunk.split(/<\/item>/i)[0] ?? "";
    const title = textBetween(item, "title");
    const link = textBetween(item, "link") ?? textBetween(item, "guid");
    const pubDate = textBetween(item, "pubDate") ?? textBetween(item, "dc:date");
    if (title && link) items.push({ title, link, pubDate });
  }
  return items;
}

// ─────────────────────────────────── heuristic sentiment/impact (labeled)

const POSITIVE_WORDS =
  /\b(surge|soar|rall(y|ies)|jump|gain|record high|beats?|upgrade|bullish|profit rises?|strong (results|demand|growth)|wins? (order|contract|deal)|dividend|bonus issue|buyback|expands?)\b/i;
const NEGATIVE_WORDS =
  /\b(crash|plunge|slump|tumble|fall|sink|drop|loss(es)? widen|miss(es)? estimate|downgrade|bearish|fraud|probe|penalt(y|ies)|default|layoffs?|recall|strike|ban|weak (results|demand)|cuts? guidance)\b/i;
const HIGH_IMPACT =
  /\b(RBI|Fed|rate (cut|hike|decision)|budget|inflation|CPI|GDP|earnings|results|merger|acquisition|SEBI|crash|circuit|geopoliti|war|sanctions?|tariffs?)\b/i;
const MEDIUM_IMPACT =
  /\b(FII|DII|IPO|stake|order win|wins? (an? )?order|contract|guidance|outlook|upgrade|downgrade|dividend|split|bonus)\b/i;

export function classifySentiment(headline: string): NewsItem["sentiment"] {
  const pos = POSITIVE_WORDS.test(headline);
  const neg = NEGATIVE_WORDS.test(headline);
  if (pos && !neg) return "POSITIVE";
  if (neg && !pos) return "NEGATIVE";
  return "NEUTRAL";
}

export function classifyImpact(headline: string): NewsItem["impact"] {
  if (HIGH_IMPACT.test(headline)) return "HIGH";
  if (MEDIUM_IMPACT.test(headline)) return "MEDIUM";
  return "LOW";
}

/** Map a headline to known assets by symbol/name token match (brief §34). */
export function matchAssets(
  headline: string,
  assets: Array<{ id: string; symbol: string; name: string }>
): string[] {
  const h = ` ${headline.toUpperCase()} `;
  const hits: string[] = [];
  for (const a of assets) {
    const sym = a.symbol.toUpperCase();
    const nameHead = a.name.toUpperCase().split(/\s+/).slice(0, 2).join(" ");
    if (
      (sym.length >= 3 && h.includes(` ${sym} `)) ||
      (nameHead.length >= 5 && h.includes(nameHead))
    ) {
      hits.push(a.id);
    }
  }
  return hits;
}

// ───────────────────────────────────────────────────── the RSS provider

export function createRssNewsProvider(
  feeds: FeedSpec[] = DEFAULT_FEEDS
): NewsProvider {
  return {
    id: "rss",
    async getLatestNews(): Promise<NewsItem[]> {
      const out: NewsItem[] = [];
      for (const feed of feeds) {
        try {
          const res = await fetch(feed.url, {
            headers: { "user-agent": "Mozilla/5.0 (personal news reader)" },
          });
          if (!res.ok) continue;
          const xml = await res.text();
          for (const item of parseRss(xml).slice(0, 25)) {
            const published = item.pubDate ? new Date(item.pubDate) : new Date();
            if (Number.isNaN(published.getTime())) continue;
            out.push({
              headline: item.title,
              url: item.link,
              source: feed.source,
              publishedAt: published.toISOString(),
              category: feed.category,
              sentiment: classifySentiment(item.title),
              impact: classifyImpact(item.title),
            });
          }
        } catch {
          // one bad feed never kills the run; provider status records errors upstream
        }
      }
      return out;
    },
  };
}
