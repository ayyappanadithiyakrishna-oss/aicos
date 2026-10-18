import { describe, expect, it } from "vitest";
import { fitHierarchicalPrior, predictPrior, selectLambda } from "@/lib/quant/priors";
import { conformalInterval, empiricalCoverage, fitConformal } from "@/lib/quant/intervals";
import { brierMulticlass, fitIsotonic, logLossMulticlass, predictIsotonic, fitPlatt, predictPlatt } from "@/lib/quant/calibration";
import { abnormalReturnPct, adjustForSplits, logReturnPct } from "@/lib/quant/returns";
import { impliedMoveFromIv, impliedMoveFromStraddle } from "@/lib/quant/options";
import { pricedIn } from "@/lib/quant/pricedIn";
import { resolveForecast } from "@/lib/quant/resolve";
import { mulberry32, normal, quantile } from "@/lib/quant/stats";
import { relevance } from "@/lib/analysis/ranking";
import type { ForecastSnapshot, PriceBar } from "@/lib/domain/types";

describe("hierarchical shrinkage prior", () => {
  it("implements mu_post = w·mu_group + (1−w)·mu_parent with w = n/(n+λ)", () => {
    const obs = [
      ...Array.from({ length: 4 }, () => ({ path: ["a", "a|b"], y: 2 })),
      ...Array.from({ length: 16 }, () => ({ path: ["a", "a|c"], y: 0 })),
    ];
    const p = fitHierarchicalPrior(obs, 4);
    const pred = predictPrior(p, ["a", "a|b"], 1);
    const muA = (20 / 24) * 0.4 + (4 / 24) * 0.4; // level a: mean 0.4 (8/20), global mean 0.4
    const wB = 4 / (4 + 4);
    expect(pred.mu).toBeCloseTo(wB * 2 + (1 - wB) * muA, 10);
    expect(pred.nEff).toBe(4);
  });

  it("backs off sparse levels to the parent", () => {
    const p = fitHierarchicalPrior([{ path: ["a", "a|rare"], y: 9 }, ...Array.from({ length: 30 }, () => ({ path: ["a", "a|x"], y: 0 }))], 5);
    const pred = predictPrior(p, ["a", "a|rare"], 8);
    expect(pred.depth).toBe(1);
  });

  it("chooses λ on validation data from a fixed grid", () => {
    const rng = mulberry32(1);
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ path: ["g", `g|${i % 5}`], y: (i % 5) * 0.2 + normal(rng) }));
    const r = selectLambda(mk(400), mk(200));
    expect([1, 2, 5, 10, 20, 50, 100]).toContain(r.lambda);
  });
});

describe("conformal intervals", () => {
  it("achieve close to nominal 80% coverage out of sample", () => {
    const rng = mulberry32(9);
    const cal = fitConformal(Array.from({ length: 2000 }, () => normal(rng)), 0.8)!;
    const test = Array.from({ length: 4000 }, () => normal(rng)).map((y) => {
      const [lo, hi] = conformalInterval(0, cal);
      return { lo, hi, y };
    });
    expect(empiricalCoverage(test)!).toBeGreaterThan(0.77);
    expect(empiricalCoverage(test)!).toBeLessThan(0.84);
  });
  it("refuses to calibrate on tiny samples", () => {
    expect(fitConformal([1, 2, 3], 0.8)).toBeNull();
  });
});

