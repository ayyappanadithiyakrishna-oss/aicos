/** View models returned by the data service to pages and API routes. */
import type {
  DataMode,
  ForecastRealization,
  ForecastSnapshot,
  IntelligenceEvent,
  MacroSurprise,
  PriceBar,
  Quote,
  Security,
  Severity,
} from "@/lib/domain/types";
import type { MarketClock } from "@/lib/calendar/nyse";
import type { Scorecard } from "@/lib/quant/evaluate";
import type { StageStatus, DeadLetter } from "@/lib/ingestion/types";
import type { QuarantinedSymbol } from "@/lib/domain/types";

export interface ModeInfo {
  mode: DataMode;
  asOf: string;
  clock: MarketClock;
  label: string;
  priceEntitlement: Quote["entitlement"];
  priceSource: string;
  demoReason: string | null;
}

export interface FeedFreshness {
  lastIngestAt: string | null;
  newestItemAt: string | null;
  ingestLagP50Min: number | null;
  ingestLagP95Min: number | null;
  stale: boolean;
  note: string;
}

export interface FeedQuery {
  category?: string;
  severity?: Severity;
  direction?: string;
  horizon?: string;
  minQuality?: number;
  recency?: "1h" | "today" | "3d" | "7d" | "all";
  verifiedOnly?: boolean;
  q?: string;
  tickers?: string[];
  sort?: "relevance" | "recency";
  prioritize?: "market" | "watchlist";
  watch?: string[];
  format?: "card" | "full";
  cursor?: string;
  limit?: number;
}

export interface FeedResult {
  mode: ModeInfo;
  items: IntelligenceEvent[];
  total: number;
  nextCursor: string | null;
  freshness: FeedFreshness;
  categories: Array<{ key: string; label: string; count: number }>;
}

export interface PulseRibbonItem {
  ticker: string;
  label: string;
  last: number | null;
  changePct: number | null;
  asOf: string | null;
  entitlement: Quote["entitlement"];
  note: string | null;
}

export interface ImpactHistoryRow {
  forecastId: string;
  eventId: string;
  eventTitle: string;
  generatedAt: string;
  horizon: ForecastSnapshot["horizon"];
  central: number | null;
  lo: number | null;
  hi: number | null;
  direction: ForecastSnapshot["direction"];
  qualityTier: ForecastSnapshot["qualityTier"];
  realizedAr: number | null;
  status: ForecastRealization["status"] | "pending";
  hit: boolean | null;
  inside: boolean | null;
  sample: string;
}

export interface TickerView {
  mode: ModeInfo;
  security: Security;
  quote: Quote;
  daily: PriceBar[];
  intraday: PriceBar[];
  markers: Array<{ at: string; eventId: string; label: string; severity: Severity }>;
  events: IntelligenceEvent[];
  impactHistory: ImpactHistoryRow[];
  relationships: Array<{ ticker: string; name: string; kind: string; direction: "counterparty" | "reverse"; evidence: string; asOf: string }>;
  memberships: Array<{ etf: string; weight: number; asOf: string; source: string }>;
  holdings: Array<{ ticker: string; weight: number }>;
  catalysts: CalendarItem[];
  attention: { recent: number; baseline: number | null; ratio: number | null; note: string };
  trajectory: Array<{ at: string; eventId: string; direction: ForecastSnapshot["direction"]; central: number | null; tier: ForecastSnapshot["qualityTier"] }>;
  options: { available: false; reason: string };
  peers: string[];
}

export interface CalendarItem {
  id: string;
  at: string;
  dateConfirmed: boolean;
  kind: "macro" | "earnings" | "policy" | "corporate" | "filing";
  title: string;
  tickers: string[];
  consensusNote: string | null;
  source: string;
  isSynthetic: boolean;
}

