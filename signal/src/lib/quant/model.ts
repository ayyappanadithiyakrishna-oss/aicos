/**
 * Event-reaction model: hierarchical prior (central estimate) + split-conformal interval +
 * isotonic-calibrated class probabilities. Trained per horizon on point-in-time history.
 *
 * Splits (chronological, never shuffled):
 *   train        : t <  trainingCutoff            (λ chosen on the last 20% of train)
 *   calibration  : trainingCutoff ≤ t < calEnd    (alternating A/B: A → residuals, B → isotonic)
 *   test         : t ≥ calEnd                     (only used by the scorecard, never for fitting)
 *
 * Class definition (fixed, documented): with y = AR / σ_h,
 *   up: y > +0.5   down: y < −0.5   neutral: |y| ≤ 0.5
 */
import type { Horizon, Probabilities } from "@/lib/domain/types";
import { CLASSES, type ClassKey, fitIsotonic, normalizeProbabilities, predictIsotonic, reliabilityBins, brierMulticlass, type IsotonicModel } from "./calibration";
import { horizonWindow } from "@/lib/calendar/horizons";
import { conformalInterval, empiricalCoverage, fitConformal, type ConformalCalibration } from "./intervals";
import { fitHierarchicalPrior, predictPrior, selectLambda, type HierarchicalPrior, type PriorObservation } from "./priors";

export const NEUTRAL_BAND_SIGMA = 0.5;
export const INTERVAL_LEVEL = 0.8;
export const MIN_CALIBRATION_N = 150;
export const COVERAGE_TOLERANCE = 0.07;
export const PROBABILITY_FLOOR = 0.02;
export const PROBABILITY_CEIL = 0.96;
export const MAX_HOLDOUT_ECE = 0.12;
export const MIN_HOLDOUT_EVENTS = 30;

export interface TrainingExample {
  eventId: string;
  securityId: string;
  at: string;
  horizon: Horizon;
  path: string[];
  /** Past-only horizon volatility in percent used to standardize. */
  sigmaHPct: number;
  /** Realized abnormal return in percent. */
  arPct: number;
  overlapping: boolean;
  sector: string;
  eventKind: string;
  regime: string;
  /** Actual outcome maturity; examples crossing a split boundary are purged. */
  windowEnd?: string;
}

export interface HorizonModel {
  horizon: Horizon;
  prior: HierarchicalPrior;
  lambdaMse: Record<string, number>;
  conformal: ConformalCalibration | null;
  residualsA: number[];
  isotonic: Record<ClassKey, IsotonicModel> | null;
  trainN: number;
  calN: number;
  calibrationCoverage: number | null;
  calibrationEce: number | null;
  calibrated: boolean;
  calibrationNote: string;
  validation?: {
    method: "chronological-held-out-v1";
    from: string;
    n: number;
    eventCount: number;
    ece: number | null;
    brier: number | null;
    climatologyBrier: number | null;
  };
}

export interface EventReactionModel {
  version: string;
  methodology: string;
  trainedAt: string;
  trainingCutoff: string;
  calibrationEnd: string;
  horizons: Partial<Record<Horizon, HorizonModel>>;
  neutralBandSigma: number;
  isSynthetic: boolean;
}

export function classOf(y: number, band = NEUTRAL_BAND_SIGMA): ClassKey {
  if (y > band) return "up";
  if (y < -band) return "down";
  return "neutral";
}

function rawClassProbabilities(yHat: number, residuals: readonly number[], band = NEUTRAL_BAND_SIGMA): Record<ClassKey, number> {
  let up = 0;
  let down = 0;
  for (const r of residuals) {
    const y = yHat + r;
    if (y > band) up++;
    else if (y < -band) down++;
  }
  const n = residuals.length || 1;
  return { up: up / n, down: down / n, neutral: (n - up - down) / n };
}

function toObs(xs: readonly TrainingExample[]): PriorObservation[] {
  return xs.map((x) => ({ path: x.path, y: x.arPct / x.sigmaHPct }));
}

