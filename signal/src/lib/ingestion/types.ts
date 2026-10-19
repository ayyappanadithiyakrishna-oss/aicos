/** Provider-normalized input records. Adapters map vendor payloads into this shape. */

export interface StructuredMacro {
  indicator: string;
  period: string;
  unit: string;
  actual: number;
  prior: number | null;
  revisedPrior: number | null;
  consensus: { value: number; unit: string; source: string; licensed: boolean } | null;
  historicalErrors: number[];
}

export interface StructuredFiling {
  form: string;
  items: string[];
  cik: string;
  accession: string;
  acceptedAt: string;
  isAmendment: boolean;
  amends: string | null;
}

export interface StructuredEarnings {
  epsActual: number | null;
  epsConsensus: number | null;
  revenueActual: number | null;
  revenueConsensus: number | null;
  consensusSource: string | null;
  guidance: "raised" | "lowered" | "reaffirmed" | "initiated" | "withdrawn" | "none";
  surpriseZ: number | null;
}

export interface RawRecord {
  provider: string;
  providerId: string;
  kind: "news" | "filing" | "macro_release" | "press_release";
  url: string;
  title: string;
  excerpt: string;
  contentScope: "title_only" | "snippet" | "full_text_licensed";
  publisher: string;
  sourceId: string;
  publishedAt: string | null;
  fetchedAt: string;
  tickers: string[];
  isOriginalDisclosure: boolean;
  isSynthetic: boolean;
  structured?: {
    macro?: StructuredMacro;
    filing?: StructuredFiling;
    earnings?: StructuredEarnings;
    deal?: { role: "target" | "acquirer"; counterpartyTicker: string | null; valueUsd: number | null; premiumPct: number | null };
  };
  /** Internal route that renders the stored/synthetic document. */
  internalPath?: string | null;
  /** Vendor-supplied per-ticker sentiment (-1 … 1), e.g. Massive insights or Marketaux entity scores. */
  vendorSentiment?: Array<{ ticker: string; score: number; note: string }>;
}

export type StageName =
  | "fetch"
  | "validate_source"
  | "canonicalize"
  | "detect"
  | "cluster"
  | "extract"
  | "evidence_check"
  | "mechanisms"
  | "exposure"
  | "score"
  | "explain"
  | "editorial"
  | "persist"
  | "publish";

export interface StageStatus {
  stage: StageName;
  status: "ok" | "skipped" | "failed" | "dead_letter";
  count: number;
  ms: number;
  attempts: number;
  error?: string;
}

export interface DeadLetter {
  key: string;
  stage: StageName;
  error: string;
  at: string;
  payloadRef: string;
}
