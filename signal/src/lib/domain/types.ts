/**
 * SIGNAL domain model. Every field that reaches the UI is defined here so provenance,
 * uncertainty and abstention travel with the data instead of being reconstructed in components.
 */

export const HORIZONS = ["1h", "next_session", "5_sessions"] as const;
export type Horizon = (typeof HORIZONS)[number];

export const EVENT_TYPES = [
  "earnings",
  "macro",
  "filing",
  "ma",
  "regulation",
  "geopolitics",
  "company",
  "sector",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  earnings: "Earnings",
  macro: "Macro",
  filing: "Filing",
  ma: "M&A",
  regulation: "Regulation",
  geopolitics: "Geopolitics",
  company: "Company",
  sector: "Sector",
  other: "Other",
};

/** Directional label on an exposure. `insufficient` means no defensible view could be formed. */
export type Direction = "bullish" | "bearish" | "no_edge" | "mixed" | "insufficient";

/**
 * Forecast quality tiers, strongest first.
 * - calibrated: interval coverage and probability calibration evaluated out-of-sample.
 * - evaluated: central estimate from an evaluated baseline; probabilities withheld.
 * - research: research-grade / uncalibrated heuristic (only shown in demo or model lab).
 * - direction_only: mechanism supports a sign but magnitude is not estimable.
 * - insufficient: abstain.
 */
export type QualityTier = "calibrated" | "evaluated" | "research" | "direction_only" | "insufficient";

export type Directness = "direct" | "second_order";

export type Relationship =
  | "direct"
  | "supplier"
  | "customer"
  | "competitor"
  | "index"
  | "sector"
  | "rate_sensitivity"
  | "commodity_sensitivity"
  | "fx_sensitivity"
  | "hypothesized";

export type Sign = "positive" | "negative" | "mixed";

export type ClaimLabel = "confirmed_fact" | "mechanism" | "model_forecast" | "observed_move" | "open_question";

export type ConfirmationStatus =
  | "confirmed_filing"
  | "official_release"
  | "multiple_independent"
  | "single_source"
  | "unverified";

export type Severity = "high" | "medium" | "low";

export type DataMode = "demo" | "live";

/** Provenance tags attached to any number shown in the UI. */
export type ProvenanceTag =
  | "synthetic"
  | "licensed_realtime"
  | "licensed_delayed"
  | "public_domain"
  | "unknown_publication_time"
  | "stale_feed"
  | "missing_iv"
  | "proxy_asset"
  | "event_overlap"
  | "data_gap"
  | "model_estimate"
  | "observed";

export type SecurityKind = "equity" | "etf" | "index_proxy" | "rate" | "fx" | "commodity";

export interface Security {
  /** Canonical security-master ID. Ticker + exchange is not globally unique and symbols change. */
  id: string;
  ticker: string;
  name: string;
  kind: SecurityKind;
  exchange: string;
  currency: string;
  sector: string;
  industry: string;
  marketCapBucket: "mega" | "large" | "mid" | "small" | null;
  /** Past-only beta to the benchmark, if estimable. */
  beta: number | null;
  /** Past-only daily return volatility (decimal), if estimable. */
  sigmaDaily: number | null;
  benchmarkId: string | null;
  isSynthetic: boolean;
  brandingRights: "none" | "licensed";
  tickerHistory: Array<{ ticker: string; from: string; to: string | null }>;
  /** Documented factor sensitivities used for scenario exploration (not forecasts). */
  factorLoadings?: { ratesPer100bp?: number; oilPer10pct?: number; usdPer5pct?: number };
  /** False when loadings are approximate placeholders; exposures built from them are hypothesized. */
  loadingsVerified?: boolean;
  cik?: string;
  description?: string;
}

export interface Source {
  id: string;
  name: string;
  kind: "wire" | "regulator" | "statistical_agency" | "company" | "news" | "synthetic";
  /** 0–1 prior reliability, documented per source in docs/providers.md. */
  reliability: number;
  homepage: string | null;
  displayLicensed: boolean;
  permittedFields: string[];
}

