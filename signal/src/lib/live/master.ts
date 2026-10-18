/**
 * Live security master: SEC company_tickers (CIK ↔ ticker ↔ name) plus a small set of market
 * proxies. Proxy sensitivities are APPROXIMATE and used only to choose mechanism paths; they are
 * flagged unverified, so exposures built from them are labelled hypothesized.
 */
import type { Security } from "@/lib/domain/types";
import { SecurityMaster } from "@/lib/analysis/securityMaster";

const proxy = (t: string, name: string, sector: string, industry: string, loadings: Security["factorLoadings"]): Security => ({
  id: `live:${t}`,
  ticker: t,
  name,
  kind: "etf",
  exchange: "US",
  currency: "USD",
  sector,
  industry,
  marketCapBucket: null,
  beta: null,
  sigmaDaily: null,
  benchmarkId: t === "SPY" ? null : "live:SPY",
  isSynthetic: false,
  brandingRights: "none",
  tickerHistory: [],
  factorLoadings: loadings,
  loadingsVerified: false,
  description: "Market proxy. Sensitivities are approximate (not verified data) and used for mechanism mapping only.",
});

export const LIVE_PROXIES: Security[] = [
  proxy("SPY", "SPDR S&P 500 ETF Trust", "Broad market", "Broad market", { ratesPer100bp: -4 }),
  proxy("QQQ", "Invesco QQQ Trust", "Growth", "Style ETF", { ratesPer100bp: -8 }),
  proxy("IWM", "iShares Russell 2000 ETF", "Small caps", "Style ETF", { ratesPer100bp: -6 }),
  proxy("TLT", "iShares 20+ Year Treasury Bond ETF", "Rates", "Treasury ETF", { ratesPer100bp: -16 }),
  proxy("UUP", "Invesco DB US Dollar Index Bullish Fund", "FX", "Currency ETF", { ratesPer100bp: 3, usdPer5pct: 5 }),
  proxy("XLE", "Energy Select Sector SPDR Fund", "Energy", "Sector ETF", { oilPer10pct: 5 }),
  proxy("XLF", "Financial Select Sector SPDR Fund", "Financials", "Sector ETF", { ratesPer100bp: 2.5 }),
];

export function buildLiveMaster(secCompanies: Security[]): SecurityMaster {
  const proxyTickers = new Set(LIVE_PROXIES.map((p) => p.ticker));
  return new SecurityMaster([...LIVE_PROXIES, ...secCompanies.filter((s) => !proxyTickers.has(s.ticker))]);
}
