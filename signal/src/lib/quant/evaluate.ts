/**
 * Model scorecard. Every metric reports its sample count; below the configurable threshold the
 * value is withheld ("insufficient sample") rather than shown as a misleading percentage.
 */
import type { Direction, Horizon, Probabilities } from "@/lib/domain/types";
import { brierMulticlass, logLossMulticlass, reliabilityBins, type ClassKey } from "./calibration";
import { bootstrapCI, mean } from "./stats";

export const DEFAULT_MIN_SAMPLE = 30;

export interface ScoredRow {
  forecastId: string;
  at: string;
  horizon: Horizon;
  sample: "oos" | "in_sample";
  sector: string;
  eventKind: string;
  regime: string;
  direction: Direction;
  central: number | null;
  lo: number | null;
  hi: number | null;
  probabilities: Probabilities | null;
  realizedAr: number;
  outcome: ClassKey;
  /** Baseline predictions of AR (percent). */
  baselines: { zero: number; eventPrior: number; marketBeta: number };
  /** Realized raw return, used for the market-beta baseline. */
  realizedRaw: number;
}

export interface Metric {
  value: number | null;
  n: number;
  ci: [number, number] | null;
  insufficient: boolean;
}

export interface SliceMetrics {
  key: string;
  n: number;
  directionalAccuracy: Metric;
  bullishHitRate: Metric;
  bearishHitRate: Metric;
  brier: Metric;
  brierClimatology: Metric;
  logLoss: Metric;
  coverage80: Metric;
  mae: Metric;
  bias: Metric;
  maeZero: Metric;
  maeEventPrior: Metric;
  maeMarketBeta: Metric;
  confusion: Record<ClassKey, Record<ClassKey, number>>;
  reliability: ReturnType<typeof reliabilityBins> | null;
}

const predictedClass = (d: Direction): ClassKey | null =>
  d === "bullish" ? "up" : d === "bearish" ? "down" : d === "no_edge" ? "neutral" : null;

function metric(values: number[], minN: number, seed: number, stat: (xs: readonly number[]) => number = mean): Metric {
  const n = values.length;
  if (n < minN) return { value: null, n, ci: null, insufficient: true };
  return { value: stat(values), n, ci: bootstrapCI(values, stat, { seed }), insufficient: false };
}

export function sliceMetrics(
  key: string,
  rows: readonly ScoredRow[],
  climatology: Record<ClassKey, number>,
  minN = DEFAULT_MIN_SAMPLE,
): SliceMetrics {
  const dirRows = rows.filter((r) => predictedClass(r.direction) !== null);
  const hits = dirRows.map((r) => (predictedClass(r.direction) === r.outcome ? 1 : 0));
  const bull = rows.filter((r) => r.direction === "bullish").map((r) => (r.outcome === "up" ? 1 : 0));
  const bear = rows.filter((r) => r.direction === "bearish").map((r) => (r.outcome === "down" ? 1 : 0));

  const probRows = rows.filter((r) => r.probabilities) as Array<ScoredRow & { probabilities: Probabilities }>;
  const brierPer = probRows.map((r) => brierMulticlass([{ p: r.probabilities, y: r.outcome }])!);
  const climPer = probRows.map((r) => brierMulticlass([{ p: climatology, y: r.outcome }])!);
  const llPer = probRows.map((r) => logLossMulticlass([{ p: r.probabilities, y: r.outcome }])!);

  const intRows = rows.filter((r) => r.lo !== null && r.hi !== null);
  const cover = intRows.map((r) => (r.realizedAr >= r.lo! && r.realizedAr <= r.hi! ? 1 : 0));

  const cRows = rows.filter((r) => r.central !== null);
  const absErr = cRows.map((r) => Math.abs(r.central! - r.realizedAr));
  const err = cRows.map((r) => r.central! - r.realizedAr);
  const absZero = cRows.map((r) => Math.abs(r.baselines.zero - r.realizedAr));
  const absPrior = cRows.map((r) => Math.abs(r.baselines.eventPrior - r.realizedAr));
  const absBeta = cRows.map((r) => Math.abs(r.baselines.marketBeta - r.realizedRaw));

  const confusion = {
    up: { up: 0, down: 0, neutral: 0 },
    down: { up: 0, down: 0, neutral: 0 },
    neutral: { up: 0, down: 0, neutral: 0 },
  } as Record<ClassKey, Record<ClassKey, number>>;
  for (const r of dirRows) confusion[predictedClass(r.direction)!][r.outcome] += 1;

  const seed = key.length * 31 + rows.length;
  return {
    key,
    n: rows.length,
    directionalAccuracy: metric(hits, minN, seed + 1),
    bullishHitRate: metric(bull, minN, seed + 2),
    bearishHitRate: metric(bear, minN, seed + 3),
    brier: metric(brierPer, minN, seed + 4),
    brierClimatology: metric(climPer, minN, seed + 5),
    logLoss: metric(llPer, minN, seed + 6),
    coverage80: metric(cover, minN, seed + 7),
    mae: metric(absErr, minN, seed + 8),
    bias: metric(err, minN, seed + 9),
    maeZero: metric(absZero, minN, seed + 10),
    maeEventPrior: metric(absPrior, minN, seed + 11),
    maeMarketBeta: metric(absBeta, minN, seed + 12),
    confusion,
    reliability:
      probRows.length >= minN
        ? reliabilityBins(
            probRows.map((r) => r.probabilities.up),
            probRows.map((r) => (r.outcome === "up" ? 1 : 0)),
          )
        : null,
  };
}

export interface Scorecard {
  minSample: number;
  generatedAt: string;
  range: { from: string | null; to: string | null };
  climatology: Record<ClassKey, number>;
  oos: SliceMetrics;
  inSample: SliceMetrics;
  byHorizon: SliceMetrics[];
  bySector: SliceMetrics[];
  byEventKind: SliceMetrics[];
  byRegime: SliceMetrics[];
  counts: { total: number; oos: number; inSample: number; withProbabilities: number; withInterval: number };
}

function groupBy<T>(xs: readonly T[], f: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = f(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export function buildScorecard(
  rows: readonly ScoredRow[],
  opts: { climatology: Record<ClassKey, number>; minSample?: number; from?: string; to?: string; generatedAt: string },
): Scorecard {
  const minN = opts.minSample ?? DEFAULT_MIN_SAMPLE;
  const inRange = rows.filter(
    (r) => (!opts.from || r.at >= opts.from) && (!opts.to || r.at <= opts.to),
  );
  const oos = inRange.filter((r) => r.sample === "oos");
  const ins = inRange.filter((r) => r.sample === "in_sample");
  const slices = (f: (r: ScoredRow) => string) =>
    [...groupBy(oos, f).entries()]
      .map(([k, v]) => sliceMetrics(k, v, opts.climatology, minN))
      .sort((a, b) => b.n - a.n);
  return {
    minSample: minN,
    generatedAt: opts.generatedAt,
    range: { from: opts.from ?? null, to: opts.to ?? null },
    climatology: opts.climatology,
    oos: sliceMetrics("out-of-sample", oos, opts.climatology, minN),
    inSample: sliceMetrics("in-sample", ins, opts.climatology, minN),
    byHorizon: slices((r) => r.horizon),
    bySector: slices((r) => r.sector),
    byEventKind: slices((r) => r.eventKind),
    byRegime: slices((r) => r.regime),
    counts: {
      total: inRange.length,
      oos: oos.length,
      inSample: ins.length,
      withProbabilities: oos.filter((r) => r.probabilities).length,
      withInterval: oos.filter((r) => r.lo !== null).length,
    },
  };
}
