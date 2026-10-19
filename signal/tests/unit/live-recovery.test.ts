import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/lib/db/repo";
import { liveConfig } from "@/lib/live/registry";
import { runLiveIngest, type IngestReport } from "@/lib/live/jobs";
import { classify } from "@/lib/analysis/extract";
import { demoArticles } from "@/lib/demo/articles";

describe("live recovery and source classification", () => {
  it("returns the original completed ingest report on an idempotent repeat", async () => {
    const repo = new MemoryRepository();
    const now = new Date("2026-10-19T12:00:00Z");
    const job = await repo.startJob("ingest", `on_demand:${Math.floor(now.getTime() / 300_000)}`, now.toISOString());
    const report: IngestReport = { status: "partial", reason: "One source unavailable", startedAt: now.toISOString(), finishedAt: now.toISOString(), fetched: {}, errors: [], newRecords: 4, events: 3, forecastsInserted: 0, stages: [], deadLetters: 0, ingestLagMinutes: [] };
    await repo.finishJob(job.id, "failed", report, now.toISOString());
    const result = await runLiveIngest({ now: new Date(now.getTime() + 1000), repo, trigger: "on_demand", cfg: liveConfig({} as NodeJS.ProcessEnv) });
    expect(result).toEqual(report);
    expect(result.finishedAt).toBe(now.toISOString());
  });
  it("does not turn unrelated excerpt mentions into a CNBC catalyst", () => {
    const record = { ...demoArticles()[0]!, structured: undefined, sourceId: "cnbc", title: "Alberta has enormous oil reserves and sends crude exports to the US", excerpt: "Related coverage: crude exports and oil supply." };
    expect(classify(record).subtype).toBe("other.unclassified");
    expect(classify({ ...record, title: "Top Wall Street analysts are bullish on these stocks", excerpt: "Oil prices rally" }).subtype).toBe("other.unclassified");
    expect(classify({ ...record, title: "Nasdaq futures gain as investors buy the dip", excerpt: "" }).subtype).toBe("market.equities");
  });
});