export interface MacroRow {
  id: string;
  indicator: string;
  period: string;
  releaseAt: string;
  releaseTimeKnown: boolean;
  status: "released" | "upcoming";
  unit: string;
  actual: number | null;
  consensus: number | null;
  consensusSource: string | null;
  prior: number | null;
  revisedPrior: number | null;
  surprise: MacroSurprise | null;
  source: string;
  eventId: string | null;
  isSynthetic: boolean;
}

export interface EarningsRow {
  id: string;
  ticker: string;
  name: string;
  reportedAt: string;
  status: "reported" | "upcoming";
  epsActual: number | null;
  epsConsensus: number | null;
  consensusSource: string | null;
  guidance: string;
  expected: string;
  changed: string;
  matters: string;
  nextConfirmation: string;
  eventId: string | null;
  isSynthetic: boolean;
}

export interface FilingRow {
  id: string;
  ticker: string | null;
  company: string;
  form: string;
  items: string[];
  acceptedAt: string;
  accession: string;
  isAmendment: boolean;
  amends: string | null;
  link: string;
  eventId: string | null;
  isSynthetic: boolean;
}

export interface PulseDriver {
  eventId: string;
  at: string;
  title: string;
  bottomLine: string;
  hypothesis: string;
  observed: Array<{ ticker: string; changePct: number | null; label: string }>;
}

export interface MarketPulseView {
  mode: ModeInfo;
  benchmark: { ticker: string; name: string; changePct: number | null; intraday: PriceBar[]; prevClose: number | null; last: number | null };
  breadth: { advancers: number; decliners: number; unchanged: number; universe: number; note: string } | null;
  sectors: Array<{ ticker: string; sector: string; changePct: number | null }>;
  crossAsset: Array<{ ticker: string; label: string; changePct: number | null; note: string }>;
  regime: { label: string; volIndex: number | null; volTicker: string | null; note: string };
  drivers: PulseDriver[];
  volumeAnomalies: Array<{ ticker: string; ratio: number; note: string }>;
  attributionNote: string;
}

export interface ProviderHealthView {
  id: string;
  name: string;
  capabilities: string[];
  configured: boolean;
  entitled: boolean;
  status: "active" | "not_configured" | "license_blocked" | "degraded" | "down" | "synthetic";
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  requests: number;
  failures: number;
  circuit: "closed" | "open" | "half_open";
  note: string;
}

export interface StatusView {
  mode: ModeInfo;
  providers: ProviderHealthView[];
  freshness: FeedFreshness;
  pipeline: { stages: StageStatus[]; deadLetters: DeadLetter[]; quarantined: QuarantinedSymbol[]; skippedDuplicates: number; licenseBlocked: number; ms: number | null; ranAt: string | null };
  model: {
    version: string;
    methodology: string;
    trainingCutoff: string | null;
    calibrationEnd: string | null;
    horizons: Array<{ horizon: string; trainN: number; calN: number; calibrated: boolean; coverage: number | null; ece: number | null; note: string; lambda: number }>;
    isSynthetic: boolean;
  } | null;
  jobs: Array<{ id: string; kind: string; status: string; startedAt: string; finishedAt: string | null; detail: string }>;
  buildMs: number | null;
}

export interface ArchiveQuery {
  ticker?: string;
  horizon?: string;
  sample?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface ArchiveView {
  mode: ModeInfo;
  rows: Array<{
    forecast: ForecastSnapshot;
    realization: ForecastRealization | null;
    eventTitle: string;
    eventId: string;
    sample: string;
    superseded: boolean;
  }>;
  total: number;
  nextCursor: string | null;
  counts: Record<string, number>;
}

export interface ScorecardView {
  mode: ModeInfo;
  scorecard: Scorecard | null;
  note: string;
  modelVersion: string | null;
}

export interface SearchHit {
  kind: "ticker" | "event" | "page";
  id: string;
  label: string;
  sublabel: string;
  href: string;
}

export interface SourceDocument {
  id: string;
  title: string;
  excerpt: string;
  publisher: string;
  publishedAt: string | null;
  kind: string;
  isSynthetic: boolean;
  structuredText: string;
  eventId: string | null;
  injectionFlags: string[];
}
