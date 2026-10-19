/**
 * Provider registry for live mode: which adapters are configured, which are entitled for public
 * display, and their measured health. Selection is by capability; nothing unconfigured is called.
 */
import type { Source } from "@/lib/domain/types";
import type { ProviderHealthView } from "@/lib/data/views";
import { providerMetrics } from "@/lib/providers/http";
import { secUserAgent } from "@/lib/providers/sec";

export interface LiveConfig {
  secUa: string | null;
  fredKey: string | null;
  fmpKey: string | null;
  fmpDisplay: boolean;
  fmpConsensus: boolean;
  massiveKey: string | null;
  massiveDisplay: boolean;
  llm: boolean;
  /** London Strategic Edge vault key: candles, fundamentals, economic calendar with consensus. */
  lseKey: string | null;
  marketauxKey: string | null;
  newsApiKey: string | null;
  /** Free keyless sources (RSS, GDELT, Yahoo chart, BLS, Nasdaq directory). On unless LIVE_FREE_SOURCES=false. */
  free: boolean;
}

export function liveConfig(env: NodeJS.ProcessEnv = process.env): LiveConfig {
  return {
    secUa: secUserAgent(env),
    fredKey: env.FRED_API_KEY || null,
    fmpKey: env.FMP_API_KEY || null,
    fmpDisplay: env.FMP_DISPLAY_LICENSE === "confirmed",
    fmpConsensus: env.FMP_CONSENSUS_LICENSED === "true",
    massiveKey: env.MASSIVE_API_KEY || null,
    massiveDisplay: env.MASSIVE_DISPLAY_LICENSE === "confirmed",
    llm: Boolean(env.ANTHROPIC_API_KEY) && env.LLM_PROCESSING_ALLOWED === "true",
    free: env.LIVE_FREE_SOURCES !== "false",
    lseKey: env.LSE_API_KEY || null,
    marketauxKey: env.MARKETAUX_API_KEY || null,
    newsApiKey: env.NEWSAPI_API_KEY || null,
  };
}

export function anyLiveProvider(c: LiveConfig): boolean {
  return Boolean(c.free || c.lseKey || c.marketauxKey || c.newsApiKey || c.secUa || c.fredKey || (c.fmpKey && c.fmpDisplay) || (c.massiveKey && c.massiveDisplay));
}

export function priceProvider(c: LiveConfig): "lse" | "fmp" | "massive" | "yahoo" | null {
  if (c.lseKey) return "lse";
  if (c.fmpKey && c.fmpDisplay) return "fmp";
  if (c.massiveKey && c.massiveDisplay) return "massive";
  if (c.free) return "yahoo";
  return null;
}

export function liveSources(c: LiveConfig): Source[] {
  return [
    { id: "sec-edgar", name: "SEC EDGAR", kind: "regulator", reliability: 0.98, homepage: "https://www.sec.gov/", displayLicensed: true, permittedFields: ["title", "form", "items", "accession", "acceptedAt", "url"] },
    { id: "fred", name: "FRED (Federal Reserve Bank of St. Louis)", kind: "statistical_agency", reliability: 0.97, homepage: "https://fred.stlouisfed.org/", displayLicensed: true, permittedFields: ["value", "date", "vintage"] },
    { id: "fmp-news", name: "Financial Modeling Prep news", kind: "news", reliability: 0.65, homepage: "https://site.financialmodelingprep.com/", displayLicensed: c.fmpDisplay, permittedFields: ["title", "snippet", "url", "publishedAt"] },
    { id: "cnbc", name: "CNBC (RSS)", kind: "news", reliability: 0.75, homepage: "https://www.cnbc.com/", displayLicensed: c.free, permittedFields: ["title", "teaser", "url", "publishedAt"] },
    { id: "fed", name: "Federal Reserve Board press releases", kind: "regulator", reliability: 0.98, homepage: "https://www.federalreserve.gov/", displayLicensed: c.free, permittedFields: ["title", "teaser", "url", "publishedAt"] },
    { id: "gdelt", name: "GDELT news index", kind: "news", reliability: 0.6, homepage: "https://www.gdeltproject.org/", displayLicensed: c.free, permittedFields: ["title", "url", "seenAt"] },
    { id: "massive-news", name: "Massive news", kind: "news", reliability: 0.7, homepage: "https://massive.com/", displayLicensed: c.massiveDisplay, permittedFields: ["title", "snippet", "url", "publishedAt"] },
    { id: "marketaux", name: "Marketaux", kind: "news", reliability: 0.65, homepage: "https://www.marketaux.com/", displayLicensed: Boolean(c.marketauxKey), permittedFields: ["title", "snippet", "url", "publishedAt"] },
    { id: "newsapi", name: "NewsAPI.org", kind: "news", reliability: 0.65, homepage: "https://newsapi.org/", displayLicensed: Boolean(c.newsApiKey), permittedFields: ["title", "snippet", "url", "publishedAt"] },
  ];
}