export function trainHorizonModel(
  examples: readonly TrainingExample[],
  horizon: Horizon,
  trainingCutoff: string,
  calibrationEnd: string,
): HorizonModel | null {
  const cut = Date.parse(trainingCutoff);
  const calEnd = Date.parse(calibrationEnd);
  const endOf = (e: TrainingExample) => Date.parse(e.windowEnd ?? horizonWindow(new Date(e.at), e.horizon).end.toISOString());
  const clean = examples
    .filter((e) => e.horizon === horizon && !e.overlapping && Number.isFinite(e.sigmaHPct) && e.sigmaHPct > 0 && Number.isFinite(e.arPct))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const train = clean.filter((e) => Date.parse(e.at) < cut && endOf(e) < cut);
  const cal = clean.filter((e) => Date.parse(e.at) >= cut && Date.parse(e.at) < calEnd && endOf(e) < calEnd);
  if (train.length < 40) return null;

  // Validation and all calibration splits are chronological; an event timestamp never straddles
  // splits, and no outcome is allowed to mature into the next split.
  const validationAt = Date.parse(train[Math.floor(train.length * 0.8)]!.at);
  const { lambda, mse } = selectLambda(toObs(train.filter((e) => endOf(e) < validationAt)), toObs(train.filter((e) => Date.parse(e.at) >= validationAt)));
  const prior = fitHierarchicalPrior(toObs(train), lambda);
  const fitAt = cal[Math.floor(cal.length * 0.5)]?.at ?? calibrationEnd;
  const holdoutAt = cal[Math.floor(cal.length * 0.75)]?.at ?? calibrationEnd;
  const calA = cal.filter((e) => Date.parse(e.at) < Date.parse(fitAt) && endOf(e) < Date.parse(fitAt));
  const calB = cal.filter((e) => Date.parse(e.at) >= Date.parse(fitAt) && Date.parse(e.at) < Date.parse(holdoutAt) && endOf(e) < Date.parse(holdoutAt));
  const held = cal.filter((e) => Date.parse(e.at) >= Date.parse(holdoutAt));

  const residualsA = calA.map((e) => e.arPct / e.sigmaHPct - predictPrior(prior, e.path).mu);
  const conformal = fitConformal(residualsA, INTERVAL_LEVEL);
  let isotonic: Record<ClassKey, IsotonicModel> | null = null;
  let calibrationCoverage: number | null = null;
  let calibrationEce: number | null = null;
  let brier: number | null = null;
  let climatologyBrier: number | null = null;
  if (conformal && calB.length >= 20 && held.length >= 20) {
    const fit = calB.map((e) => ({ p: rawClassProbabilities(predictPrior(prior, e.path).mu, residualsA), y: classOf(e.arPct / e.sigmaHPct) }));
    isotonic = {} as Record<ClassKey, IsotonicModel>;
    for (const k of CLASSES) isotonic[k] = fitIsotonic(fit.map((r) => r.p[k]), fit.map((r) => r.y === k ? 1 : 0));
    const evaluated = held.map((e) => {
      const yHat = predictPrior(prior, e.path).mu;
      const raw = rawClassProbabilities(yHat, residualsA);
      const p = calibratedProbabilities(raw, isotonic!);
      return { p, y: classOf(e.arPct / e.sigmaHPct), yHat, yReal: e.arPct / e.sigmaHPct };
    });
    calibrationCoverage = empiricalCoverage(evaluated.map((r) => {
      const [lo, hi] = conformalInterval(r.yHat, conformal);
      return { lo, hi, y: r.yReal };
    }));
    // Post-calibration ECE on untouched examples, across all three classes.
    calibrationEce = Math.max(...CLASSES.map((k) => reliabilityBins(evaluated.map((r) => r.p[k]), evaluated.map((r) => r.y === k ? 1 : 0)).ece ?? 1));
    brier = brierMulticlass(evaluated);
    const base = Object.fromEntries(CLASSES.map((k) => [k, train.filter((e) => classOf(e.arPct / e.sigmaHPct) === k).length / train.length])) as Record<ClassKey, number>;
    climatologyBrier = brierMulticlass(evaluated.map((r) => ({ p: base, y: r.y })));
  }
  const eventCount = new Set(held.map((e) => e.eventId)).size;
  const enough = new Set(cal.map((e) => e.eventId)).size >= MIN_CALIBRATION_N && eventCount >= MIN_HOLDOUT_EVENTS;
  const coverageOk = calibrationCoverage !== null && Math.abs(calibrationCoverage - INTERVAL_LEVEL) <= COVERAGE_TOLERANCE;
  const probabilityOk = calibrationEce !== null && calibrationEce <= MAX_HOLDOUT_ECE && brier !== null && climatologyBrier !== null && brier <= climatologyBrier;
  const calibrated = Boolean(enough && coverageOk && probabilityOk && isotonic && conformal);
  const calibrationNote = `${calA.length} interval-fit / ${calB.length} probability-fit / ${held.length} untouched holdout reactions (${eventCount} events). ` +
    (!enough ? "Insufficient independent holdout events; probabilities withheld." : !coverageOk ? "Holdout interval coverage outside tolerance; probabilities withheld." : !probabilityOk ? "Holdout probability calibration or baseline check failed; probabilities withheld." : "Passed independent holdout coverage, calibration and baseline checks.");

  return {
    horizon,
    prior,
    lambdaMse: mse,
    conformal,
    residualsA,
    isotonic,
    trainN: train.length,
    calN: cal.length,
    calibrationCoverage,
    calibrationEce,
    calibrated,
    calibrationNote,
    validation: { method: "chronological-held-out-v1", from: holdoutAt, n: held.length, eventCount, ece: calibrationEce, brier, climatologyBrier },
  };
}

