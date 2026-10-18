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
import { CLASSES, type ClassKey, fitIsotonic, normalizeProbabilities, predictIsotonic, reliabilityBins, type IsotonicModel } from "./calibration";
import { conformalInterval, empiricalCoverage, fitConformal, type ConformalCalibration } from "./intervals";
import { fitHierarchicalPrior, predictPrior, selectLambda, type HierarchicalPrior, type PriorObservation } from "./priors";

export const NEUTRAL_BAND_SIGMA = 0.5;
export const INTERVAL_LEVEL = 0.8;
export const MIN_CALIBRATION_N = 150;
export const COVERAGE_TOLERANCE = 0.07;
export const PROBABILITY_FLOOR = 0.02;
export const PROBABILITY_CEIL = 0.96;

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
  const clean = examples
    .filter((e) => e.horizon === horizon && !e.overlapping && e.sigmaHPct > 0)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const train = clean.filter((e) => Date.parse(e.at) < cut);
  const cal = clean.filter((e) => Date.parse(e.at) >= cut && Date.parse(e.at) < calEnd);
  if (train.length < 40) return null;

  const split = Math.floor(train.length * 0.8);
  const { lambda, mse } = selectLambda(toObs(train.slice(0, split)), toObs(train.slice(split)));
  const prior = fitHierarchicalPrior(toObs(train), lambda);

  const calA: TrainingExample[] = [];
  const calB: TrainingExample[] = [];
  cal.forEach((e, i) => (i % 2 === 0 ? calA : calB).push(e));

  const residualsA = calA.map((e) => e.arPct / e.sigmaHPct - predictPrior(prior, e.path).mu);
  const conformal = fitConformal(residualsA, INTERVAL_LEVEL);

  let isotonic: Record<ClassKey, IsotonicModel> | null = null;
  let calibrationCoverage: number | null = null;
  let calibrationEce: number | null = null;
  if (conformal && calB.length >= 20) {
    const raw = calB.map((e) => {
      const yHat = predictPrior(prior, e.path).mu;
      return { p: rawClassProbabilities(yHat, residualsA), y: classOf(e.arPct / e.sigmaHPct), yHat, yReal: e.arPct / e.sigmaHPct };
    });
    isotonic = {} as Record<ClassKey, IsotonicModel>;
    for (const k of CLASSES) {
      isotonic[k] = fitIsotonic(
        raw.map((r) => r.p[k]),
        raw.map((r) => (r.y === k ? 1 : 0)),
      );
    }
    calibrationCoverage = empiricalCoverage(
      raw.map((r) => {
        const [lo, hi] = conformalInterval(r.yHat, conformal);
        return { lo, hi, y: r.yReal };
      }),
    );
    calibrationEce = reliabilityBins(
      raw.map((r) => r.p.up),
      raw.map((r) => (r.y === "up" ? 1 : 0)),
    ).ece;
  }

  const enough = cal.length >= MIN_CALIBRATION_N;
  const coverageOk = calibrationCoverage !== null && Math.abs(calibrationCoverage - INTERVAL_LEVEL) <= COVERAGE_TOLERANCE;
  const calibrated = Boolean(enough && coverageOk && isotonic && conformal);
  const calibrationNote = !enough
    ? `Calibration sample ${cal.length} < ${MIN_CALIBRATION_N}; probabilities withheld.`
    : !coverageOk
      ? `Calibration-split interval coverage ${(calibrationCoverage ?? 0).toFixed(2)} outside ${INTERVAL_LEVEL}±${COVERAGE_TOLERANCE}.`
      : `Calibrated on ${cal.length} clean events (${calA.length} residual / ${calB.length} isotonic).`;

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

export function predict(model: HorizonModel, path: readonly string[], sigmaHPct: number): ModelPrediction {
  const p = predictPrior(model.prior, path);
  const centralPct = p.mu * sigmaHPct;
  const intervalStd = model.conformal ? conformalInterval(p.mu, model.conformal) : null;
  let probabilities: Probabilities | null = null;
  if (model.calibrated && model.isotonic) {
    const raw = rawClassProbabilities(p.mu, model.residualsA);
    // Shrink away from 0/1: a finite calibration sample cannot justify certainty.
    const clip = (x: number) => Math.min(PROBABILITY_CEIL, Math.max(PROBABILITY_FLOOR, x));
    const cal = {
      up: clip(predictIsotonic(model.isotonic.up, raw.up)),
      down: clip(predictIsotonic(model.isotonic.down, raw.down)),
      neutral: clip(predictIsotonic(model.isotonic.neutral, raw.neutral)),
    };
    probabilities = normalizeProbabilities(cal);
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
