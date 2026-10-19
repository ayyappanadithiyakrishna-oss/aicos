import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ProviderError, providerFetch, providerMetrics, redact, resetProviderMetrics } from "@/lib/providers/http";
import { filingToRecord, parseCurrentFilingsAtom, secUserAgent } from "@/lib/providers/sec";
import { latestRelease, FRED_SERIES } from "@/lib/providers/fred";
import { fmpLatestNews, fmpTime } from "@/lib/providers/vendors";
import { runLiveIngest } from "@/lib/live/jobs";
import { MemoryRepository } from "@/lib/db/repo";
import type { LiveConfig } from "@/lib/live/registry";

const fixture = readFileSync(new URL("../fixtures/sec-current.atom", import.meta.url), "utf8");

beforeEach(() => resetProviderMetrics());
afterEach(() => resetProviderMetrics());

const respond = (status: number, body: unknown = {}) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("provider HTTP client", () => {
  it("blocks non-allowlisted hosts and non-https (SSRF guard)", async () => {
    await expect(providerFetch("https://169.254.169.254/latest/meta-data", { provider: "x", ratePerSec: 10 })).rejects.toMatchObject({ kind: "blocked" });
    await expect(providerFetch("http://www.sec.gov/files/company_tickers.json", { provider: "x", ratePerSec: 10 })).rejects.toMatchObject({ kind: "blocked" });
  });

  it("retries 429 with backoff, then surfaces rate_limited", async () => {
    let calls = 0;
    const f = async () => {
      calls++;
      return new Response("{}", { status: 429 });
    };
    await expect(providerFetch("https://api.massive.com/v2/x", { provider: "massive", ratePerSec: 100, fetchImpl: f as typeof fetch, attempts: 2 })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(calls).toBe(2);
    expect(providerMetrics("massive").failures).toBe(1);
  });

  it("does not retry quota exhaustion or auth failures", async () => {
    let calls = 0;
    const f = async () => {
      calls++;
      return new Response("{}", { status: 402 });
    };
    await expect(providerFetch("https://financialmodelingprep.com/stable/x?apikey=SECRET123", { provider: "fmp", ratePerSec: 100, fetchImpl: f as typeof fetch })).rejects.toMatchObject({ kind: "quota" });
    expect(calls).toBe(1);
    await expect(providerFetch("https://financialmodelingprep.com/stable/x", { provider: "fmp", ratePerSec: 100, fetchImpl: respond(403) as typeof fetch })).rejects.toMatchObject({ kind: "auth" });
  });

  it("opens the circuit after repeated failures", async () => {
    for (let i = 0; i < 5; i++) {
      await providerFetch("https://api.stlouisfed.org/x", { provider: "fred", ratePerSec: 100, fetchImpl: respond(404) as typeof fetch }).catch(() => undefined);
    }
    expect(providerMetrics("fred").circuit).toBe("open");
    await expect(providerFetch("https://api.stlouisfed.org/x", { provider: "fred", ratePerSec: 100, fetchImpl: respond(200) as typeof fetch })).rejects.toMatchObject({ kind: "circuit_open" });
  });

  it("redacts API keys from recorded errors", () => {
    expect(redact("GET https://x?apikey=SECRET&apiKey=ABC&token=t")).toBe("GET https://x?apikey=REDACTED&apiKey=REDACTED&token=REDACTED");
  });
});

describe("SEC EDGAR adapter", () => {
  it("requires a User-Agent with contact email (fair access)", () => {
    expect(secUserAgent({ SEC_USER_AGENT: "SIGNAL research" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(secUserAgent({ SEC_USER_AGENT: "SIGNAL research ops@example.com" } as unknown as NodeJS.ProcessEnv)).toBe("SIGNAL research ops@example.com");
  });

  it("parses the current-filings Atom feed and skips malformed entries", () => {
    const fs = parseCurrentFilingsAtom(fixture);
    expect(fs).toHaveLength(2);
    expect(fs[0]).toMatchObject({ form: "8-K", cik: "9000001", accession: "0009000001-26-000188", items: ["2.02", "9.01"], acceptedAt: "2026-10-15T20:07:12.000Z" });
    expect(fs[1]!.form).toBe("8-K/A");
    const rec = filingToRecord(fs[0]!, "2026-10-15T20:09:00Z");
    expect(rec.structured!.filing!.items).toContain("2.02");
    expect(rec.title).toMatch(/Item 2.02/);
    expect(filingToRecord(fs[1]!, "x").structured!.filing!.isAmendment).toBe(true);
  });
});

describe("FRED adapter", () => {
  it("derives YoY releases with vintage-aware priors and no consensus", async () => {
    const obs = (vals: number[], rt: string) => ({ observations: vals.map((v, i) => ({ date: `2025-${String((i % 12) + 1).padStart(2, "0")}-01`.replace("2025", String(2025 + Math.floor(i / 12))), value: String(v), realtime_start: rt })) });
    const latest = obs(Array.from({ length: 21 }, (_, i) => 300 + i), "2026-10-14");
    const prior = obs(Array.from({ length: 20 }, (_, i) => 300 + i), "2026-10-13");
    let n = 0;
    const f = (async () => new Response(JSON.stringify(n++ === 0 ? latest : prior), { status: 200 })) as typeof fetch;
    const r = (await latestRelease("k".repeat(32), FRED_SERIES[0]!, f))!;
    expect(r.releaseDate).toBe("2026-10-14");
    expect(r.actual).toBeCloseTo(Math.round(((320 / 308) - 1) * 1000) / 10, 10);
    expect(r.prior).not.toBeNull();
  });
});

describe("FMP adapter", () => {
  it("interprets zone-less timestamps as New York time", () => {
    expect(fmpTime("2026-10-14 08:30:00")).toBe("2026-10-14T12:30:00.000Z");
    expect(fmpTime("2026-01-14 08:30:00")).toBe("2026-01-14T13:30:00.000Z");
    expect(fmpTime("garbage")).toBeNull();
  });
  it("rejects unexpected payload shapes as schema errors", async () => {
    await expect(fmpLatestNews("k", "2026-10-14T00:00:00Z", respond(200, { error: "x" }) as typeof fetch)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("live ingest under provider failure", () => {
  const cfg: LiveConfig = { secUa: "SIGNAL test ops@example.com", fredKey: null, fmpKey: null, fmpDisplay: false, fmpConsensus: false, massiveKey: null, massiveDisplay: false, llm: false, free: false, lseKey: null, marketauxKey: null, newsApiKey: null };
  it("records the failure and produces no synthetic events", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("quota", { status: 429 })) as typeof fetch;
    try {
      const repo = new MemoryRepository();
      const r = await runLiveIngest({ now: new Date("2026-10-15T15:00:00Z"), repo, trigger: "admin", cfg });
      expect(["partial", "failed"]).toContain(r.status);
      expect(r.events).toBe(0);
      expect(r.errors.length).toBeGreaterThan(0);
      expect(await repo.listEvents(10)).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  it("skips (and says why) when nothing is configured", async () => {
    const r = await runLiveIngest({ now: new Date(), repo: new MemoryRepository(), trigger: "cron", cfg: { ...cfg, secUa: null } });
    expect(r.status).toBe("skipped");
    expect(r.reason).toMatch(/never synthetic/);
  });
  it("is idempotent within a 5-minute slot", async () => {
    const repo = new MemoryRepository();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(fixture, { status: 200 })) as typeof fetch;
    try {
      const now = new Date("2026-10-15T15:01:00Z");
      const first = await runLiveIngest({ now, repo, trigger: "cron", cfg });
      const second = await runLiveIngest({ now: new Date("2026-10-15T15:02:00Z"), repo, trigger: "cron", cfg });
      expect(second).toEqual(first);
      expect(await repo.listJobs(10)).toHaveLength(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