export function trainModel(
  examples: readonly TrainingExample[],
  opts: { version: string; trainedAt: string; trainingCutoff: string; calibrationEnd: string; isSynthetic: boolean; horizons: readonly Horizon[] },
): EventReactionModel {
  const horizons: Partial<Record<Horizon, HorizonModel>> = {};
  for (const h of opts.horizons) {
    const m = trainHorizonModel(examples, h, opts.trainingCutoff, opts.calibrationEnd);
    if (m) horizons[h] = m;
  }
  return {
    version: opts.version,
    methodology: "hierarchical-shrinkage prior · split-conformal 80% interval · isotonic class calibration",
    trainedAt: opts.trainedAt,
    trainingCutoff: opts.trainingCutoff,
    calibrationEnd: opts.calibrationEnd,
    horizons,
    neutralBandSigma: NEUTRAL_BAND_SIGMA,
    isSynthetic: opts.isSynthetic,
  };
}

export interface ModelPrediction {
  yHat: number;
  centralPct: number;
  intervalPct: [number, number] | null;
  probabilities: Probabilities | null;
  nEff: number;
  depth: number;
  pathDepth: number;
  trail: ReturnType<typeof predictPrior>["trail"];
  calibrated: boolean;
}

function calibratedProbabilities(raw: Record<ClassKey, number>, isotonic: Record<ClassKey, IsotonicModel>): Probabilities {
  const n = normalizeProbabilities({ up: Math.max(0, predictIsotonic(isotonic.up, raw.up)), down: Math.max(0, predictIsotonic(isotonic.down, raw.down)), neutral: Math.max(0, predictIsotonic(isotonic.neutral, raw.neutral)) });
  // A convex mixture with the uniform distribution preserves both the sum and the 2% floor.
  // Clipping BEFORE normalization did not: a 2% class could end up below 2% after division.
  const scale = 1 - CLASSES.length * PROBABILITY_FLOOR;
  return { up: PROBABILITY_FLOOR + scale * n.up, down: PROBABILITY_FLOOR + scale * n.down, neutral: PROBABILITY_FLOOR + scale * n.neutral };
}

export function predict(model: HorizonModel, path: readonly string[], sigmaHPct: number): ModelPrediction {
  const p = predictPrior(model.prior, path);
  const centralPct = p.mu * sigmaHPct;
  const intervalStd = model.conformal ? conformalInterval(p.mu, model.conformal) : null;
  let probabilities: Probabilities | null = null;
  if (model.calibrated && model.isotonic) {
    const raw = rawClassProbabilities(p.mu, model.residualsA);
    probabilities = calibratedProbabilities(raw, model.isotonic);
  }
  return {
    yHat: p.mu,
    centralPct,
    intervalPct: intervalStd ? [intervalStd[0] * sigmaHPct, intervalStd[1] * sigmaHPct] : null,
    probabilities,
    nEff: p.nEff,
    depth: p.depth,
    pathDepth: path.length,
    trail: p.trail,
    calibrated: model.calibrated,
  };
}
