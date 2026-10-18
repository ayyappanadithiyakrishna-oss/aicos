/**
 * Forecast assembly: model prediction → quality gate → immutable snapshot → validation.
 * LLMs never author any number here; every value comes from deterministic code.
 */
import type {
  Direction,
  ForecastSnapshot,
  Horizon,
  Probabilities,
  ProvenanceTag,
  QualityTier,
  Sign,
} from "@/lib/domain/types";
import { PROBABILITY_SUM_TOLERANCE } from "./calibration";
import { INTERVAL_LEVEL, NEUTRAL_BAND_SIGMA, predict, type EventReactionModel } from "./model";
import { hashHex, round } from "./stats";

export const MIN_N_EFF_FOR_ESTIMATE = 8;
export const MIN_N_EFF_FOR_PROBABILITIES = 25;
/** Minimum hierarchy depth (1 = subtype, 2 = subtype|channel, 3 = +magnitude) for a numeric estimate. */
export const MIN_ESTIMATE_DEPTH = 2;
/** |central| below this many σ_h is "drowned by normal volatility". */
export const NOISE_FLOOR_SIGMA = 0.2;

/** Sanity bounds on |move| per horizon (percent). Anything larger is rejected as impossible. */
export const MAGNITUDE_BOUNDS: Record<Horizon, number> = { "1h": 25, next_session: 40, "5_sessions": 60 };

export interface ForecastContext {
  eventId: string;
  securityId: string;
  ticker: string;
  horizon: Horizon;
  forecastGeneratedAt: string;
  asOf: string;
  path: string[];
  /** Past-only σ for the horizon in percent; null when price history is unavailable. */
  sigmaHPct: number | null;
  baseline: { price: number; at: string } | null;
  mechanismSign: Sign | null;
  exposureVerified: boolean;
  numericFactsVerified: boolean;
  sourceConflict: boolean;
  providerStale: boolean;
  overlapping: boolean;
  provenance: ProvenanceTag[];
  invalidationConditions: string[];
  isSynthetic: boolean;
  revision?: number;
  supersedes?: string | null;
}

export interface GateResult {
  tier: QualityTier;
  showCentral: boolean;
  showInterval: boolean;
  showProbabilities: boolean;
  reasonCodes: string[];
}

export const REASON_TEXT: Record<string, string> = {
  NO_PRICE_HISTORY: "No licensed price history for this asset; magnitude not estimable.",
  NO_BASELINE_PRICE: "No valid price at publication time; event window cannot be anchored.",
  SYMBOL_MAPPING_DOUBT: "Ticker linkage not verified against the security master.",
  UNVERIFIED_NUMERIC_FACTS: "High-impact numbers lack independent verification.",
  STALE_PROVIDER: "Upstream provider is stale; estimates suspended.",
  NO_TRAINED_MODEL: "No trained model for this horizon.",
  SPARSE_GROUP: "Too few comparable historical events.",
  NO_COMPARABLE_HISTORY: "No comparable events in the training history for this event type and channel.",
  SOURCE_CONFLICT: "Sources contradict each other on key facts.",
  EVENT_OVERLAP: "Overlapping catalysts make attribution ambiguous.",
  BELOW_NOISE: "Expected effect is small relative to normal volatility.",
  UNCALIBRATED_PROBABILITIES: "Probabilities withheld: not calibrated out-of-sample for this group.",
  CALIBRATED: "Interval coverage and class probabilities evaluated out-of-sample.",
  INTERVAL_UNAVAILABLE: "No empirically calibrated interval for this horizon.",
};

