import { describe, expect, it } from "vitest";
import { getDemoWorld } from "@/lib/demo/world";
import { validateForecast } from "@/lib/quant/forecast";
import { checkBottomLine } from "@/lib/analysis/editorial";
import { toCard } from "@/lib/data/cards";

describe("demo world end-to-end integrity", () => {
  it("builds a complete, labelled synthetic world through the real pipeline", async () => {
    const w = await getDemoWorld();
    expect(w.events.length).toBeGreaterThanOrEqual(20);
    expect(w.events.every((e) => e.isSynthetic)).toBe(true);
    expect(w.pipeline.deadLetters).toHaveLength(0);
    expect(w.model.isSynthetic).toBe(true);
  });

  it("every forecast passes coherence validation and respects its as-of cutoff", async () => {
    const w = await getDemoWorld();
    for (const e of w.events) for (const f of e.forecasts) {
      expect(validateForecast(f)).toEqual([]);
      if (f.baselinePriceTime) expect(Date.parse(f.baselinePriceTime)).toBeLessThanOrEqual(Date.parse(f.asOf));
      expect(Date.parse(f.asOf)).toBeLessThanOrEqual(w.anchor.getTime());
    }
  });

  it("every exposure and fact cites evidence that exists on the event", async () => {
    const w = await getDemoWorld();
    for (const e of w.events) {
      const ids = new Set(e.evidence.map((x) => x.id));
      for (const x of e.exposures) {
        expect(x.evidenceIds.length).toBeGreaterThan(0);
        for (const id of x.evidenceIds) expect(ids.has(id)).toBe(true);
      }
      for (const f of e.verifiedFacts) expect(ids.has(f.evidenceId)).toBe(true);
      for (const edge of e.graph.edges) for (const id of edge.evidenceIds) expect(ids.has(id)).toBe(true);
    }
  });

  it("bottom lines satisfy editorial rules (15–25 words, no numbers, no advice)", async () => {
    const w = await getDemoWorld();
    for (const e of w.events) expect(checkBottomLine(e.bottomLine).issues).toEqual([]);
  });

  it("quarantines the provider-tagged fake symbol and ignores the injected instruction", async () => {
    const w = await getDemoWorld();
    expect(w.pipeline.quarantined.map((q) => q.symbol)).toContain("ZZZQ");
    const brkt = w.events.find((e) => e.originalTitle.includes("reaffirms"))!;
    expect(brkt.limitations.join(" ")).toMatch(/instruction-like content/);
    expect(brkt.bottomLine.toLowerCase()).not.toContain("buy");
  });

  it("abstains on the unverified single-source numeric claim and on conflicting sources", async () => {
    const w = await getDemoWorld();
    const rumor = w.events.find((e) => e.originalTitle.includes("Novaline"))!;
    expect(rumor.forecasts.every((f) => f.centralMovePct === null && f.qualityTier === "insufficient")).toBe(true);
    const conflict = w.events.find((e) => e.originalTitle.includes("Quantum Logic preliminary"))!;
    expect(conflict.forecasts.every((f) => f.centralMovePct === null)).toBe(true);
    expect(conflict.contradictions.some((c) => c.kind === "source_conflict")).toBe(true);
  });

  it("is deterministic", async () => {
    const a = await getDemoWorld();
    const { getDemoWorld: again } = await import("@/lib/demo/world");
    const b = await again();
    expect(b.events.map((e) => e.id)).toEqual(a.events.map((e) => e.id));
  });

  it("card projection stays small and keeps abstention reasons", async () => {
    const w = await getDemoWorld();
    const cards = w.events.map(toCard);
    expect(JSON.stringify(cards).length / cards.length).toBeLessThan(20_000);
    const abst = cards.flatMap((c) => c.exposures.flatMap((x) => Object.values(x.forecasts))).filter((f) => f!.tier === "insufficient");
    expect(abst.every((f) => f!.reasonText.length > 0)).toBe(true);
  });

  it("scorecard withholds metrics under the minimum sample and separates OOS from in-sample", async () => {
    const { demoScorecard } = await import("@/lib/demo/world");
    const w = await getDemoWorld();
    const sc = demoScorecard(w, { minSample: 1_000_000 });
    expect(sc.oos.directionalAccuracy.insufficient).toBe(true);
    expect(sc.oos.directionalAccuracy.value).toBeNull();
    const full = demoScorecard(w);
    expect(full.counts.oos).toBeGreaterThan(0);
    expect(full.counts.inSample).toBeGreaterThan(0);
  });
});
