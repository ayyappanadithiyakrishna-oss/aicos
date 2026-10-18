import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { buildForecast, directionFrom, roundProbabilities, validateForecast, type ForecastContext } from "@/lib/quant/forecast";
import { trainModel, predict, type TrainingExample } from "@/lib/quant/model";
import { mulberry32, normal } from "@/lib/quant/stats";
import { DIRECTION_TONE } from "@/lib/format";
import { IntervalBar } from "@/components/impact/IntervalBar";
import type { ForecastSnapshot } from "@/lib/domain/types";

function synthModel() {
  const rng = mulberry32(42);
  const ex: TrainingExample[] = [];
  const start = Date.parse("2024-01-02T15:00:00Z");
  for (let i = 0; i < 1600; i++) {
    const pos = i % 2 === 0;
    const y = (pos ? 0.8 : -0.8) + normal(rng);
    const at = new Date(start + i * 12 * 3_600_000).toISOString();
    ex.push({ eventId: `e${i}`, securityId: "s", at, horizon: "next_session", path: ["t.x", `t.x|direct:${pos ? "positive" : "negative"}`, `t.x|direct:${pos ? "positive" : "negative"}|large`], sigmaHPct: 2, arPct: y * 2, overlapping: false, sector: "x", eventKind: "t", regime: "normal" });
  }
  return trainModel(ex, { version: "test", trainedAt: "2026-01-01T00:00:00Z", trainingCutoff: "2025-06-01T00:00:00Z", calibrationEnd: "2026-01-01T00:00:00Z", isSynthetic: true, horizons: ["next_session"] });
}

const MODEL = synthModel();

const ctx = (o: Partial<ForecastContext> = {}): ForecastContext => ({
  eventId: "ev",
  securityId: "s",
  ticker: "TST",
  horizon: "next_session",
  forecastGeneratedAt: "2026-10-14T18:32:00Z",
  asOf: "2026-10-14T18:32:00Z",
  path: ["t.x", "t.x|direct:positive", "t.x|direct:positive|large"],
  sigmaHPct: 2,
  baseline: { price: 100, at: "2026-10-14T18:30:00Z" },
  mechanismSign: "positive",
  exposureVerified: true,
  numericFactsVerified: true,
  sourceConflict: false,
  providerStale: false,
  overlapping: false,
  provenance: ["synthetic"],
  invalidationConditions: [],
  isSynthetic: true,
  ...o,
});

describe("forecast direction labels", () => {
  it("maps opposite-signed estimates to bullish (green) and bearish (red)", () => {
    const up = buildForecast(ctx(), MODEL);
    const down = buildForecast(ctx({ path: ["t.x", "t.x|direct:negative", "t.x|direct:negative|large"], mechanismSign: "negative" }), MODEL);
    expect(up.centralMovePct!).toBeGreaterThan(0);
    expect(down.centralMovePct!).toBeLessThan(0);
    expect(up.direction).toBe("bullish");
    expect(down.direction).toBe("bearish");
    expect(DIRECTION_TONE[up.direction]).toBe("pos");
    expect(DIRECTION_TONE[down.direction]).toBe("neg");
  });

  it("inside the neutral band the label is 'no material edge', never bullish/bearish", () => {
    expect(directionFrom("evaluated", 0.3, 0.5, "positive", true)).toBe("no_edge");
    expect(directionFrom("evaluated", -0.3, 0.5, "negative", true)).toBe("no_edge");
  });

  it("renders an interval that crosses zero as two-sided (green and coral) with an honest label", () => {
    const html = renderToStaticMarkup(createElement(IntervalBar, { central: -0.7, lo: -1.9, hi: 0.5, band: 0.4, direction: "bearish" }));
    expect(html).toContain("interval crosses zero");
    expect(html).toContain('fill="var(--neg)"');
    expect(html).toContain('fill="var(--pos)"');
  });

  it("renders an abstention as an empty dashed track with no tick", () => {
    const html = renderToStaticMarkup(createElement(IntervalBar, { central: null, lo: null, hi: null, band: null, direction: "insufficient" }));
    expect(html).toContain("no calibrated interval available");
    expect(html).toContain("stroke-dasharray");
  });
});

