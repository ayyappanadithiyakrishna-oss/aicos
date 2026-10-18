/**
 * Point-in-time feature construction. Every input carries the instant it became available;
 * features are computed from a view that refuses anything later than `asOf`.
 */
import type { PriceBar } from "@/lib/domain/types";
import { dailyLogReturnsPct, indexAtOrBefore, lastBarAtOrBefore, logReturnPct } from "./returns";
import { olsSlope, std } from "./stats";

export class LeakageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeakageError";
  }
}

export interface TimedRecord {
  /** When this value became knowable (publication, filing acceptance, bar close, vintage date). */
  availableAt: string;
}

export interface MacroVintage extends TimedRecord {
  indicator: string;
  period: string;
  value: number;
}

export interface ConsensusRecord extends TimedRecord {
  indicator: string;
  period: string;
  value: number;
  unit: string;
  source: string;
}

/**
 * A view over timed data as of a cutoff. Accessors filter by availability and assert that
 * nothing returned is later than the cutoff (defence in depth against caller mistakes).
 */
export class PointInTimeView {
  readonly cutoff: number;
  constructor(readonly asOf: string) {
    this.cutoff = Date.parse(asOf);
    if (!Number.isFinite(this.cutoff)) throw new Error(`Invalid asOf: ${asOf}`);
  }

  assertAvailable(rec: TimedRecord, what: string): void {
    if (Date.parse(rec.availableAt) > this.cutoff) {
      throw new LeakageError(`${what} available at ${rec.availableAt} is after asOf ${this.asOf}`);
    }
  }

  /** Bars available at the cutoff (sorted input; binary-search slice, last element asserted). */
  bars(bars: readonly PriceBar[]): PriceBar[] {
    const i = indexAtOrBefore(bars, this.cutoff);
    const out = bars.slice(0, i + 1);
    const last = out[out.length - 1];
    if (last) this.assertAvailable({ availableAt: last.t }, "bar");
    return out;
  }

  /** Latest vintage of an indicator/period known at the cutoff (ALFRED-style real-time view). */
  macroValue(vintages: readonly MacroVintage[], indicator: string, period: string): MacroVintage | null {
    const known = vintages
      .filter((v) => v.indicator === indicator && v.period === period && Date.parse(v.availableAt) <= this.cutoff)
      .sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt));
    return known.at(-1) ?? null;
  }

  consensus(records: readonly ConsensusRecord[], indicator: string, period: string): ConsensusRecord | null {
    const known = records
      .filter((r) => r.indicator === indicator && r.period === period && Date.parse(r.availableAt) <= this.cutoff)
      .sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt));
    return known.at(-1) ?? null;
  }

  records<T extends TimedRecord>(xs: readonly T[]): T[] {
    return xs.filter((x) => Date.parse(x.availableAt) <= this.cutoff);
  }
}

/** Trailing daily log-return volatility (decimal, not %) from bars available at the cutoff. */
export function trailingDailyVol(view: PointInTimeView, dailyBars: readonly PriceBar[], lookback = 60): number | null {
  const bars = view.bars(dailyBars).slice(-(lookback + 1));
  if (bars.length < Math.min(20, lookback) + 1) return null;
  const r = dailyLogReturnsPct(bars);
  const s = std(r);
  return Number.isFinite(s) ? s / 100 : null;
}

/** Past-only OLS beta of asset daily returns on benchmark daily returns. */
export function trailingBeta(
  view: PointInTimeView,
  assetBars: readonly PriceBar[],
  benchBars: readonly PriceBar[],
  lookback = 120,
): number | null {
  const a = view.bars(assetBars).slice(-(lookback + 1));
  const bIndex = new Map(view.bars(benchBars).map((b) => [b.t, b.c] as const));
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < a.length; i++) {
    const p0 = bIndex.get(a[i - 1]!.t);
    const p1 = bIndex.get(a[i]!.t);
    if (p0 === undefined || p1 === undefined) continue;
    ra.push(logReturnPct(a[i - 1]!.c, a[i]!.c));
    rb.push(logReturnPct(p0, p1));
  }
  if (ra.length < 30) return null;
  return olsSlope(rb, ra);
}

/** Raw drift over the `sessions` daily bars ending at or before the cutoff (percent). */
export function preEventDriftPct(view: PointInTimeView, dailyBars: readonly PriceBar[], sessions = 5): number | null {
  const bars = view.bars(dailyBars);
  if (bars.length < sessions + 1) return null;
  const end = bars.at(-1)!;
  const start = bars.at(-(sessions + 1))!;
  return logReturnPct(start.c, end.c);
}

/** Last price known at the cutoff, with its timestamp. */
export function priceAsOf(view: PointInTimeView, bars: readonly PriceBar[]): { price: number; at: string } | null {
  const b = lastBarAtOrBefore(view.bars(bars), new Date(view.cutoff));
  return b ? { price: b.c, at: b.t } : null;
}

export type SurpriseBucket = "pos_large" | "pos" | "flat" | "neg" | "neg_large" | "na";

export function surpriseBucket(z: number | null): SurpriseBucket {
  if (z === null || !Number.isFinite(z)) return "na";
  if (z >= 1.5) return "pos_large";
  if (z >= 0.5) return "pos";
  if (z > -0.5) return "flat";
  if (z > -1.5) return "neg";
  return "neg_large";
}