export interface Article {
  id: string;
  sourceId: string;
  publisher: string;
  url: string;
  canonicalUrl: string;
  title: string;
  /** Provider-supplied snippet only. Never a reproduction of a full copyrighted article. */
  excerpt: string;
  contentScope: "title_only" | "snippet" | "full_text_licensed";
  publishedAt: string;
  publishedAtKnown: boolean;
  ingestedAt: string;
  contentHash: string;
  providerTickers: string[];
  isSynthetic: boolean;
  isOriginalDisclosure: boolean;
}

export interface Evidence {
  id: string;
  articleId: string | null;
  url: string;
  publisher: string;
  publishedAt: string;
  kind: "filing" | "official_release" | "wire" | "news" | "company_statement" | "data";
  isOriginal: boolean;
  excerpt: string;
  /** Internal route for synthetic or stored documents (demo sources live at /sources/[id]). */
  internalPath: string | null;
}

export interface VerifiedFact {
  text: string;
  evidenceId: string;
  label: ClaimLabel;
}

export interface MechanismNode {
  id: string;
  kind: "event" | "macro" | "channel" | "sector" | "security";
  label: string;
  securityId?: string;
  observed?: { changeLabel: string; provenance: ProvenanceTag } | null;
}

export interface MechanismEdge {
  id: string;
  from: string;
  to: string;
  sign: Sign;
  relationship: Relationship;
  directness: Directness;
  lag: "minutes" | "hours" | "days" | "weeks";
  uncertainty: "low" | "medium" | "high";
  evidenceIds: string[];
  rationale: string;
  hypothesized: boolean;
}

export interface MechanismGraph {
  nodes: MechanismNode[];
  edges: MechanismEdge[];
}

export interface Exposure {
  securityId: string;
  ticker: string;
  name: string;
  directness: Directness;
  relationship: Relationship;
  /** One short causal reason. */
  mechanism: string;
  sign: Sign;
  severity: Severity;
  verified: boolean;
  evidenceIds: string[];
  /** Evidence path text for "Why this ticker?" */
  linkage: string[];
}

export interface QuarantinedSymbol {
  symbol: string;
  reason: string;
  articleId: string | null;
}

export interface Probabilities {
  up: number;
  down: number;
  neutral: number;
}

export interface ForecastSnapshot {
  id: string;
  eventId: string;
  securityId: string;
  ticker: string;
  horizon: Horizon;
  forecastGeneratedAt: string;
  /** Feature cutoff: no input with a timestamp after this instant was used. */
  asOf: string;
  baselinePriceTime: string | null;
  baseMarketPrice: number | null;
  target: "abnormal" | "raw";
  centralMovePct: number | null;
  intervalLowPct: number | null;
  intervalHighPct: number | null;
  intervalLevel: number;
  /** Only present when the model's probabilities are calibrated out-of-sample. */
  probabilities: Probabilities | null;
  /** Fixed neutral band (|AR| below this = "no material move"), percent. */
  neutralBandPct: number | null;
  direction: Direction;
  qualityTier: QualityTier;
  sampleSize: number;
  nEff: number;
  modelVersion: string;
  inputDataProvenance: ProvenanceTag[];
  reasonCodes: string[];
  invalidationConditions: string[];
  revision: number;
  supersedes: string | null;
  isSynthetic: boolean;
}

export type RealizationStatus = "pending" | "resolved" | "failed" | "not_resolvable";

export interface ForecastRealization {
  id: string;
  forecastId: string;
  status: RealizationStatus;
  windowStart: string | null;
  windowEnd: string | null;
  rawReturnPct: number | null;
  benchmarkReturnPct: number | null;
  abnormalReturnPct: number | null;
  betaUsed: number | null;
  outcomeClass: "up" | "down" | "neutral" | null;
  resolvedAt: string | null;
  quality: "clean" | "overlapping_event" | "corporate_action_adjusted" | "data_gap" | null;
  failureReason: string | null;
}

export interface PricedIn {
  securityId: string;
  ticker: string;
  /** Pre-event drift over the 5 sessions before publication (raw %). */
  preEventDriftPct: number | null;
  /** Reaction realized between publication and the analysis timestamp (raw %). */
  realizedSincePct: number | null;
  /** Model estimate of the remaining move conditioned on prices known at analysis time. */
  remainingPct: number | null;
  status: "unknown" | "partial" | "estimable";
  note: string;
}