describe("calibration and scoring", () => {
  it("isotonic regression is monotone non-decreasing", () => {
    const rng = mulberry32(3);
    const x = Array.from({ length: 300 }, () => rng());
    const y = x.map((v) => (rng() < v ? 1 : 0));
    const m = fitIsotonic(x, y);
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.01) {
      const v = predictIsotonic(m, t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });
  it("Platt scaling recovers a monotone mapping", () => {
    const s = [-2, -1, 0, 1, 2, -2, -1, 0, 1, 2];
    const l = [0, 0, 0, 1, 1, 0, 0, 1, 1, 1];
    const m = fitPlatt(s, l);
    expect(predictPlatt(m, 2)).toBeGreaterThan(predictPlatt(m, -2));
  });
  it("Brier and log loss match hand computations", () => {
    const rows = [{ p: { up: 0.7, down: 0.2, neutral: 0.1 }, y: "up" as const }];
    expect(brierMulticlass(rows)!).toBeCloseTo(0.09 + 0.04 + 0.01, 10);
    expect(logLossMulticlass(rows)!).toBeCloseTo(-Math.log(0.7), 10);
  });
});

describe("returns and windows", () => {
  it("computes log and abnormal returns", () => {
    expect(logReturnPct(100, 110)).toBeCloseTo(100 * Math.log(1.1), 10);
    expect(abnormalReturnPct(3, 1, 1.5)).toBeCloseTo(1.5, 10);
  });
  it("split-adjusts pre-split prices", () => {
    const bars: PriceBar[] = [{ t: "2026-01-02T21:00:00Z", o: 200, h: 200, l: 200, c: 200, v: 1 }, { t: "2026-01-05T21:00:00Z", o: 100, h: 100, l: 100, c: 100, v: 2 }];
    expect(adjustForSplits(bars, [{ effective: "2026-01-05T14:30:00Z", ratio: 2 }])[0]!.c).toBe(100);
  });
  it("resolves a matured forecast into a separate realization with the abnormal return", () => {
    const f = { id: "fc1", horizon: "next_session", target: "abnormal" } as ForecastSnapshot;
    const asset: PriceBar[] = [
      { t: "2026-10-13T20:00:00Z", o: 1, h: 1, l: 1, c: 100, v: 1 },
      { t: "2026-10-14T20:00:00Z", o: 1, h: 1, l: 1, c: 104, v: 1 },
    ];
    const bench: PriceBar[] = [
      { t: "2026-10-13T20:00:00Z", o: 1, h: 1, l: 1, c: 50, v: 1 },
      { t: "2026-10-14T20:00:00Z", o: 1, h: 1, l: 1, c: 50.5, v: 1 },
    ];
    const r = resolveForecast({ forecast: f, publishedAt: "2026-10-14T12:30:00Z", assetBars: asset, benchmarkBars: bench, beta: 1.2, sigmaHPct: 2, now: new Date("2026-10-15T00:00:00Z") });
    expect(r.status).toBe("resolved");
    expect(r.abnormalReturnPct!).toBeCloseTo(logReturnPct(100, 104) - 1.2 * logReturnPct(50, 50.5), 10);
    expect(r.outcomeClass).toBe("up");
    const early = resolveForecast({ forecast: f, publishedAt: "2026-10-14T12:30:00Z", assetBars: asset, benchmarkBars: bench, beta: 1, sigmaHPct: 2, now: new Date("2026-10-14T19:00:00Z") });
    expect(early.status).toBe("pending");
  });
  it("records a failure instead of fabricating when bars are missing", () => {
    const r = resolveForecast({ forecast: { id: "x", horizon: "next_session", target: "abnormal" } as ForecastSnapshot, publishedAt: "2026-10-14T12:30:00Z", assetBars: [], benchmarkBars: [], beta: 1, sigmaHPct: 1, now: new Date("2026-10-20T00:00:00Z") });
    expect(r.status).toBe("failed");
    expect(r.abnormalReturnPct).toBeNull();
  });
});

describe("options-implied move is a separate, gated quantity", () => {
  const now = new Date("2026-10-14T18:30:00Z");
  it("uses S·σ·√(d/252) only with entitled, fresh IV", () => {
    const m = impliedMoveFromIv({ spot: 100, ivAnnual: 0.32, tradingDays: 1, ivAsOf: "2026-10-14T18:25:00Z", expiry: "2026-10-16", source: "x", entitled: true }, now);
    expect(m.available && m.moveAbs).toBeCloseTo(100 * 0.32 * Math.sqrt(1 / 252), 10);
    expect(impliedMoveFromIv(null, now).available).toBe(false);
    expect(impliedMoveFromIv({ spot: 100, ivAnnual: 0.32, tradingDays: 1, ivAsOf: "2026-10-14T10:00:00Z", expiry: "x", source: "x", entitled: true }, now).available).toBe(false);
    expect(impliedMoveFromIv({ spot: 100, ivAnnual: 0.32, tradingDays: 1, ivAsOf: "2026-10-14T18:25:00Z", expiry: "x", source: "x", entitled: false }, now).available).toBe(false);
  });
  it("straddle approximation documents its conventions", () => {
    const m = impliedMoveFromStraddle({ spot: 100, callMid: 2, putMid: 2, multiplier: 100, asOf: "2026-10-14T18:29:00Z", expiry: "2026-10-16", source: "x", entitled: true }, now);
    expect(m.available && m.movePct).toBeCloseTo(3.2, 10);
    expect(m.available && m.assumptions.join(" ")).toContain("not a direction forecast");
  });
});

describe("priced-in meter", () => {
  it("is unknown without quotes rather than an invented percentage", () => {
    const p = pricedIn({ securityId: "s", ticker: "S", publishedAt: "2026-10-14T13:00:00Z", analysisAt: "2026-10-14T18:30:00Z", dailyBars: null, intradayBars: null });
    expect(p.status).toBe("unknown");
    expect(p.remainingPct).toBeNull();
    expect(p.note).toMatch(/Unknown/);
  });
});

describe("ranking", () => {
  it("caps extreme predicted moves so wild calls cannot dominate", () => {
    const mk = (central: number, quality: number) =>
      relevance(
        {
          exposures: [{ securityId: "a", ticker: "A", directness: "direct" } as never],
          novelty: { score: 1 } as never,
          quality: { score: quality } as never,
          firstPublishedAt: "2026-10-14T18:00:00Z",
          forecasts: [{ centralMovePct: central, neutralBandPct: 0.5 } as never],
          macro: null,
          earnings: null,
          severity: "medium",
        },
        { now: new Date("2026-10-14T18:30:00Z") },
      ).score;
    expect(mk(30, 50) - mk(3, 50)).toBeLessThan(0.01);
    expect(mk(1, 95)).toBeGreaterThan(mk(30, 40));
  });
});

describe("stats", () => {
  it("quantile uses linear interpolation", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});