function view(id: string, name: string, caps: string[], configured: boolean, entitled: boolean, note: string): ProviderHealthView {
  const m = providerMetrics(id);
  const status: ProviderHealthView["status"] = !configured
    ? "not_configured"
    : !entitled
      ? "license_blocked"
      : m.circuit === "open"
        ? "down"
        : m.failures > 0 && m.lastErrorAt && (!m.lastSuccessAt || m.lastErrorAt > m.lastSuccessAt)
          ? "degraded"
          : "active";
  return { id, name, capabilities: caps, configured, entitled, status, ...m, note };
}

export function liveProviderViews(c: LiveConfig): ProviderHealthView[] {
  const free = c.free;
  return [
    view("cnbc", "CNBC RSS feeds", ["company_news", "macro_news"], free, free, "Headlines, teasers and links from CNBC's public RSS feeds."),
    view("fed", "Federal Reserve press RSS", ["policy", "regulation"], free, free, "Official press releases (public domain)."),
    view("gdelt", "GDELT news index", ["news"], free, free, "Open global news index; headline + link only; ≤1 request / 5 s."),
    view("lse", "London Strategic Edge", ["prices", "intraday", "fundamentals", "macro_consensus", "logos"], Boolean(c.lseKey), Boolean(c.lseKey), c.lseKey ? "Daily and 30-minute candles, US economic calendar with consensus, company logos." : "Set LSE_API_KEY to enable."),
    view("yahoo", "Yahoo Finance chart (unofficial)", ["prices"], free && !c.lseKey, free, c.lseKey ? "Fallback only; London Strategic Edge supplies prices." : "Free delayed daily and 30-minute bars; no SLA; research display only."),
    view("bls", "BLS public API v1", ["macro_observations"], free, free, "Official CPI, payrolls, unemployment; no consensus; small daily quota (cached 12h)."),
    view("universe", "Coverage universe", ["symbol_directory"], true, true, "US-listed companies with market cap ≥ $10B (snapshot), plus major index ETFs."),
    view("sec", "SEC EDGAR", ["filings", "symbol_directory"], Boolean(c.secUa), true, c.secUa ? "Public data; fair-access User-Agent set; ≤5 req/s." : "Set SEC_USER_AGENT (name + contact email) to enable."),
    view("fred", "FRED / ALFRED", ["macro_observations", "vintages"], Boolean(c.fredKey), true, "Observations and vintages only — no survey consensus."),
    view("fmp", "Financial Modeling Prep", ["company_news", "prices"], Boolean(c.fmpKey), c.fmpDisplay, c.fmpKey && !c.fmpDisplay ? "Key present but display license not attested (FMP_DISPLAY_LICENSE=confirmed)." : "News + end-of-day prices."),
    view("massive", "Massive (formerly Polygon)", ["company_news", "sentiment", "options_eod"], Boolean(c.massiveKey), c.massiveDisplay, c.massiveKey && !c.massiveDisplay ? "Key present but commercial display license not attested." : "News with per-ticker sentiment; end-of-day options for implied moves (5 requests/min)."),
    view("marketaux", "Marketaux", ["company_news", "sentiment"], Boolean(c.marketauxKey), Boolean(c.marketauxKey), "Entity-tagged news with sentiment; free plan 100 calls/day, 3 articles each (cached 20 min)."),
    view("newsapi", "NewsAPI.org", ["news"], Boolean(c.newsApiKey), Boolean(c.newsApiKey), "Financial outlets via /v2/everything; developer plan (24h delay, 100 calls/day, cached 30 min)."),
    view("anthropic", "Anthropic (extraction)", ["llm_extraction"], c.llm, c.llm, c.llm ? "Schema-validated extraction; never authors numbers." : "Deterministic extraction in use."),

  ];
}
