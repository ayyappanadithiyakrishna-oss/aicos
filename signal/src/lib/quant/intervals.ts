/**
 * Split-conformal predictive intervals on standardized residuals.
 *
 * Residuals r = y − ŷ are collected on a calibration split that the prior never saw. The interval
 * for a new point is [ŷ + q_lo, ŷ + q_hi] (standardized), rescaled by the asset's σ_h. Asymmetric
 * quantiles keep skew; the finite-sample level adjustment gives ≥ nominal marginal coverage under
 * exchangeability. Coverage is then *measured* on the held-out test split, not assumed.
 */
import { quantile } from "./stats";

export interface ConformalCalibration {
  level: number;
  n: number;
  qLo: number;
  qHi: number;
}

export function fitConformal(residuals: readonly number[], level = 0.8): ConformalCalibration | null {
  const n = residuals.length;
  if (n < 20) return null;
  const alpha = 1 - level;
  // Finite-sample correction on each tail.
  const adj = Math.min(1, Math.ceil((n + 1) * (1 - alpha / 2)) / n);
  return {
    level,
    n,
    qLo: quantile(residuals, 1 - adj),
    qHi: quantile(residuals, adj),
  };
}

export function conformalInterval(yHat: number, cal: ConformalCalibration): [number, number] {
  return [yHat + cal.qLo, yHat + cal.qHi];
}

/** Fraction of realized values that fell inside their interval. */
export function empiricalCoverage(pairs: ReadonlyArray<{ lo: number; hi: number; y: number }>): number | null {
  if (!pairs.length) return null;
  let inside = 0;
  for (const p of pairs) if (p.y >= p.lo && p.y <= p.hi) inside++;
  return inside / pairs.length;
}
