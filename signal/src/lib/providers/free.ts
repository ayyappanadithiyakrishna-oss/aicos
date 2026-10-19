/**
 * Free, keyless data sources used for live mode:
 * - RSS: CNBC finance/economy/earnings feeds (publisher syndication feeds; headline + link + teaser)
 *   and Federal Reserve press releases (official, public domain).
 * - GDELT DOC 2.0: open global news index (headline + link only; ≤1 request / 5 s).
 * - Yahoo Finance chart endpoint: unofficial, delayed prices for research display; no key, no SLA.
 * - BLS public API v1: official CPI / payrolls / unemployment (no key, low daily quota → cached).
 * - Nasdaq Trader symbol directory: listed tickers and names.
 * None of these charge money. Coverage and timeliness are limited and labelled as such.
 */
import type { PriceBar, Security } from "@/lib/domain/types";
import type { RawRecord } from "@/lib/ingestion/types";
import { sanitizeText, safeExternalUrl } from "@/lib/security/sanitize";
import { ProviderError, providerFetch, providerJson } from "./http";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; SIGNAL research)" };

export interface RssFeed {
  id: string;
  sourceId: string;
  publisher: string;
  url: string;
  kind: RawRecord["kind"];
  original: boolean;
}

export const RSS_FEEDS: RssFeed[] = [
  { id: "cnbc-top", sourceId: "cnbc", publisher: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", kind: "news", original: false },
  { id: "cnbc-finance", sourceId: "cnbc", publisher: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664", kind: "news", original: false },
  { id: "cnbc-earnings", sourceId: "cnbc", publisher: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135", kind: "news", original: false },
  { id: "cnbc-economy", sourceId: "cnbc", publisher: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", kind: "news", original: false },
  { id: "fed-press", sourceId: "fed", publisher: "Federal Reserve Board", url: "https://www.federalreserve.gov/feeds/press_all.xml", kind: "press_release", original: true },
];

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? decode(m[1]!).trim() : "";
};

export function parseRss(xml: string, feed: RssFeed, fetchedAt: string): RawRecord[] {
  const out: RawRecord[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1]!;
    const url = safeExternalUrl(tag(b, "link"));
    const title = sanitizeText(tag(b, "title"), 300);
    if (!url || !title) continue;
    const pub = Date.parse(tag(b, "pubDate"));
    out.push({
      provider: feed.sourceId,
      providerId: url,
      kind: feed.kind,
      url,
      title,
      excerpt: sanitizeText(tag(b, "description"), 400),
      contentScope: "snippet",
      publisher: feed.publisher,
      sourceId: feed.sourceId,
      publishedAt: Number.isFinite(pub) ? new Date(pub).toISOString() : null,
      fetchedAt,
      tickers: [],
      isOriginalDisclosure: feed.original,
      isSynthetic: false,
      internalPath: null,
    });
  }
  return out;
}

export async function fetchRss(feed: RssFeed, fetchedAt: string, fetchImpl?: typeof fetch): Promise<RawRecord[]> {
  const res = await providerFetch(feed.url, { provider: feed.sourceId, ratePerSec: 2, headers: UA, revalidate: 300, fetchImpl, attempts: 2 });
  const xml = await res.text();
  if (!xml.includes("<item")) throw new ProviderError(feed.sourceId, "schema", `${feed.id}: not an RSS document`);
  return parseRss(xml, feed, fetchedAt);
}

const GDELT_QUERY = '(earnings OR "stock market" OR "federal reserve" OR inflation OR merger OR acquisition OR tariff OR "interest rates") sourcecountry:US sourcelang:english';

export async function gdeltNews(fetchedAt: string, fetchImpl?: typeof fetch): Promise<RawRecord[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(GDELT_QUERY)}&mode=ArtList&format=json&maxrecords=60&timespan=1d&sort=DateDesc`;
  const res = await providerFetch(url, { provider: "gdelt", ratePerSec: 0.2, revalidate: 600, fetchImpl, attempts: 1 });
  const text = await res.text();
  if (!text.trim().startsWith("{")) throw new ProviderError("gdelt", "rate_limited", "GDELT asked to slow down (≤1 request / 5 s)");
  let data: { articles?: Array<{ url: string; title: string; seendate: string; domain: string }> };
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("gdelt", "schema", "GDELT returned invalid JSON");
  }
  return (data.articles ?? []).flatMap((a) => {
    const url = safeExternalUrl(a.url);
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(a.seendate ?? "");
    if (!url || !a.title) return [];
    return [
      {
        provider: "gdelt",
        providerId: url,
        kind: "news" as const,
        url,
        title: sanitizeText(a.title, 300),
        excerpt: "",
        contentScope: "title_only" as const,
        publisher: sanitizeText(a.domain, 80),
        sourceId: "gdelt",
        // GDELT reports when it first saw the article, not the publisher timestamp.
        publishedAt: m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null,
        fetchedAt,
        tickers: [],
        isOriginalDisclosure: false,
        isSynthetic: false,
        internalPath: null,
      },
    ];
  });
}

interface YahooChart {
  chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }> } }>; error?: unknown };
}

const barCache = new Map<string, { at: number; p: Promise<PriceBar[]> }>();

/** Yahoo chart bars, cached per instance and de-duplicated while in flight. */
export function yahooBars(symbol: string, interval: "1d" | "30m", fetchImpl?: typeof fetch): Promise<PriceBar[]> {
  const key = `${symbol}|${interval}`;
  const ttl = interval === "1d" ? 15 * 60_000 : 5 * 60_000;
  const hit = barCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.p;
  const p = fetchYahooBars(symbol, interval, fetchImpl);
  barCache.set(key, { at: Date.now(), p });
  p.catch(() => barCache.delete(key));
  return p;
}

/** Yahoo chart bars, re-stamped at bar END so "available at t" holds (no look-ahead). */
async function fetchYahooBars(symbol: string, interval: "1d" | "30m", fetchImpl?: typeof fetch): Promise<PriceBar[]> {
  const range = interval === "1d" ? "2y" : "10d";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const data = await providerJson<YahooChart>(url, { provider: "yahoo", ratePerSec: 12, headers: UA, revalidate: interval === "1d" ? 900 : 300, fetchImpl, attempts: 2 });
  const r = data.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q) throw new ProviderError("yahoo", "schema", `No chart data for ${symbol}`);
  const out: PriceBar[] = [];
  r.timestamp.forEach((ts, i) => {
    const c = q.close[i];
    if (c === null || c === undefined || !(c > 0)) return;
    // Daily bars: timestamp is the session open → stamp at 16:00 ET close (20:00/21:00 UTC handled by caller's calendar).
    const end = interval === "1d" ? ts * 1000 + 6.5 * 3_600_000 : ts * 1000 + 30 * 60_000;
    out.push({ t: new Date(end).toISOString(), o: q.open[i] ?? c, h: q.high[i] ?? c, l: q.low[i] ?? c, c, v: q.volume[i] ?? 0 });
  });
  return out;
}

export interface BlsRelease {
  indicator: string;
  period: string;
  unit: string;
  actual: number;
  prior: number | null;
}

const BLS_SERIES = [
  { id: "CUUR0000SA0", indicator: "CPI (YoY, NSA)", unit: "%", kind: "yoy" as const },
  { id: "CES0000000001", indicator: "Nonfarm Payrolls (change)", unit: "K", kind: "diff" as const },
  { id: "LNS14000000", indicator: "Unemployment Rate", unit: "%", kind: "level" as const },
];

export async function blsReleases(fetchImpl?: typeof fetch): Promise<BlsRelease[]> {
  const out: BlsRelease[] = [];
  for (const s of BLS_SERIES) {
    const data = await providerJson<{ status: string; Results?: { series?: Array<{ data: Array<{ year: string; period: string; periodName: string; value: string }> }> } }>(
      `https://api.bls.gov/publicAPI/v1/timeseries/data/${s.id}`,
      { provider: "bls", ratePerSec: 1, revalidate: 43_200, fetchImpl, attempts: 1 },
    );
    if (data.status !== "REQUEST_SUCCEEDED") throw new ProviderError("bls", "quota", `BLS: ${data.status}`);
    const rows = (data.Results?.series?.[0]?.data ?? []).filter((d) => d.period.startsWith("M") && d.period !== "M13");
    const v = (i: number) => (rows[i] ? Number(rows[i]!.value) : null);
    const calc = (i: number): number | null => {
      const cur = v(i);
      if (cur === null) return null;
      if (s.kind === "level") return cur;
      if (s.kind === "diff") return v(i + 1) === null ? null : Math.round(cur - v(i + 1)!);
      return v(i + 12) === null ? null : Math.round((cur / v(i + 12)! - 1) * 1000) / 10;
    };
    const a = calc(0);
    if (a === null || !rows[0]) continue;
    out.push({ indicator: s.indicator, period: `${rows[0].periodName} ${rows[0].year}`, unit: s.unit, actual: a, prior: calc(1) });
  }
  return out;
}