describe("abstention: no numbers without data, calibration or evidence", () => {
  const cases: Array<[string, Partial<ForecastContext>, string]> = [
    ["missing price history", { sigmaHPct: null }, "NO_PRICE_HISTORY"],
    ["missing baseline price", { baseline: null }, "NO_BASELINE_PRICE"],
    ["unverified numeric facts", { numericFactsVerified: false }, "UNVERIFIED_NUMERIC_FACTS"],
    ["doubtful symbol mapping", { exposureVerified: false }, "SYMBOL_MAPPING_DOUBT"],
    ["stale provider", { providerStale: true }, "STALE_PROVIDER"],
    ["source conflict", { sourceConflict: true }, "SOURCE_CONFLICT"],
    ["no comparable history", { path: ["unknown.kind", "unknown.kind|x:y", "unknown.kind|x:y|z"] }, "NO_COMPARABLE_HISTORY"],
  ];
  for (const [name, o, code] of cases) {
    it(`withholds central, interval and probabilities when ${name}`, () => {
      const f = buildForecast(ctx(o), MODEL);
      expect(f.centralMovePct).toBeNull();
      expect(f.intervalLowPct).toBeNull();
      expect(f.intervalHighPct).toBeNull();
      expect(f.probabilities).toBeNull();
      expect(["insufficient", "direction_only"]).toContain(f.qualityTier);
      expect(f.reasonCodes).toContain(code);
    });
  }

  it("withholds everything when no trained model exists", () => {
    const f = buildForecast(ctx(), null);
    expect(f.reasonCodes).toContain("NO_TRAINED_MODEL");
    expect(f.centralMovePct).toBeNull();
  });

  it("validation rejects an abstaining forecast that carries numbers", () => {
    const f = buildForecast(ctx({ sigmaHPct: null }), MODEL);
    const tampered = { ...f, centralMovePct: 1.2 } as ForecastSnapshot;
    expect(validateForecast(tampered)).toContain("abstaining forecast carries numbers");
  });

  it("validation rejects look-ahead baselines and impossible magnitudes", () => {
    const f = buildForecast(ctx(), MODEL);
    expect(validateForecast({ ...f, baselinePriceTime: "2026-10-14T19:00:00Z" })).toContain("baseline price after asOf (look-ahead)");
    expect(validateForecast({ ...f, centralMovePct: 80, intervalLowPct: 70, intervalHighPct: 90 }).some((e) => e.includes("exceeds"))).toBe(true);
    expect(validateForecast({ ...f, intervalLowPct: 2, intervalHighPct: 1 })).toContain("interval low > high");
  });

  it("suppresses the point estimate when it is drowned by normal volatility", () => {
    const f = buildForecast(ctx({ path: ["t.x"] }), MODEL);
    // Subtype-only pooling mixes signs; never a numeric estimate.
    expect(f.centralMovePct).toBeNull();
  });
});

describe("probabilities", () => {
  it("are bounded and sum to 1 within tolerance whenever shown", () => {
    const hm = MODEL.horizons.next_session!;
    expect(hm.calibrated).toBe(true);
    for (const sign of ["positive", "negative"]) {
      for (const mag of ["large", "small"]) {
        const p = predict(hm, ["t.x", `t.x|direct:${sign}`, `t.x|direct:${sign}|${mag}`], 2).probabilities!;
        for (const v of [p.up, p.down, p.neutral]) {
          expect(v).toBeGreaterThanOrEqual(0.02 - 1e-9);
          expect(v).toBeLessThanOrEqual(1);
        }
        expect(Math.abs(p.up + p.down + p.neutral - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it("rounding to whole percents preserves the unit sum", () => {
    const r = roundProbabilities({ up: 0.3333, down: 0.3333, neutral: 0.3334 });
    expect(Math.round((r.up + r.down + r.neutral) * 100)).toBe(100);
  });

  it("only calibrated forecasts may carry probabilities", () => {
    const f = buildForecast(ctx(), MODEL);
    const bad = { ...f, qualityTier: "evaluated" as const, probabilities: { up: 0.5, down: 0.3, neutral: 0.2 } };
    expect(validateForecast(bad)).toContain("probabilities present on uncalibrated forecast");
    expect(validateForecast({ ...f, qualityTier: "calibrated", probabilities: { up: 0.5, down: 0.4, neutral: 0.3 } })).toContain("probabilities do not sum to 1");
  });
});
