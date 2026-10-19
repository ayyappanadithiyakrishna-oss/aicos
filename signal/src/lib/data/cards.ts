/**
 * Compact card projection of an IntelligenceEvent for feed rendering and the feed API. Keeps the
 * payload small while preserving provenance, uncertainty and abstention reasons.
 */
import type { Direction, Horizon, IntelligenceEvent, Probabilities, QualityTier, Relationship, Severity, Sign } from "@/lib/domain/types";
import { HORIZONS } from "@/lib/domain/types";
import { REASON_TEXT } from "@/lib/quant/forecast";

export interface CardForecast {
  id: string;
  direction: Direction;
  tier: QualityTier;
  central: number | null;
  lo: number | null;
  hi: number | null;
  probs: Probabilities | null;
  band: number | null;
  nEff: number;
  reasons: string[];
  reasonText: string[];
  modelVersion: string;
  generatedAt: string;
  revision: number;
  realized: { ar: number | null; status: string } | null;
}

export interface CardEvidence {
  id: string;
  label: string;
  href: string;
  external: boolean;
  kind: string;
}

export interface CardExposure {
  securityId: string;
  ticker: string;
  name: string;
  directness: "direct" | "second_order";
  relationship: Relationship;
  sign: Sign;
  severity: Severity;
  mechanism: string;
  linkage: string[];
  verified: boolean;
  evidence: CardEvidence[];
  forecasts: Partial<Record<Horizon, CardForecast>>;
}

export interface CardModel {
  id: string;
  eventType: IntelligenceEvent["eventType"];
  subtype: string;
  severity: Severity;
  urgency: IntelligenceEvent["urgency"];
  firstPublishedAt: string;
  updatedAt: string;
  ingestedAt: string;
  sourceName: string;
  sourceKind: string;
  confirmation: IntelligenceEvent["confirmationStatus"];
  originalTitle: string;
  bottomLine: string;
  facts: Array<{ text: string; label: string; evidence: CardEvidence | null }>;
  transmission: string[];
  scenario: { upside: string; downside: string };
  exposures: CardExposure[];
  quality: number;
  novelty: IntelligenceEvent["novelty"];
  pricedIn: IntelligenceEvent["pricedIn"][number] | null;
  contradictions: number;
  topContradiction: string | null;
  overlapping: boolean;
  macro: IntelligenceEvent["macro"];
  earnings: IntelligenceEvent["earnings"];
  primarySource: CardEvidence | null;
  isSynthetic: boolean;
  relevance: number;
  tags: string[];
  extractionMethod: IntelligenceEvent["extractionMethod"];
  quarantinedCount: number;
  limitations: string[];
}

export function evidenceLink(e: IntelligenceEvent["evidence"][number]): CardEvidence {
  const internal = e.internalPath;
  return {
    id: e.id,
    label: e.publisher,
    href: internal ?? e.url,
    external: !internal,
    kind: e.kind,
  };
}

export function toCard(e: IntelligenceEvent): CardModel {
  const evById = new Map(e.evidence.map((x) => [x.id, x] as const));
  const realizationByForecast = new Map(e.realizations.map((r) => [r.forecastId, r] as const));
  const exposures: CardExposure[] = e.exposures.map((x) => {
    const forecasts: Partial<Record<Horizon, CardForecast>> = {};
    for (const h of HORIZONS) {
      const f = e.forecasts.find((y) => y.securityId === x.securityId && y.horizon === h);
      if (!f) continue;
      const r = realizationByForecast.get(f.id);
      forecasts[h] = {
        id: f.id,
        direction: f.direction,
        tier: f.qualityTier,
        central: f.centralMovePct,
        lo: f.intervalLowPct,
        hi: f.intervalHighPct,
        probs: f.probabilities,
        band: f.neutralBandPct,
        nEff: f.nEff,
        reasons: f.reasonCodes,
        reasonText: f.reasonCodes.map((c) => REASON_TEXT[c] ?? c),
        modelVersion: f.modelVersion,
        generatedAt: f.forecastGeneratedAt,
        revision: f.revision,
        realized: r ? { ar: r.abnormalReturnPct, status: r.status } : null,
      };
    }
    return {
      securityId: x.securityId,
      ticker: x.ticker,
      name: x.name,
      directness: x.directness,
      relationship: x.relationship,
      sign: x.sign,
      severity: x.severity,
      mechanism: x.mechanism,
      linkage: x.linkage,
      verified: x.verified,
      evidence: x.evidenceIds.map((id) => evById.get(id)).filter((v): v is NonNullable<typeof v> => Boolean(v)).map(evidenceLink),
      forecasts,
    };
  });
  const primary = e.evidence.find((x) => x.isOriginal) ?? e.evidence[0] ?? null;
  return {
    id: e.id,
    eventType: e.eventType,
    subtype: e.subtype,
    severity: e.severity,
    urgency: e.urgency,
    firstPublishedAt: e.firstPublishedAt,
    updatedAt: e.updatedAt,
    ingestedAt: e.ingestedAt,
    sourceName: primary?.publisher ?? e.primarySourceName,
    sourceKind: e.primarySourceKind,
    confirmation: e.confirmationStatus,
    originalTitle: e.originalTitle,
    bottomLine: e.bottomLine,
    facts: e.verifiedFacts.map((f) => {
      const ev = evById.get(f.evidenceId);
      return { text: f.text, label: f.label, evidence: ev ? evidenceLink(ev) : null };
    }),
    transmission: e.transmission,
    scenario: e.scenario,
    exposures,
    quality: e.quality.score,
    novelty: e.novelty,
    pricedIn: e.pricedIn[0] ?? null,
    contradictions: e.contradictions.length,
    topContradiction: e.contradictions.find((c) => c.kind === "market_disagreement" || c.kind === "source_conflict")?.text ?? e.contradictions[0]?.text ?? null,
    overlapping: e.overlapping,
    macro: e.macro,
    earnings: e.earnings,
    primarySource: primary ? evidenceLink(primary) : null,
    isSynthetic: e.isSynthetic,
    relevance: e.relevance.score,
    tags: e.tags,
    extractionMethod: e.extractionMethod,
    quarantinedCount: e.quarantined.length,
    limitations: e.limitations,
  };
}