/** Nasdaq Trader directory → securities (ticker + name). */
export async function nasdaqDirectory(fetchImpl?: typeof fetch): Promise<Security[]> {
  const files = ["https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt", "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt"];
  const out: Security[] = [];
  for (const f of files) {
    const res = await providerFetch(f, { provider: "nasdaqtrader", ratePerSec: 2, revalidate: 86_400, fetchImpl, attempts: 2 });
    const lines = (await res.text()).split("\n").slice(1);
    for (const line of lines) {
      const c = line.split("|");
      const sym = c[0]?.trim();
      const name = c[1]?.trim();
      if (!sym || !name || sym.startsWith("File Creation") || !/^[A-Z]{1,5}$/.test(sym)) continue;
      const etf = (f.includes("nasdaqlisted") ? c[6] : c[4]) === "Y";
      out.push({
        id: `us:${sym}`,
        ticker: sym,
        name: name.replace(/ - .*$/, "").replace(/ (Common Stock|Class [A-Z] Common Stock|Ordinary Shares).*$/i, ""),
        kind: etf ? "etf" : "equity",
        exchange: f.includes("nasdaqlisted") ? "NASDAQ" : "NYSE/other",
        currency: "USD",
        sector: "Unclassified",
        industry: "Unclassified",
        marketCapBucket: null,
        beta: null,
        sigmaDaily: null,
        benchmarkId: "live:SPY",
        isSynthetic: false,
        brandingRights: "none",
        tickerHistory: [],
      });
    }
  }
  return out;
}
