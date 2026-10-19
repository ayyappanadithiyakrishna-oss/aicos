import { describe, expect, it } from "vitest";
import { trainHorizonModel, type TrainingExample } from "@/lib/quant/model";
import { mulberry32, normal } from "@/lib/quant/stats";

function history(): TrainingExample[] {
  const rng = mulberry32(91);
  return Array.from({ length: 2400 }, (_, i) => ({
    eventId: `e${i}`, securityId: "s", at: new Date(Date.UTC(2020, 0, 1) + i * 86400_000).toISOString(),
    windowEnd: new Date(Date.UTC(2020, 0, 2) + i * 86400_000).toISOString(), horizon: "next_session" as const,
    path: ["x", "x|positive"], sigmaHPct: 1, arPct: 0.5 + normal(rng), overlapping: false, sector: "Tech", eventKind: "x", regime: "normal",
  }));
}

describe("independent probability validation", () => {
  const cut = "2024-01-01T00:00:00Z";
  const end = "2027-01-01T00:00:00Z";
  it("keeps an untouched chronological holdout and purges outcomes crossing the training boundary", () => {
    const xs = history();
    const original = trainHorizonModel(xs, "next_session", cut, end)!;
    const crossing = xs.filter((e) => e.at < cut).slice(-20).map((e) => ({ ...e, eventId: `${e.eventId}late`, windowEnd: end, arPct: 999 }));
    const candidate = trainHorizonModel([...xs, ...crossing], "next_session", cut, end)!;
    expect(candidate.trainN).toBe(original.trainN);
    expect(candidate.prior).toEqual(original.prior);
    expect(candidate.validation?.method).toBe("chronological-held-out-v1");
    expect(candidate.validation!.n).toBeGreaterThan(30);
  });
  it("withholds the calibrated label when future holdout reactions shift sharply", () => {
    const xs = history();
    const m = trainHorizonModel(xs, "next_session", cut, end)!;
    const changed = xs.map((e) => e.at >= m.validation!.from ? { ...e, arPct: 15 } : e);
    const bad = trainHorizonModel(changed, "next_session", cut, end)!;
    expect(bad.calibrated).toBe(false);
    expect(bad.calibrationCoverage).toBe(0);
    // The fitted residual and probability sets stay unchanged: holdout is used for checking only.
    expect(bad.residualsA).toEqual(m.residualsA);
    expect(bad.isotonic).toEqual(m.isotonic);
  });
});
