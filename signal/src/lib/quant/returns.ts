import type { PriceBar } from "@/lib/domain/types";

/**
 * Bar timestamps (`t`) are the bar END (close) time in UTC, so a bar's close is known at `t`.
 * This makes "price available at time X" a simple `t <= X` filter and prevents look-ahead.
 */

/** Log return in percent: 100 × ln(P_end / P_start). */
export function logReturnPct(p0: number, p1: number): number {
  if (!(p0 > 0) || !(p1 > 0)) throw new Error("Prices must be positive for log returns");
  return 100 * Math.log(p1 / p0);
}

/** Abnormal return AR = r_i − β × r_benchmark (all in percent). */
export function abnormalReturnPct(rawPct: number, benchmarkPct: number, beta: number): number {
  return rawPct - beta * benchmarkPct;
}

const timeIndex = new WeakMap<readonly PriceBar[], Float64Array>();

/** Cached numeric bar-end times (ms) for binary search. Bars must be sorted ascending by t. */
export function barTimes(bars: readonly PriceBar[]): Float64Array {
  let ix = timeIndex.get(bars);
  if (!ix || ix.length !== bars.length) {
    ix = new Float64Array(bars.length);
    for (let i = 0; i < bars.length; i++) ix[i] = Date.parse(bars[i]!.t);
    timeIndex.set(bars, ix);
  }
  return ix;
}

/** Index of the last bar with t <= atMs, or −1. */
export function indexAtOrBefore(bars: readonly PriceBar[], atMs: number): number {
  const ix = barTimes(bars);
  let lo = 0;
  let hi = ix.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ix[mid]! <= atMs) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** Binary search for the last bar with t <= at. Bars must be sorted ascending by t. */
export function lastBarAtOrBefore(bars: readonly PriceBar[], at: Date | string): PriceBar | null {
  const ts = typeof at === "string" ? Date.parse(at) : at.getTime();
  const i = indexAtOrBefore(bars, ts);
  return i >= 0 ? bars[i]! : null;
}

/** Bars strictly after `from` and at or before `to`. */
export function barsBetween(bars: readonly PriceBar[], from: Date, to: Date): PriceBar[] {
  const a = from.getTime();
  const b = to.getTime();
  return bars.filter((x) => {
    const t = Date.parse(x.t);
    return t > a && t <= b;
  });
}

export function dailyLogReturnsPct(bars: readonly PriceBar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) out.push(logReturnPct(bars[i - 1]!.c, bars[i]!.c));
  return out;
}

/** Cumulative split adjustment: divide pre-split prices by the factor product. */
export function adjustForSplits(
  bars: readonly PriceBar[],
  splits: ReadonlyArray<{ effective: string; ratio: number }>,
): PriceBar[] {
  return bars.map((b) => {
    let f = 1;
    for (const s of splits) if (Date.parse(b.t) < Date.parse(s.effective)) f *= s.ratio;
    return f === 1 ? b : { ...b, o: b.o / f, h: b.h / f, l: b.l / f, c: b.c / f, v: b.v * f };
  });
}
