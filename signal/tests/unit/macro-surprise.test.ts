import { describe, expect, it } from "vitest";
import { computeMacroSurprise, UnitMismatchError } from "@/lib/analysis/macro";

const rel = { indicator: "CPI", unit: "%", actual: 3.4, prior: 3.2, revisedPrior: 3.2 };
const hist = Array.from({ length: 24 }, (_, i) => Math.sin(i) * 0.1);

describe("macro surprise", () => {
  it("is actual − consensus with matching units", () => {
    const s = computeMacroSurprise(rel, { value: 3.1, unit: "%", source: "Panel", licensed: true }, hist);
    expect(s.surprise).toBeCloseTo(0.3, 10);
    expect(s.surpriseZ).not.toBeNull();
  });

  it("refuses mismatched units instead of silently subtracting", () => {
    expect(() => computeMacroSurprise(rel, { value: 310, unit: "bp", source: "Panel", licensed: true }, hist)).toThrow(UnitMismatchError);
  });

  it("never substitutes the prior print for a missing consensus", () => {
    const s = computeMacroSurprise(rel, null, hist);
    expect(s.surprise).toBeNull();
    expect(s.consensus).toBeNull();
    expect(s.prior).toBe(3.2);
    expect(s.note).toMatch(/prior print is not a consensus/);
  });

  it("withholds an unlicensed consensus", () => {
    const s = computeMacroSurprise(rel, { value: 3.1, unit: "%", source: "Scraped", licensed: false }, hist);
    expect(s.surprise).toBeNull();
    expect(s.note).toMatch(/not licensed/);
  });

  it("computes z only with enough historical forecast errors", () => {
    const s = computeMacroSurprise(rel, { value: 3.1, unit: "%", source: "Panel", licensed: true }, hist.slice(0, 8));
    expect(s.surprise).toBeCloseTo(0.3, 10);
    expect(s.surpriseZ).toBeNull();
    expect(s.note).toMatch(/z-score withheld/);
  });

  it("treats 'percent' and '%' as the same unit", () => {
    expect(computeMacroSurprise(rel, { value: 3.1, unit: "percent", source: "Panel", licensed: true }, hist).surprise).toBeCloseTo(0.3, 10);
  });
});
