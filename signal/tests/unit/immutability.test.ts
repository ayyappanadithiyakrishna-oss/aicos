import { describe, expect, it } from "vitest";
import { ImmutableForecastError, MemoryRepository } from "@/lib/db/repo";
import { getDemoWorld } from "@/lib/demo/world";

describe("forecast snapshots are immutable", () => {
  it("rejects a different snapshot under an existing id and keeps the original", async () => {
    const w = await getDemoWorld();
    const f = w.events[0]!.forecasts[0]!;
    const repo = new MemoryRepository();
    expect(await repo.insertForecasts([f])).toEqual({ inserted: 1, existing: 0 });
    expect(await repo.insertForecasts([f])).toEqual({ inserted: 0, existing: 1 });
    await expect(repo.insertForecasts([{ ...f, centralMovePct: 9.9 }])).rejects.toThrow(ImmutableForecastError);
    const stored = (await repo.allForecasts())[0]!;
    expect(stored.centralMovePct).toBe(f.centralMovePct);
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it("a revision is a new linked record; the superseded original is retained", async () => {
    const w = await getDemoWorld();
    const revised = w.events.flatMap((e) => e.forecasts).filter((f) => f.revision > 1);
    expect(revised.length).toBeGreaterThan(0);
    for (const r of revised) {
      expect(r.supersedes).toBeTruthy();
      const original = w.archive.find((a) => a.forecast.id === r.supersedes);
      expect(original?.superseded).toBe(true);
      expect(original!.forecast.id).not.toBe(r.id);
      expect(Date.parse(original!.forecast.forecastGeneratedAt)).toBeLessThan(Date.parse(r.forecastGeneratedAt));
    }
  });

  it("final realizations are never overwritten", async () => {
    const repo = new MemoryRepository();
    const base = { id: "rz", forecastId: "fc", windowStart: null, windowEnd: null, rawReturnPct: 1, benchmarkReturnPct: 0, abnormalReturnPct: 1, betaUsed: 1, outcomeClass: "up" as const, resolvedAt: "2026-10-14T20:00:00Z", quality: "clean" as const, failureReason: null };
    await repo.upsertRealizations([{ ...base, status: "resolved" }]);
    await repo.upsertRealizations([{ ...base, status: "resolved", abnormalReturnPct: -5 }]);
    expect((await repo.realizationsFor(["fc"])).get("fc")!.abnormalReturnPct).toBe(1);
  });
});