export interface EventQuality {
  score: number; // 0–100
  components: {
    sourceReliability: number;
    verifiedFacts: number;
    timeliness: number;
    providerFreshness: number;
    quantifiedEvidence: number;
    distinctiveness: number;
  };
}

export interface Novelty {
  score: number; // 0–1
  originalCount: number;
  echoCount: number;
  distinctPublishers: number;
  firstReportAt: string;
  firstReportPublisher: string;
}

export interface Contradiction {
  id: string;
  kind: "source_conflict" | "model_conflict" | "market_disagreement" | "counter_mechanism";
  text: string;
  falsifier: string;
  evidenceIds: string[];
}

export interface TimelineEntry {
  at: string;
  kind: "first_report" | "confirmation" | "filing" | "update" | "market" | "forecast" | "release";
  text: string;
  evidenceId: string | null;
}

export interface MacroSurprise {
  indicator: string;
  unit: string;
  actual: number;
  consensus: number | null;
  consensusSource: string | null;
  prior: number | null;
  revisedPrior: number | null;
  surprise: number | null;
  surpriseZ: number | null;
  historyN: number;
  note: string | null;
}

export interface EarningsSurprise {
  epsActual: number | null;
  epsConsensus: number | null;
  revenueActual: number | null;
  revenueConsensus: number | null;
  consensusSource: string | null;
  guidance: "raised" | "lowered" | "reaffirmed" | "initiated" | "withdrawn" | "none";
  surpriseZ: number | null;
}

export interface Analog {
  eventId: string;
  title: string;
  at: string;
  abnormalReturnPct: number | null;
  similarity: number;
}

export interface RelevanceBreakdown {
  score: number;
  components: Record<string, { value: number; weight: number; contribution: number; note: string }>;
}

export interface IntelligenceEvent {
  id: string;
  slug: string;
  eventType: EventType;
  subtype: string;
  tags: string[];
  /** Headline of the first report (shown after the insight, never before it). */
  originalTitle: string;
  bottomLine: string;
  whyItMatters: string;
  verifiedFacts: VerifiedFact[];
  transmission: string[];
  scenario: { upside: string; downside: string };
  firstPublishedAt: string;
  ingestedAt: string;
  updatedAt: string;
  asOf: string;
  confirmationStatus: ConfirmationStatus;
  extractionMethod: "deterministic" | "llm_validated";
  extractionConfidence: number;
  exposures: Exposure[];
  quarantined: QuarantinedSymbol[];
  evidence: Evidence[];
  articleIds: string[];
  graph: MechanismGraph;
  limitations: string[];
  openQuestions: string[];
  contradictions: Contradiction[];
  invalidation: string[];
  novelty: Novelty;
  quality: EventQuality;
  severity: Severity;
  urgency: "breaking" | "today" | "developing" | "background";
  forecasts: ForecastSnapshot[];
  realizations: ForecastRealization[];
  pricedIn: PricedIn[];
  overlapping: boolean;
  overlapsWith: string[];
  relevance: RelevanceBreakdown;
  macro: MacroSurprise | null;
  earnings: EarningsSurprise | null;
  analogs: Analog[];
  analogNote: string;
  timeline: TimelineEntry[];
  sectors: string[];
  region: string;
  isSynthetic: boolean;
  primarySourceName: string;
  primarySourceKind: Source["kind"];
}

export interface PriceBar {
  /** Bar END (close) time, UTC ISO. A bar is "available" at t. */
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Quote {
  securityId: string;
  ticker: string;
  last: number | null;
  changePct: number | null;
  asOf: string | null;
  entitlement: "synthetic" | "realtime" | "delayed" | "none";
  delayMinutes: number | null;
  source: string;
}

export interface FeedFilters {
  category?: string;
  severity?: Severity;
  direction?: Direction;
  horizon?: Horizon;
  minQuality?: number;
  verifiedOnly?: boolean;
  q?: string;
  tickers?: string[];
  sort?: "relevance" | "recency";
  cursor?: string;
  limit?: number;
}
