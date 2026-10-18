/**
 * Hierarchical shrinkage prior for standardized event reactions.
 *
 *   mu_post(level) = w × mu_group + (1 − w) × mu_post(parent),   w = n_eff / (n_eff + λ)
 *
 * The target is the standardized abnormal return y = AR / σ_h, so groups that pool assets with
 * different volatilities are comparable. λ is chosen on a validation split (see selectLambda),
 * never on the test period.
 */
import { mean, variance } from "./stats";

export interface PriorObservation {
  /** Hierarchy path from coarsest to finest, e.g. ["macro.cpi", "macro.cpi|pos", "macro.cpi|pos|rates:neg"]. */
  path: string[];
  y: number;
  /** Optional weight (e.g. down-weight overlapping events). */
  weight?: number;
}

interface GroupStats {
  n: number;
  sumW: number;
  mean: number;
  variance: number;
}

export interface HierarchicalPrior {
  lambda: number;
  global: GroupStats;
  groups: Record<string, GroupStats>;
}

export interface PriorPrediction {
  mu: number;
  /** Shrunk dispersion of y within the finest supported group. */
  sigma: number;
  /** Effective sample size of the finest level that contributed (0 if none). */
  nEff: number;
  /** Deepest path level with any data. */
  depth: number;
  trail: Array<{ key: string; n: number; w: number; groupMean: number; posterior: number }>;
}

function stats(ys: number[], ws: number[]): GroupStats {
  const sumW = ws.reduce((a, b) => a + b, 0);
  const m = sumW > 0 ? ys.reduce((a, y, i) => a + y * ws[i]!, 0) / sumW : Number.NaN;
  const v = ys.length > 1 ? variance(ys) : Number.NaN;
  // Kish effective sample size for weighted observations.
  const sumW2 = ws.reduce((a, b) => a + b * b, 0);
  const n = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
  return { n, sumW, mean: m, variance: v };
}

export function fitHierarchicalPrior(obs: readonly PriorObservation[], lambda: number): HierarchicalPrior {
  if (!obs.length) throw new Error("Cannot fit prior without observations");
  const byKey = new Map<string, { ys: number[]; ws: number[] }>();
  const allY: number[] = [];
  const allW: number[] = [];
  for (const o of obs) {
    const w = o.weight ?? 1;
    allY.push(o.y);
    allW.push(w);
    for (const k of o.path) {
      let g = byKey.get(k);
      if (!g) byKey.set(k, (g = { ys: [], ws: [] }));
      g.ys.push(o.y);
      g.ws.push(w);
    }
  }
  const groups: Record<string, GroupStats> = {};
  for (const [k, g] of byKey) groups[k] = stats(g.ys, g.ws);
  return { lambda, global: stats(allY, allW), groups };
}

/** Levels with fewer effective observations than this are skipped (backoff to the parent). */
export const BACKOFF_MIN_N = 8;

export function predictPrior(prior: HierarchicalPrior, path: readonly string[], backoffMinN = BACKOFF_MIN_N): PriorPrediction {
  let mu = prior.global.mean;
  let sigma2 = prior.global.variance;
  let nEff = 0;
  let depth = 0;
  const trail: PriorPrediction["trail"] = [];
  for (let i = 0; i < path.length; i++) {
    const key = path[i]!;
    const g = prior.groups[key];
    if (!g || g.n < backoffMinN) break;
    const w = g.n / (g.n + prior.lambda);
    mu = w * g.mean + (1 - w) * mu;
    if (Number.isFinite(g.variance)) sigma2 = w * g.variance + (1 - w) * sigma2;
    nEff = g.n;
    depth = i + 1;
    trail.push({ key, n: g.n, w, groupMean: g.mean, posterior: mu });
  }
  return { mu, sigma: Math.sqrt(sigma2), nEff, depth, trail };
}

/** Choose λ by minimizing validation MSE over a fixed grid. */
export function selectLambda(
  train: readonly PriorObservation[],
  validation: readonly PriorObservation[],
  grid: readonly number[] = [1, 2, 5, 10, 20, 50, 100],
): { lambda: number; mse: Record<string, number> } {
  const mse: Record<string, number> = {};
  let best = grid[0]!;
  let bestMse = Number.POSITIVE_INFINITY;
  for (const lambda of grid) {
    const p = fitHierarchicalPrior(train, lambda);
    const errs = validation.map((o) => (o.y - predictPrior(p, o.path).mu) ** 2);
    const m = mean(errs);
    mse[String(lambda)] = m;
    if (m < bestMse) {
      bestMse = m;
      best = lambda;
    }
  }
  return { lambda: best, mse };
}
