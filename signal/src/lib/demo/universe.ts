/**
 * DEMO universe. Every company, fund, relationship and source here is FICTIONAL. Tickers are
 * synthetic identifiers inside the demo world and carry the `syn:` security-master prefix; any
 * resemblance to a listed symbol is coincidental and no real price or claim is implied.
 */
import type { Security, Source } from "@/lib/domain/types";
import type { DocumentedRelationship, IndexMembership } from "@/lib/analysis/securityMaster";

interface Spec {
  t: string;
  name: string;
  kind: Security["kind"];
  sector: string;
  industry: string;
  cap: Security["marketCapBucket"];
  beta: number;
  sigma: number;
  rates?: number;
  oil?: number;
  usd?: number;
  start: number;
  cik?: string;
  description: string;
  aliases?: string[];
}

const SPECS: Spec[] = [
  // Benchmarks and proxies
  { t: "MKTX", name: "Synthetic Broad Market Index Fund", kind: "etf", sector: "Broad market", industry: "Broad market", cap: null, beta: 1, sigma: 0.0105, rates: -4.5, start: 512, description: "Demo broad-market benchmark proxy. Used as the benchmark for abnormal returns." },
  { t: "GRWX", name: "Synthetic Growth 100 Fund", kind: "etf", sector: "Growth", industry: "Style ETF", cap: null, beta: 1.2, sigma: 0.013, rates: -9.5, start: 448, description: "Demo long-duration growth equity proxy." },
  { t: "SMLX", name: "Synthetic Small-Cap 2000 Fund", kind: "etf", sector: "Small caps", industry: "Style ETF", cap: null, beta: 1.15, sigma: 0.014, rates: -6, start: 214, description: "Demo small-capitalization equity proxy." },
  { t: "DURX", name: "Synthetic 20+ Year Treasury Fund", kind: "etf", sector: "Rates", industry: "Treasury ETF", cap: null, beta: -0.15, sigma: 0.0092, rates: -17.5, start: 91, description: "Demo long-duration Treasury proxy (effective duration ≈ 17.5 years, synthetic)." },
  { t: "USDX", name: "Synthetic Dollar Index Fund", kind: "etf", sector: "FX", industry: "Currency ETF", cap: null, beta: -0.1, sigma: 0.0042, rates: 3, usd: 5, start: 28, description: "Demo US-dollar basket proxy." },
  { t: "SEMX", name: "Synthetic Semiconductor Sector Fund", kind: "etf", sector: "Semiconductors", industry: "Sector ETF", cap: null, beta: 1.45, sigma: 0.019, rates: -8, start: 236, description: "Demo semiconductor sector fund." },
  { t: "SFTX", name: "Synthetic Software Sector Fund", kind: "etf", sector: "Software", industry: "Sector ETF", cap: null, beta: 1.2, sigma: 0.016, rates: -9, start: 154, description: "Demo software sector fund." },
  { t: "ENRX", name: "Synthetic Energy Sector Fund", kind: "etf", sector: "Energy", industry: "Sector ETF", cap: null, beta: 0.85, sigma: 0.016, oil: 5, start: 88, description: "Demo energy sector fund." },
  { t: "FINX", name: "Synthetic Financials Sector Fund", kind: "etf", sector: "Financials", industry: "Sector ETF", cap: null, beta: 1.05, sigma: 0.013, rates: 2.5, start: 41, description: "Demo financials sector fund." },
  { t: "TRNX", name: "Synthetic Transports Sector Fund", kind: "etf", sector: "Transports", industry: "Sector ETF", cap: null, beta: 1.15, sigma: 0.016, oil: -3.5, start: 63, description: "Demo transports sector fund." },
  { t: "HLTX", name: "Synthetic Healthcare Sector Fund", kind: "etf", sector: "Healthcare", industry: "Sector ETF", cap: null, beta: 0.75, sigma: 0.011, start: 137, description: "Demo healthcare sector fund." },
  { t: "UTLX", name: "Synthetic Utilities Sector Fund", kind: "etf", sector: "Utilities", industry: "Sector ETF", cap: null, beta: 0.5, sigma: 0.011, rates: -7, start: 72, description: "Demo utilities sector fund." },
  { t: "CONX", name: "Synthetic Consumer Sector Fund", kind: "etf", sector: "Consumer", industry: "Sector ETF", cap: null, beta: 1.0, sigma: 0.012, start: 96, description: "Demo consumer sector fund." },
  { t: "VOLX", name: "Synthetic Volatility Index", kind: "index_proxy", sector: "Volatility", industry: "Volatility index", cap: null, beta: -4, sigma: 0.055, start: 16.5, description: "Demo implied-volatility index proxy. Not an options-implied measure in this demo." },
  // Equities
  { t: "HLCN", name: "Halcyon Semiconductor", kind: "equity", sector: "Semiconductors", industry: "Chip design", cap: "mega", beta: 1.55, sigma: 0.024, rates: -8, start: 182, cik: "9000001", description: "Fictional designer of data-center accelerators.", aliases: ["halcyon semiconductor", "halcyon"] },
  { t: "VRTA", name: "Veritas Foundry", kind: "equity", sector: "Semiconductors", industry: "Foundry", cap: "large", beta: 1.3, sigma: 0.021, rates: -6, start: 96, cik: "9000002", description: "Fictional contract chip manufacturer.", aliases: ["veritas foundry"] },
  { t: "QNTM", name: "Quantum Logic Devices", kind: "equity", sector: "Semiconductors", industry: "Chip design", cap: "large", beta: 1.5, sigma: 0.026, rates: -7, start: 74, cik: "9000003", description: "Fictional accelerator competitor.", aliases: ["quantum logic"] },
  { t: "ORBT", name: "Orbital Cloud Systems", kind: "equity", sector: "Software", industry: "Cloud infrastructure", cap: "mega", beta: 1.25, sigma: 0.019, rates: -10, start: 412, cik: "9000004", description: "Fictional hyperscale cloud provider.", aliases: ["orbital cloud"] },
  { t: "LDGR", name: "Ledgerline Software", kind: "equity", sector: "Software", industry: "Application software", cap: "mid", beta: 1.35, sigma: 0.03, rates: -12, start: 58, cik: "9000005", description: "Fictional finance-software vendor.", aliases: ["ledgerline"] },
  { t: "PLSN", name: "Polestone Networks", kind: "equity", sector: "Software", industry: "Networking security", cap: "mid", beta: 1.3, sigma: 0.028, rates: -9, start: 47, cik: "9000006", description: "Fictional network-security provider.", aliases: ["polestone networks", "polestone"] },
  { t: "NWEN", name: "Northwind Energy", kind: "equity", sector: "Energy", industry: "Upstream oil & gas", cap: "large", beta: 0.9, sigma: 0.02, oil: 6.5, start: 64, cik: "9000007", description: "Fictional upstream producer.", aliases: ["northwind energy"] },
  { t: "PRMX", name: "Permian Crest Resources", kind: "equity", sector: "Energy", industry: "Upstream oil & gas", cap: "mid", beta: 1.05, sigma: 0.027, oil: 8.5, start: 31, cik: "9000008", description: "Fictional shale producer.", aliases: ["permian crest"] },
  { t: "MRDA", name: "Meridian Air", kind: "equity", sector: "Transports", industry: "Airlines", cap: "mid", beta: 1.25, sigma: 0.028, oil: -7.5, start: 39, cik: "9000009", description: "Fictional network airline.", aliases: ["meridian air"] },
  { t: "SKYH", name: "Skyhaven Airlines", kind: "equity", sector: "Transports", industry: "Airlines", cap: "mid", beta: 1.3, sigma: 0.03, oil: -6.8, start: 22, cik: "9000010", description: "Fictional low-cost airline.", aliases: ["skyhaven"] },
  { t: "CRGO", name: "Cargolink Logistics", kind: "equity", sector: "Transports", industry: "Freight & logistics", cap: "large", beta: 1.0, sigma: 0.017, oil: -3.2, start: 118, cik: "9000011", description: "Fictional freight carrier.", aliases: ["cargolink"] },
  { t: "BKHV", name: "Bankhaven Financial", kind: "equity", sector: "Financials", industry: "Banks", cap: "large", beta: 1.1, sigma: 0.017, rates: 3.5, start: 54, cik: "9000012", description: "Fictional national bank.", aliases: ["bankhaven"] },
  { t: "SUMT", name: "Summit Regional Bancorp", kind: "equity", sector: "Financials", industry: "Regional banks", cap: "mid", beta: 1.2, sigma: 0.022, rates: 4.2, start: 33, cik: "9000013", description: "Fictional regional lender.", aliases: ["summit regional"] },
  { t: "HLXB", name: "Helix Biotherapeutics", kind: "equity", sector: "Healthcare", industry: "Biotechnology", cap: "mid", beta: 1.1, sigma: 0.038, start: 27, cik: "9000014", description: "Fictional clinical-stage biotech.", aliases: ["helix biotherapeutics", "helix bio"] },
  { t: "CRVL", name: "Corvale Pharma", kind: "equity", sector: "Healthcare", industry: "Pharmaceuticals", cap: "large", beta: 0.7, sigma: 0.015, start: 88, cik: "9000015", description: "Fictional diversified drug maker.", aliases: ["corvale"] },
  { t: "GRDN", name: "Gridline Utilities", kind: "equity", sector: "Utilities", industry: "Electric utilities", cap: "large", beta: 0.45, sigma: 0.011, rates: -7, start: 71, cik: "9000016", description: "Fictional regulated utility.", aliases: ["gridline"] },
  { t: "CSTL", name: "Coastal Home REIT", kind: "equity", sector: "Real estate", industry: "Residential REIT", cap: "mid", beta: 0.9, sigma: 0.017, rates: -9, start: 44, cik: "9000017", description: "Fictional residential landlord.", aliases: ["coastal home"] },
  { t: "BRKT", name: "Brightcart Retail", kind: "equity", sector: "Consumer", industry: "Retail", cap: "large", beta: 0.95, sigma: 0.018, start: 136, cik: "9000018", description: "Fictional omnichannel retailer.", aliases: ["brightcart"] },
  { t: "NOVA", name: "Novaline Motors", kind: "equity", sector: "Consumer", industry: "Automobiles", cap: "large", beta: 1.4, sigma: 0.03, rates: -5, start: 61, cik: "9000019", description: "Fictional electric-vehicle maker.", aliases: ["novaline"] },
  { t: "TRDN", name: "Tridon Defense", kind: "equity", sector: "Industrials", industry: "Aerospace & defense", cap: "large", beta: 0.8, sigma: 0.015, start: 203, cik: "9000020", description: "Fictional defense contractor.", aliases: ["tridon"] },
  { t: "AURM", name: "Aurum Mining", kind: "equity", sector: "Materials", industry: "Precious metals", cap: "mid", beta: 0.6, sigma: 0.026, usd: -3, start: 19, cik: "9000021", description: "Fictional gold miner.", aliases: ["aurum mining"] },
];