export function gateForecast(
  ctx: ForecastContext,
  model: EventReactionModel | null,
  pred: { nEff: number; depth: number; calibrated: boolean; centralStd: number; hasInterval: boolean } | null,
): GateResult {
  const reasons: string[] = [];
  const abstain = (code: string): GateResult => ({
    tier: "insufficient",
    showCentral: false,
    showInterval: false,
    showProbabilities: false,
    reasonCodes: [...reasons, code],
  });
  const directionOnly = (code: string): GateResult => ({
    tier: ctx.mechanismSign && ctx.mechanismSign !== "mixed" ? "direction_only" : "insufficient",
    showCentral: false,
    showInterval: false,
    showProbabilities: false,
    reasonCodes: [...reasons, code],
  });

  if (!ctx.exposureVerified) return abstain("SYMBOL_MAPPING_DOUBT");
  if (!ctx.numericFactsVerified) return abstain("UNVERIFIED_NUMERIC_FACTS");
  if (ctx.sigmaHPct === null || !(ctx.sigmaHPct > 0)) return directionOnly("NO_PRICE_HISTORY");
  if (!ctx.baseline) return directionOnly("NO_BASELINE_PRICE");
  if (ctx.providerStale) return directionOnly("STALE_PROVIDER");
  if (!model || !model.horizons[ctx.horizon] || !pred) return directionOnly("NO_TRAINED_MODEL");
  if (pred.nEff === 0) return directionOnly("NO_COMPARABLE_HISTORY");
  // The subtype-only level pools exposures of opposite expected sign; it is a prior, not an estimate.
  if (pred.depth < MIN_ESTIMATE_DEPTH || pred.nEff < MIN_N_EFF_FOR_ESTIMATE) return directionOnly("SPARSE_GROUP");
  if (ctx.sourceConflict) return directionOnly("SOURCE_CONFLICT");

  let tier: QualityTier = "evaluated";
  let showCentral = true;
  let showProbabilities = pred.calibrated && pred.nEff >= MIN_N_EFF_FOR_PROBABILITIES;
  if (ctx.overlapping) {
    reasons.push("EVENT_OVERLAP");
    showProbabilities = false;
  }
  if (Math.abs(pred.centralStd) < NOISE_FLOOR_SIGMA) {
    reasons.push("BELOW_NOISE");
    showCentral = false;
  }
  if (!pred.hasInterval) reasons.push("INTERVAL_UNAVAILABLE");
  if (showProbabilities) {
    tier = "calibrated";
    reasons.push("CALIBRATED");
  } else if (!ctx.overlapping) {
    reasons.push("UNCALIBRATED_PROBABILITIES");
  }
  return { tier, showCentral, showInterval: pred.hasInterval, showProbabilities, reasonCodes: reasons };
}

export function directionFrom(
  tier: QualityTier,
  central: number | null,
  neutralBand: number | null,
  mechanismSign: Sign | null,
  showCentral: boolean,
): Direction {
  if (tier === "insufficient") return "insufficient";
  if (tier === "direction_only") {
    if (mechanismSign === "positive") return "bullish";
    if (mechanismSign === "negative") return "bearish";
    return "mixed";
  }
  if (!showCentral || central === null || neutralBand === null) return "no_edge";
  if (Math.abs(central) <= neutralBand) return "no_edge";
  return central > 0 ? "bullish" : "bearish";
}

/** Adaptive precision: 0.1% for typical moves, 0.01% only for sub-0.1% values. */
export function roundPct(x: number): number {
  return Math.abs(x) < 0.1 ? round(x, 2) : round(x, 1);
}

