import { describe, expect, it } from "vitest";
import { checkFacts, validEvidenceRefs, verifyNumbers, type EvidenceSource } from "@/lib/analysis/evidence";
import { SecurityMaster } from "@/lib/analysis/securityMaster";
import { extractNumbers } from "@/lib/analysis/extract";
import { DEMO_ALIASES, DEMO_MEMBERSHIPS, DEMO_RELATIONSHIPS, DEMO_SECURITIES } from "@/lib/demo/universe";
import type { Evidence } from "@/lib/domain/types";

const ev = (id: string): Evidence => ({ id, articleId: null, url: "https://x.test/a", publisher: "P", publishedAt: "2026-10-14T13:00:00Z", kind: "news", isOriginal: true, excerpt: "", internalPath: null });
const sources: EvidenceSource[] = [{ evidence: ev("e1"), text: "CPI rose 3.4% vs 3.1% expected; prior 3.2%." }];

describe("evidence checks", () => {
  it("keeps facts whose numbers appear in the cited source", () => {
    const r = checkFacts([{ text: "CPI 3.4% vs consensus 3.1%.", evidenceId: "e1" }], sources);
    expect(r.kept).toHaveLength(1);
  });
  it("drops facts citing unknown evidence or unsupported numbers", () => {
    const r = checkFacts(
      [
        { text: "CPI 3.4%.", evidenceId: "nope" },
        { text: "Core CPI 2.9%.", evidenceId: "e1" },
      ],
      sources,
    );
    expect(r.kept).toHaveLength(0);
    expect(r.dropped.map((d) => d.reason).join(" ")).toMatch(/Unknown evidence ID/);
    expect(r.dropped.map((d) => d.reason).join(" ")).toMatch(/2.9/);
  });
  it("verifies extracted numbers against exact source text", () => {
    const nums = extractNumbers("CPI rose 3.4% vs 3.1% expected", "e1");
    expect(verifyNumbers(nums, sources).highImpactVerified).toBe(true);
    const forged = [{ ...nums[0]!, value: 3.9, sourceText: "3.9% vs 3.1%" }];
    expect(verifyNumbers(forged, sources).highImpactVerified).toBe(false);
  });
  it("hypotheses may only cite existing evidence", () => {
    expect(validEvidenceRefs(["e1"], sources)).toBe(true);
    expect(validEvidenceRefs(["e1", "ghost"], sources)).toBe(false);
    expect(validEvidenceRefs([], sources)).toBe(false);
  });
});

describe("symbol quarantine", () => {
  const master = new SecurityMaster(DEMO_SECURITIES, DEMO_RELATIONSHIPS, DEMO_MEMBERSHIPS, DEMO_ALIASES);
  it("verifies names and cashtags present in the text", () => {
    const r = master.resolve("Halcyon Semiconductor and $VRTA rallied", [], "2026-10-14T13:00:00Z", "a1");
    expect(r.verified.map((v) => v.security.ticker).sort()).toEqual(["HLCN", "VRTA"]);
  });
  it("quarantines unknown symbols from provider tags", () => {
    const r = master.resolve("Coastal Home REIT expands portfolio", ["CSTL", "ZZZQ"], "2026-10-14T13:00:00Z", "a2");
    expect(r.verified.map((v) => v.security.ticker)).toEqual(["CSTL"]);
    expect(r.quarantined).toEqual([{ symbol: "ZZZQ", reason: "Unknown symbol: not in security master", articleId: "a2" }]);
  });
  it("quarantines provider tags not supported by the article text", () => {
    const r = master.resolve("Crude prices rise on supply concerns", ["HLCN"], "2026-10-14T13:00:00Z", "a3");
    expect(r.verified).toHaveLength(0);
    expect(r.quarantined[0]!.reason).toMatch(/not supported by article text/);
  });
  it("respects point-in-time ticker history", () => {
    const sec = { ...DEMO_SECURITIES.find((s) => s.ticker === "LDGR")!, tickerHistory: [{ ticker: "LDGO", from: "2020-01-01", to: "2025-06-01" }, { ticker: "LDGR", from: "2025-06-01", to: null }] };
    const m = new SecurityMaster([sec]);
    expect(m.byTicker("LDGO", "2024-01-01")?.id).toBe("syn:LDGR");
    expect(m.byTicker("LDGO", "2026-01-01")).toBeNull();
    expect(m.resolve("$LDGO jumps", [], "2026-01-01T00:00:00Z", null).quarantined[0]!.reason).toMatch(/not valid at publication time/);
  });
});
