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
  };
}

export function anyLiveProvider(c: LiveConfig): boolean {
  return Boolean(c.free || c.secUa || c.fredKey || (c.fmpKey && c.fmpDisplay) || (c.massiveKey && c.massiveDisplay));
}

export function priceProvider(c: LiveConfig): "fmp" | "massive" | "yahoo" | null {
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
    { id: "massive-news", name: "Massive news", kind: "news", reliability: 0.65, homepage: "https://massive.com/", displayLicensed: c.massiveDisplay, permittedFields: ["title", "snippet", "url", "publishedAt"] },
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
    view("yahoo", "Yahoo Finance chart (unofficial)", ["prices"], free, free, "Free delayed daily and 30-minute bars; no SLA; research display only."),
    view("bls", "BLS public API v1", ["macro_observations"], free, free, "Official CPI, payrolls, unemployment; no consensus; small daily quota (cached 12h)."),
    view("nasdaqtrader", "Nasdaq symbol directory", ["symbol_directory"], free, free, "Listed tickers and names."),
    view("sec", "SEC EDGAR", ["filings", "symbol_directory"], Boolean(c.secUa), true, c.secUa ? "Public data; fair-access User-Agent set; ≤5 req/s." : "Set SEC_USER_AGENT (name + contact email) to enable."),
    view("fred", "FRED / ALFRED", ["macro_observations", "vintages"], Boolean(c.fredKey), true, "Observations and vintages only — no survey consensus."),
    view("fmp", "Financial Modeling Prep", ["company_news", "prices"], Boolean(c.fmpKey), c.fmpDisplay, c.fmpKey && !c.fmpDisplay ? "Key present but display license not attested (FMP_DISPLAY_LICENSE=confirmed)." : "News + end-of-day prices."),
    view("massive", "Massive (formerly Polygon)", ["company_news", "prices"], Boolean(c.massiveKey), c.massiveDisplay, c.massiveKey && !c.massiveDisplay ? "Key present but commercial display license not attested." : "News + aggregates."),
    view("anthropic", "Anthropic (extraction)", ["llm_extraction"], c.llm, c.llm, c.llm ? "Schema-validated extraction; never authors numbers." : "Deterministic extraction in use."),
    { ...view("options", "Options chain", ["options"], false, false, "No options provider integrated; implied-move module unavailable."), status: "not_configured" },
  ];
}