export const DEMO_SECURITIES: Security[] = SPECS.map((s) => ({
  id: `syn:${s.t}`,
  ticker: s.t,
  name: s.name,
  kind: s.kind,
  exchange: "DEMO",
  currency: "USD",
  sector: s.sector,
  industry: s.industry,
  marketCapBucket: s.cap,
  beta: null,
  sigmaDaily: null,
  benchmarkId: s.t === "MKTX" ? null : "syn:MKTX",
  isSynthetic: true,
  brandingRights: "none",
  tickerHistory: [],
  factorLoadings: s.rates !== undefined || s.oil !== undefined || s.usd !== undefined ? { ratesPer100bp: s.rates, oilPer10pct: s.oil, usdPer5pct: s.usd } : undefined,
  cik: s.cik,
  description: s.description,
}));

/** Generator parameters (not visible to the model). */
export const DEMO_SPECS: ReadonlyMap<string, Spec> = new Map(SPECS.map((s) => [`syn:${s.t}`, s]));

export const DEMO_ALIASES: Record<string, string> = Object.fromEntries(
  SPECS.flatMap((s) => (s.aliases ?? []).map((a) => [a, `syn:${s.t}`] as const)),
);

const rel = (from: string, to: string, kind: DocumentedRelationship["kind"], evidence: string): DocumentedRelationship => ({
  fromId: `syn:${from}`,
  toId: `syn:${to}`,
  kind,
  evidence,
  evidencePath: `/ticker/${to}#relationships`,
  asOf: "2026-06-30",
});

