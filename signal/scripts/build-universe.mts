/**
 * Builds the live coverage universe: US-listed companies with a market cap of at least $10B.
 *
 *   LSE_API_KEY=... npx tsx scripts/build-universe.mts
 *
 * Market caps come from the Nasdaq stock screener (USD, all US listings). Names, sectors,
 * exchanges, websites and logo availability come from London Strategic Edge fundamentals.
 * Output: src/lib/live/universe.json (committed snapshot; rerun to refresh).
 */
import { writeFileSync } from "node:fs";

const MIN_CAP = 10_000_000_000;
const KEY = process.env.LSE_API_KEY;
if (!KEY) throw new Error("LSE_API_KEY is required");
const LSE = "https://api.londonstrategicedge.com/vault";

interface ScreenerRow { symbol: string; name: string; marketCap: string; sector: string; industry: string; country: string }
interface Fundamentals { symbol: string; name: string; exchange: string; sector: string | null; industry: string | null; market_cap: number | null; logo_url: string | null; website: string | null }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lse<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${LSE}${path}`, { headers: { "x-api-key": KEY! } });
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return (await res.json()) as T;
  }
  throw new Error(`rate limited: ${path}`);
}

const cleanName = (n: string) =>
  n
    .replace(/\s+(Common Stock|Ordinary Shares|American Depositary Shares|Class [A-Z] (Common Stock|Ordinary Shares|Subordinate Voting Shares)|Depositary Shares).*$/i, "")
    .replace(/\s+\(The\)$/i, "")
    .trim();

const screener = (await (await fetch("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true", { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } })).json()) as { data: { rows: ScreenerRow[] } };
// Common equity only: drop notes, debentures, preferreds and fractional depositary shares that
// inherit the issuer's market cap in the screener. ADRs ("American Depositary Shares") stay.
const NOT_EQUITY = /\bnotes?\b|debentures?|preferred|perpetual|cumulative|\bZONES\b|corporate units|equity units?|tangible equity|interest in a share|(?<!american |global )depositary shares/i;
const big = screener.data.rows
  .filter((r) => Number(r.marketCap) >= MIN_CAP && !r.symbol.includes("^") && /^[A-Z]{1,5}(\/[A-Z])?$/.test(r.symbol.trim()) && !NOT_EQUITY.test(r.name))
  .map((r) => ({ ...r, symbol: r.symbol.trim().replace("/", ".") }));
console.log(`screener: ${big.length} US listings at or above $10B`);

const page = await lse<Fundamentals[]>("/ref/stock_fundamentals?limit=5000");
const fund = new Map(page.map((f) => [f.symbol, f]));
const missing = big.filter((r) => !fund.has(r.symbol) && !fund.has(r.symbol.replace(".", "-")));
console.log(`fundamentals: ${fund.size} on first page, ${missing.length} to look up`);
const queue = [...missing];
await Promise.all(
  Array.from({ length: 2 }, async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      for (const sym of [r.symbol, r.symbol.replace(".", "-")]) {
        try {
          const rows = await lse<Fundamentals[]>(`/ref/stock_fundamentals?symbol=${encodeURIComponent(sym)}`);
          if (rows[0]) {
            fund.set(r.symbol, rows[0]);
            break;
          }
        } catch {
          /* not covered by LSE fundamentals */
        }
      }
      await sleep(350);
    }
  }),
);

const out = big.map((r) => {
  const f = fund.get(r.symbol) ?? fund.get(r.symbol.replace(".", "-"));
  let web: string | null = null;
  try {
    web = f?.website ? new URL(f.website).hostname.replace(/^www\./, "") : null;
  } catch {
    web = null;
  }
  return {
    t: r.symbol,
    n: cleanName(f?.name || r.name),
    x: f?.exchange && f.exchange !== "US" ? f.exchange : null,
    s: f?.sector || r.sector || null,
    i: f?.industry || r.industry || null,
    cap: Math.round(Number(r.marketCap)),
    logo: f?.logo_url ? `lse:${f.symbol}` : null,
    web,
  };
});

// Keep only logos that resolve: London Strategic Edge first, then FMP's public logo images.
const lq = [...out];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let o = lq.shift(); o; o = lq.shift()) {
      if (o.logo) {
        const res = await fetch(`https://api.londonstrategicedge.com/logos/${encodeURIComponent(o.logo.slice(4))}.png`, { method: "HEAD" }).catch(() => null);
        if (res?.ok) continue;
        o.logo = null;
      }
      const sym = o.t.replace(".", "-");
      const res = await fetch(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(sym)}.png`).catch(() => null);
      if (res?.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) o.logo = `fmp:${sym}`;
      await res?.arrayBuffer().catch(() => null);
    }
  }),
);

out.sort((a, b) => b.cap - a.cap);
writeFileSync(new URL("../src/lib/live/universe.json", import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), minMarketCapUsd: MIN_CAP, source: "Nasdaq stock screener (market cap) + London Strategic Edge fundamentals", securities: out }) + "\n");
const logos = out.filter((o) => o.logo).map((o) => o.t);
writeFileSync(
  new URL("../src/lib/live/logoTickers.ts", import.meta.url),
  `// Generated by scripts/build-universe.mts: covered tickers with a resolvable logo.\nexport const LOGO_TICKERS: ReadonlySet<string> = new Set(${JSON.stringify(logos.join(" "))}.split(" "));\n`,
);
console.log(`wrote ${out.length} securities; ${out.filter((o) => o.logo).length} with logos; ${out.filter((o) => o.x).length} with exchange`);
