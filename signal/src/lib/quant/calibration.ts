/**
 * Probability calibration and proper scoring rules.
 * Isotonic regression via pool-adjacent-violators; Platt scaling via Newton–Raphson.
 */

export interface IsotonicModel {
  /** Ascending breakpoints (x) with fitted non-decreasing values (y). */
  xs: number[];
  ys: number[];
  n: number;
}

export function fitIsotonic(x: readonly number[], y: readonly number[]): IsotonicModel {
  const n = Math.min(x.length, y.length);
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a]! - x[b]!);
  // Blocks of [sumY, weight, maxX]
  const blocks: Array<{ sy: number; w: number; xMax: number; xMin: number }> = [];
  for (const i of idx) {
    blocks.push({ sy: y[i]!, w: 1, xMax: x[i]!, xMin: x[i]! });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sy / a.w <= b.sy / b.w) break;
      blocks.splice(blocks.length - 2, 2, { sy: a.sy + b.sy, w: a.w + b.w, xMax: b.xMax, xMin: a.xMin });
    }
  }
  return { xs: blocks.map((b) => (b.xMin + b.xMax) / 2), ys: blocks.map((b) => b.sy / b.w), n };
}

/** Piecewise-linear interpolation between block centres; flat beyond the ends. */
export function predictIsotonic(m: IsotonicModel, x: number): number {
  const { xs, ys } = m;
  if (!xs.length) return x;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]!) / (xs[hi]! - xs[lo]! || 1);
  return ys[lo]! + t * (ys[hi]! - ys[lo]!);
}

export interface PlattModel {
  a: number;
  b: number;
}

/** Fit p = σ(a·s + b) by Newton–Raphson on the log-likelihood. */
export function fitPlatt(scores: readonly number[], labels: readonly number[], iters = 50): PlattModel {
  let a = 1;
  let b = 0;
  for (let k = 0; k < iters; k++) {
    let ga = 0;
    let gb = 0;
    let haa = 0;
    let hab = 0;
    let hbb = 0;
    for (let i = 0; i < scores.length; i++) {
      const s = scores[i]!;
      const p = 1 / (1 + Math.exp(-(a * s + b)));
      const d = labels[i]! - p;
      const w = p * (1 - p);
      ga += d * s;
      gb += d;
      haa += w * s * s;
      hab += w * s;
      hbb += w;
    }
    haa += 1e-9;
    hbb += 1e-9;
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a += da;
    b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-8) break;
  }
  return { a, b };
}

export function predictPlatt(m: PlattModel, s: number): number {
  return 1 / (1 + Math.exp(-(m.a * s + m.b)));
}

export type ClassKey = "up" | "down" | "neutral";
export const CLASSES: ClassKey[] = ["up", "down", "neutral"];

/** Multi-class Brier score: mean over samples of Σ_k (p_k − 1[y=k])². Range 0–2. */
export function brierMulticlass(
  rows: ReadonlyArray<{ p: Record<ClassKey, number>; y: ClassKey }>,
): number | null {
  if (!rows.length) return null;
  let s = 0;
  for (const r of rows) for (const k of CLASSES) s += (r.p[k] - (r.y === k ? 1 : 0)) ** 2;
  return s / rows.length;
}

export function logLossMulticlass(
  rows: ReadonlyArray<{ p: Record<ClassKey, number>; y: ClassKey }>,
  eps = 1e-6,
): number | null {
  if (!rows.length) return null;
  let s = 0;
  for (const r of rows) s -= Math.log(Math.min(1 - eps, Math.max(eps, r.p[r.y])));
  return s / rows.length;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  meanPredicted: number | null;
  observedRate: number | null;
}

export function reliabilityBins(
  preds: readonly number[],
  outcomes: readonly number[],
  bins = 10,
): { bins: ReliabilityBin[]; ece: number | null } {
  const out: ReliabilityBin[] = Array.from({ length: bins }, (_, i) => ({
    lo: i / bins,
    hi: (i + 1) / bins,
    n: 0,
    meanPredicted: null,
    observedRate: null,
  }));
  const acc = out.map(() => ({ sp: 0, so: 0, n: 0 }));
  for (let i = 0; i < preds.length; i++) {
    const b = Math.min(bins - 1, Math.floor(preds[i]! * bins));
    acc[b]!.sp += preds[i]!;
    acc[b]!.so += outcomes[i]!;
    acc[b]!.n += 1;
  }
  let ece = 0;
  const total = preds.length;
  acc.forEach((a, i) => {
    const bin = out[i]!;
    bin.n = a.n;
    if (a.n) {
      bin.meanPredicted = a.sp / a.n;
      bin.observedRate = a.so / a.n;
      ece += (a.n / total) * Math.abs(bin.meanPredicted - bin.observedRate);
    }
  });
  return { bins: out, ece: total ? ece : null };
}

/** Normalize a probability vector; throws on negatives or NaN. */
export function normalizeProbabilities(p: Record<ClassKey, number>): Record<ClassKey, number> {
  for (const k of CLASSES) {
    if (!Number.isFinite(p[k]) || p[k] < 0) throw new Error(`Invalid probability for ${k}: ${p[k]}`);
  }
  const s = p.up + p.down + p.neutral;
  if (s <= 0) throw new Error("Probabilities sum to zero");
  return { up: p.up / s, down: p.down / s, neutral: p.neutral / s };
}

export const PROBABILITY_SUM_TOLERANCE = 1e-6;