export const DEMO_RELATIONSHIPS: DocumentedRelationship[] = [
  rel("HLCN", "VRTA", "supplier", "Synthetic 10-K: Veritas Foundry manufactures substantially all Halcyon wafers"),
  rel("HLCN", "ORBT", "customer", "Synthetic 10-K: Orbital Cloud represents >10% of Halcyon revenue"),
  rel("HLCN", "NOVA", "customer", "Synthetic supply agreement: Novaline sources drive-compute chips from Halcyon"),
  rel("HLCN", "QNTM", "competitor", "Synthetic 10-K risk factors name Quantum Logic as primary accelerator competitor"),
  rel("QNTM", "HLCN", "competitor", "Synthetic 10-K risk factors name Halcyon as primary competitor"),
  rel("QNTM", "VRTA", "supplier", "Synthetic 10-K: Veritas Foundry is a key wafer supplier"),
  rel("VRTA", "HLCN", "customer", "Synthetic 10-K: Halcyon is the largest foundry customer"),
  rel("VRTA", "QNTM", "customer", "Synthetic 10-K: Quantum Logic is a top-five customer"),
  rel("ORBT", "HLCN", "supplier", "Synthetic 10-K: accelerator supply concentrated in Halcyon"),
  rel("ORBT", "LDGR", "competitor", "Synthetic filings: overlapping finance-cloud products"),
  rel("LDGR", "ORBT", "competitor", "Synthetic filings: overlapping finance-cloud products"),
  rel("PLSN", "LDGR", "competitor", "Synthetic industry report: shared enterprise customers"),
  rel("NWEN", "PRMX", "competitor", "Synthetic filings: same producing basin"),
  rel("PRMX", "NWEN", "competitor", "Synthetic filings: same producing basin"),
  rel("MRDA", "SKYH", "competitor", "Synthetic route data: overlapping domestic network"),
  rel("SKYH", "MRDA", "competitor", "Synthetic route data: overlapping domestic network"),
  rel("BKHV", "SUMT", "competitor", "Synthetic filings: overlapping deposit markets"),
  rel("SUMT", "BKHV", "competitor", "Synthetic filings: overlapping deposit markets"),
  rel("HLXB", "CRVL", "competitor", "Synthetic pipeline data: competing therapy class"),
  rel("CRVL", "HLXB", "competitor", "Synthetic pipeline data: competing therapy class"),
  rel("NOVA", "HLCN", "supplier", "Synthetic supply agreement: drive-compute chips"),
];

