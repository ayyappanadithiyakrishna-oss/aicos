import { describe, expect, it } from "vitest";
import { LeakageError, PointInTimeView, preEventDriftPct, priceAsOf, trailingBeta, trailingDailyVol } from "@/lib/quant/features";
import type { PriceBar } from "@/lib/domain/types";
import { mulberry32, normal } from "@/lib/quant/stats";

function bars(n: number, seed: number, startMs = Date.parse("2026-01-02T21:00:00Z")): PriceBar[] {
  const rng = mulberry32(seed);
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    p *= Math.exp(0.01 * normal(rng));
    return { t: new Date(startMs + i * 86_400_000).toISOString(), o: p, h: p, l: p, c: p, v: 1 };
  });
}

describe("as-of feature cutoff", () => {
  const asset = bars(300, 1);
  const bench = bars(300, 2);
  const cutoff = asset[200]!.t;

  it("returns only bars available at the cutoff", () => {
    const v = new PointInTimeView(cutoff);
    expect(v.bars(asset).every((b) => Date.parse(b.t) <= Date.parse(cutoff))).toBe(true);
    expect(v.bars(asset)).toHaveLength(201);
  });

  it("features are unchanged when future data is appended (no look-ahead)", () => {
    const v = new PointInTimeView(cutoff);
    const shocked = [...asset.slice(0, 201), ...asset.slice(201).map((b) => ({ ...b, c: b.c * 3 }))];
    expect(trailingDailyVol(v, shocked)).toBe(trailingDailyVol(v, asset));
    expect(trailingBeta(v, shocked, bench)).toBe(trailingBeta(v, asset, bench));
    expect(preEventDriftPct(v, shocked)).toBe(preEventDriftPct(v, asset));
    expect(priceAsOf(v, shocked)!.price).toBe(asset[200]!.c);
  });

  it("throws LeakageError when a later record is asserted available", () => {
    const v = new PointInTimeView(cutoff);
    expect(() => v.assertAvailable({ availableAt: asset[250]!.t }, "earnings revision")).toThrow(LeakageError);
  });

  it("uses the macro vintage known at the cutoff, not a later revision", () => {
    const v = new PointInTimeView("2026-09-15T12:00:00Z");
    const vintages = [
      { indicator: "PAYEMS", period: "2026-08", value: 142, availableAt: "2026-09-04T12:30:00Z" },
      { indicator: "PAYEMS", period: "2026-08", value: 159, availableAt: "2026-10-09T12:30:00Z" },
    ];
    expect(v.macroValue(vintages, "PAYEMS", "2026-08")!.value).toBe(142);
    expect(new PointInTimeView("2026-10-10T00:00:00Z").macroValue(vintages, "PAYEMS", "2026-08")!.value).toBe(159);
  });

  it("uses the consensus known before the release only", () => {
    const v = new PointInTimeView("2026-10-14T12:29:00Z");
    const recs = [
      { indicator: "CPI", period: "2026-09", value: 3.0, unit: "%", source: "P", availableAt: "2026-10-01T00:00:00Z" },
      { indicator: "CPI", period: "2026-09", value: 3.1, unit: "%", source: "P", availableAt: "2026-10-13T00:00:00Z" },
      { indicator: "CPI", period: "2026-09", value: 3.4, unit: "%", source: "P", availableAt: "2026-10-14T13:00:00Z" },
    ];
    expect(v.consensus(recs, "CPI", "2026-09")!.value).toBe(3.1);
  });
});
