/**
 * Forecast resolution at maturity. Uses the same calendar-aware window as forecasting and
 * stores a separate realization record; the forecast itself is never modified.
 */
import type { ForecastRealization, ForecastSnapshot, PriceBar } from "@/lib/domain/types";
import { horizonWindow } from "@/lib/calendar/horizons";
import { abnormalReturnPct, adjustForSplits, lastBarAtOrBefore, logReturnPct } from "./returns";
import { classOf } from "./model";
import { hashHex } from "./stats";

export interface ResolveInputs {
  forecast: ForecastSnapshot;
  publishedAt: string;
  assetBars: readonly PriceBar[];
  benchmarkBars: readonly PriceBar[] | null;
  beta: number | null;
  /** Horizon σ in percent (past-only) for outcome classification. */
  sigmaHPct: number | null;
  now: Date;
  splits?: ReadonlyArray<{ effective: string; ratio: number }>;
  overlapping?: boolean;
  /** Max allowed gap between the target time and the bar used, in minutes. */
  maxStalenessMinutes?: number;
}

export function resolveForecast(inp: ResolveInputs): ForecastRealization {
  const f = inp.forecast;
  const id = `rz_${hashHex(`${f.id}|realization`)}`;
  const base: ForecastRealization = {
    id,
    forecastId: f.id,
    status: "pending",
    windowStart: null,
    windowEnd: null,
    rawReturnPct: null,
    benchmarkReturnPct: null,
    abnormalReturnPct: null,
    betaUsed: null,
    outcomeClass: null,
    resolvedAt: null,
    quality: null,
    failureReason: null,
  };
  const w = horizonWindow(new Date(inp.publishedAt), f.horizon);
  base.windowStart = w.start.toISOString();
  base.windowEnd = w.end.toISOString();
  if (inp.now.getTime() < w.end.getTime()) return base;

  const splitsInWindow = (inp.splits ?? []).filter(
    (s) => Date.parse(s.effective) > w.start.getTime() && Date.parse(s.effective) <= w.end.getTime(),
  );
  const bars = inp.splits?.length ? adjustForSplits(inp.assetBars, inp.splits) : inp.assetBars;
  const maxGap = (inp.maxStalenessMinutes ?? (f.horizon === "1h" ? 61 : 60 * 24 * 4)) * 60000;

  const p0 = lastBarAtOrBefore(bars, w.start);
  const p1 = lastBarAtOrBefore(bars, w.end);
  if (!p0 || !p1) return { ...base, status: "failed", failureReason: "Missing price bars for window", resolvedAt: inp.now.toISOString(), quality: "data_gap" };
  if (w.end.getTime() - Date.parse(p1.t) > maxGap || w.start.getTime() - Date.parse(p0.t) > maxGap) {
    return { ...base, status: "failed", failureReason: "Bars too stale at window boundary", resolvedAt: inp.now.toISOString(), quality: "data_gap" };
  }
  if (p0.t === p1.t) {
    return { ...base, status: "failed", failureReason: "No bar inside the event window", resolvedAt: inp.now.toISOString(), quality: "data_gap" };
  }
  const raw = logReturnPct(p0.c, p1.c);
  let bench: number | null = null;
  if (inp.benchmarkBars) {
    const b0 = lastBarAtOrBefore(inp.benchmarkBars, w.start);
    const b1 = lastBarAtOrBefore(inp.benchmarkBars, w.end);
    if (b0 && b1 && b0.t !== b1.t) bench = logReturnPct(b0.c, b1.c);
  }
  if (f.target === "abnormal" && (bench === null || inp.beta === null)) {
    return {
      ...base,
      status: "not_resolvable",
      rawReturnPct: raw,
      failureReason: "Abnormal return needs benchmark bars and a past-only beta",
      resolvedAt: inp.now.toISOString(),
      quality: "data_gap",
    };
  }
  const ar = f.target === "abnormal" ? abnormalReturnPct(raw, bench!, inp.beta!) : raw;
  return {
    ...base,
    status: "resolved",
    rawReturnPct: raw,
    benchmarkReturnPct: bench,
    abnormalReturnPct: ar,
    betaUsed: inp.beta,
    outcomeClass: inp.sigmaHPct ? classOf(ar / inp.sigmaHPct) : null,
    resolvedAt: inp.now.toISOString(),
    quality: inp.overlapping ? "overlapping_event" : splitsInWindow.length ? "corporate_action_adjusted" : "clean",
  };
}