const mem = (etf: string, member: string, weight: number): IndexMembership => ({
  etfId: `syn:${etf}`,
  memberId: `syn:${member}`,
  weight,
  asOf: "2026-09-30",
  source: "Synthetic holdings file",
});

export const DEMO_MEMBERSHIPS: IndexMembership[] = [
  mem("SEMX", "HLCN", 0.22), mem("SEMX", "QNTM", 0.12), mem("SEMX", "VRTA", 0.09),
  mem("SFTX", "ORBT", 0.2), mem("SFTX", "LDGR", 0.06), mem("SFTX", "PLSN", 0.05),
  mem("ENRX", "NWEN", 0.18), mem("ENRX", "PRMX", 0.08),
  mem("TRNX", "CRGO", 0.12), mem("TRNX", "MRDA", 0.09), mem("TRNX", "SKYH", 0.08),
  mem("FINX", "BKHV", 0.14), mem("FINX", "SUMT", 0.05),
  mem("HLTX", "CRVL", 0.12), mem("HLTX", "HLXB", 0.04),
  mem("UTLX", "GRDN", 0.15),
  mem("CONX", "BRKT", 0.11), mem("CONX", "NOVA", 0.09),
  mem("GRWX", "HLCN", 0.09), mem("GRWX", "ORBT", 0.08),
  mem("MKTX", "HLCN", 0.055), mem("MKTX", "ORBT", 0.05), mem("MKTX", "CRVL", 0.02), mem("MKTX", "BRKT", 0.015),
];

const src = (id: string, name: string, kind: Source["kind"], reliability: number): Source => ({
  id,
  name,
  kind,
  reliability,
  homepage: null,
  displayLicensed: true,
  permittedFields: ["title", "snippet", "url", "publishedAt"],
});

export const DEMO_SOURCES: Source[] = [
  src("demo-stats", "Demo Statistics Bureau (synthetic)", "statistical_agency", 0.98),
  src("demo-sec", "Demo EDGAR mirror (synthetic filings)", "regulator", 0.98),
  src("demo-pr", "Demo Press Release Wire (synthetic)", "company", 0.9),
  src("demo-wire", "Demo Newswire (synthetic)", "wire", 0.85),
  src("demo-wire-b", "Demo Newswire B (synthetic, stale feed)", "wire", 0.8),
  src("demo-daily", "Synthetic Market Daily", "news", 0.7),
  src("demo-ledger", "The Synthetic Ledger", "news", 0.72),
  src("demo-social", "Unverified social post (synthetic)", "news", 0.2),
];

/** Sector → sector-ETF ticker, used by the market-pulse holdings attribution. */
export const SECTOR_ETF: Record<string, string> = {
  Semiconductors: "SEMX",
  Software: "SFTX",
  Energy: "ENRX",
  Financials: "FINX",
  Transports: "TRNX",
  Healthcare: "HLTX",
  Utilities: "UTLX",
  Consumer: "CONX",
};