export function buildForecast(ctx: ForecastContext, model: EventReactionModel | null): ForecastSnapshot {
  const hm = model?.horizons[ctx.horizon] ?? null;
  const pred = hm && ctx.sigmaHPct ? predict(hm, ctx.path, ctx.sigmaHPct) : null;
  const gate = gateForecast(
    ctx,
    model,
    pred
      ? { nEff: pred.nEff, depth: pred.depth, calibrated: pred.calibrated, centralStd: pred.yHat, hasInterval: pred.intervalPct !== null }
      : null,
  );
  const neutralBandPct = ctx.sigmaHPct ? roundPct(NEUTRAL_BAND_SIGMA * ctx.sigmaHPct) : null;
  const central = pred && gate.showCentral ? roundPct(pred.centralPct) : null;
  let lo: number | null = null;
  let hi: number | null = null;
  if (pred?.intervalPct && gate.showInterval) {
    lo = roundPct(pred.intervalPct[0]);
    hi = roundPct(pred.intervalPct[1]);
    // Conservative coherence: an interval never excludes its own central estimate.
    if (central !== null) {
      lo = Math.min(lo, central);
      hi = Math.max(hi, central);
    }
  }
  let probabilities: Probabilities | null = null;
  if (pred?.probabilities && gate.showProbabilities) {
    const p = pred.probabilities;
    // Round to whole percents while preserving the unit sum (largest-remainder method).
    probabilities = roundProbabilities(p);
  }
  const direction = directionFrom(gate.tier, pred && gate.showCentral ? pred.centralPct : null, neutralBandPct, ctx.mechanismSign, gate.showCentral);
  const revision = ctx.revision ?? 1;
  const id = `fc_${hashHex(`${ctx.eventId}|${ctx.securityId}|${ctx.horizon}|${ctx.forecastGeneratedAt}|${revision}`)}`;
  const snapshot: ForecastSnapshot = {
    id,
    eventId: ctx.eventId,
    securityId: ctx.securityId,
    ticker: ctx.ticker,
    horizon: ctx.horizon,
    forecastGeneratedAt: ctx.forecastGeneratedAt,
    asOf: ctx.asOf,
    baselinePriceTime: ctx.baseline?.at ?? null,
    baseMarketPrice: ctx.baseline?.price ?? null,
    target: "abnormal",
    centralMovePct: central,
    intervalLowPct: lo,
    intervalHighPct: hi,
    intervalLevel: INTERVAL_LEVEL,
    probabilities,
    neutralBandPct,
    direction,
    qualityTier: gate.tier,
    sampleSize: hm?.trainN ?? 0,
    nEff: pred ? Math.round(pred.nEff) : 0,
    modelVersion: model?.version ?? "none",
    inputDataProvenance: Array.from(new Set([...ctx.provenance, ...(pred ? (["model_estimate"] as const) : [])])),
    reasonCodes: gate.reasonCodes,
    invalidationConditions: ctx.invalidationConditions,
    revision,
    supersedes: ctx.supersedes ?? null,
    isSynthetic: ctx.isSynthetic,
  };
  const errors = validateForecast(snapshot);
  if (errors.length) throw new Error(`Invalid forecast ${id}: ${errors.join("; ")}`);
  return Object.freeze(snapshot);
}

export function roundProbabilities(p: Probabilities): Probabilities {
  const keys = ["up", "down", "neutral"] as const;
  const scaled = keys.map((k) => p[k] * 100);
  const floors = scaled.map(Math.floor);
  let rem = 100 - floors.reduce((a, b) => a + b, 0);
  const order = scaled.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (const o of order) {
    if (rem <= 0) break;
    floors[o.i]! += 1;
    rem--;
  }
  return { up: floors[0]! / 100, down: floors[1]! / 100, neutral: floors[2]! / 100 };
}

/** Coherence checks run on every forecast before it is persisted or rendered. */
export function validateForecast(f: ForecastSnapshot): string[] {
  const e: string[] = [];
  const bound = MAGNITUDE_BOUNDS[f.horizon];
  if (!bound) e.push(`unknown horizon ${f.horizon}`);
  const nums = [f.centralMovePct, f.intervalLowPct, f.intervalHighPct].filter((x): x is number => x !== null);
  for (const x of nums) {
    if (!Number.isFinite(x)) e.push("non-finite value");
    else if (bound && Math.abs(x) > bound) e.push(`|${x}| exceeds ${bound}% bound for ${f.horizon}`);
  }
  if ((f.intervalLowPct === null) !== (f.intervalHighPct === null)) e.push("interval must have both ends");
  if (f.intervalLowPct !== null && f.intervalHighPct !== null) {
    if (f.intervalLowPct > f.intervalHighPct) e.push("interval low > high");
    if (f.centralMovePct !== null && (f.centralMovePct < f.intervalLowPct - 1e-9 || f.centralMovePct > f.intervalHighPct + 1e-9)) {
      e.push("central outside interval");
    }
  }
  if (f.probabilities) {
    const { up, down, neutral } = f.probabilities;
    for (const v of [up, down, neutral]) if (!(v >= 0 && v <= 1)) e.push("probability out of [0,1]");
    if (Math.abs(up + down + neutral - 1) > PROBABILITY_SUM_TOLERANCE + 1e-9) e.push("probabilities do not sum to 1");
    if (f.qualityTier !== "calibrated") e.push("probabilities present on uncalibrated forecast");
  }
  if (f.qualityTier === "insufficient" || f.qualityTier === "direction_only") {
    if (f.centralMovePct !== null || f.intervalLowPct !== null || f.probabilities) e.push("abstaining forecast carries numbers");
  }
  if (Date.parse(f.asOf) > Date.parse(f.forecastGeneratedAt)) e.push("asOf after generation time");
  if (f.baselinePriceTime && Date.parse(f.baselinePriceTime) > Date.parse(f.asOf)) e.push("baseline price after asOf (look-ahead)");
  return e;
}
