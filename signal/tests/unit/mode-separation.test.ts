import { afterEach, describe, expect, it, vi } from "vitest";
import { runPipeline } from "@/lib/ingestion/pipeline";
import { NO_PRICES } from "@/lib/ingestion/priceStore";
import { SecurityMaster } from "@/lib/analysis/securityMaster";
import { demoArticles } from "@/lib/demo/articles";
import { DEMO_ALIASES, DEMO_MEMBERSHIPS, DEMO_RELATIONSHIPS, DEMO_SECURITIES, DEMO_SOURCES } from "@/lib/demo/universe";
import { isDemoMode } from "@/lib/config/env";
import type { RawRecord } from "@/lib/ingestion/types";

const master = new SecurityMaster(DEMO_SECURITIES, DEMO_RELATIONSHIPS, DEMO_MEMBERSHIPS, DEMO_ALIASES);
const sources = new Map(DEMO_SOURCES.map((s) => [s.id, s] as const));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("demo and live never mix", () => {
  it("DEMO is the default; only an explicit DEMO_MODE=false enables live", () => {
    expect(isDemoMode({} as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isDemoMode({ DEMO_MODE: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isDemoMode({ DEMO_MODE: "0" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isDemoMode({ DEMO_MODE: "false" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("the live pipeline drops synthetic records", async () => {
    const r = await runPipeline(demoArticles(), { mode: "live", master, sources, model: null, prices: NO_PRICES, now: new Date("2026-10-14T18:30:00Z"), providerStale: () => false });
    expect(r.events).toHaveLength(0);
  });

  it("the demo pipeline drops non-synthetic records", async () => {
    const real: RawRecord = { ...demoArticles()[0]!, isSynthetic: false };
    const r = await runPipeline([real], { mode: "demo", master, sources, model: null, prices: NO_PRICES, now: new Date("2026-10-14T18:30:00Z"), providerStale: () => false });
    expect(r.events).toHaveLength(0);
  });

  it("live mode with no provider keys returns an empty labelled feed — never demo tickers", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    for (const k of ["SEC_USER_AGENT", "FRED_API_KEY", "FMP_API_KEY", "MASSIVE_API_KEY", "DATABASE_URL"]) vi.stubEnv(k, "");
    vi.stubEnv("LIVE_FREE_SOURCES", "false");
    const { getFeed, getRibbon, search } = await import("@/lib/data/service");
    const feed = await getFeed({ limit: 50 });
    expect(feed.mode.mode).toBe("live");
    expect(feed.items).toHaveLength(0);
    expect(feed.freshness.note).toMatch(/never synthetic/);
    const ribbon = await getRibbon();
    expect(ribbon.items.every((i) => i.entitlement === "none" && i.last === null)).toBe(true);
    expect(ribbon.items.map((i) => i.ticker)).not.toContain("MKTX");
    expect(await search("HLCN")).toEqual([]);
  });

  it("license-blocked live sources are not published", async () => {
    const live: RawRecord = { ...demoArticles().find((r) => r.providerId === "sumt-downgrade")!, isSynthetic: false, sourceId: "unlicensed" };
    const s2 = new Map(sources);
    s2.set("unlicensed", { ...DEMO_SOURCES[3]!, id: "unlicensed", displayLicensed: false });
    const r = await runPipeline([live], { mode: "live", master, sources: s2, model: null, prices: NO_PRICES, now: new Date("2026-10-14T18:30:00Z"), providerStale: () => false });
    expect(r.events).toHaveLength(0);
    expect(r.licenseBlocked).toBe(1);
  });
});
