/** Deterministic PRNG and statistical primitives. No Math.random anywhere in quant code. */

export type Rng = () => number;

/** mulberry32: small, fast, deterministic 32-bit generator. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash for deriving stable seeds and IDs from strings. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashHex(s: string): string {
  // Two independent FNV passes give a 64-bit-ish stable hex id.
  return hash32(s).toString(16).padStart(8, "0") + hash32(`${s}::salt`).toString(16).padStart(8, "0");
}

export function normal(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Student-t draw scaled to unit variance (requires nu > 2). */
export function studentT(rng: Rng, nu: number): number {
  let chi = 0;
  for (let i = 0; i < nu; i++) {
    const z = normal(rng);
    chi += z * z;
  }
  const t = normal(rng) / Math.sqrt(chi / nu);
  return t / Math.sqrt(nu / (nu - 2));
}

/** Cheap heavy-tailed draw (normal scale mixture), unit variance. For hot simulation loops. */
export function heavyTail(rng: Rng): number {
  return (normal(rng) * (rng() < 0.08 ? 2.2 : 0.9)) / 1.0632;
}

export function pick<T>(rng: Rng, xs: readonly T[]): T {
  const v = xs[Math.floor(rng() * xs.length)];
  if (v === undefined) throw new Error("pick from empty array");
  return v;
}

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: readonly number[]): number {
  return xs.length ? sum(xs) / xs.length : Number.NaN;
}

export function variance(xs: readonly number[], ddof = 1): number {
  if (xs.length <= ddof) return Number.NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - ddof);
}

export function std(xs: readonly number[], ddof = 1): number {
  return Math.sqrt(variance(xs, ddof));
}

/** Linear-interpolated quantile (Hyndman–Fan type 7). */
export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = s[lo]!;
  const b = s[hi]!;
  return a + (b - a) * (pos - lo);
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** OLS slope of y on x (with intercept). Returns null when undefined. */
export function olsSlope(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  return sxx > 0 ? sxy / sxx : null;
}

/** Percentile bootstrap CI of a statistic; deterministic given the seed. */
export function bootstrapCI<T>(
  sample: readonly T[],
  stat: (xs: readonly T[]) => number,
  opts: { reps?: number; level?: number; seed?: number } = {},
): [number, number] | null {
  const { reps = 400, level = 0.9, seed = 7 } = opts;
  if (sample.length < 2) return null;
  const rng = mulberry32(seed);
  const stats: number[] = [];
  for (let r = 0; r < reps; r++) {
    const resample: T[] = [];
    for (let i = 0; i < sample.length; i++) resample.push(sample[Math.floor(rng() * sample.length)]!);
    const v = stat(resample);
    if (Number.isFinite(v)) stats.push(v);
  }
  if (!stats.length) return null;
  const a = (1 - level) / 2;
  return [quantile(stats, a), quantile(stats, 1 - a)];
}

export function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
