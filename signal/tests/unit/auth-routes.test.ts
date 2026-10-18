import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const req = (url: string, init: RequestInit = {}) => new Request(`http://localhost${url}`, init);

describe("cron and admin endpoints reject missing or invalid authorization", () => {
  it("cron ingest: no header, wrong token, and short secrets all → 401", async () => {
    vi.stubEnv("CRON_SECRET", "a-very-long-cron-secret-123");
    const { GET } = await import("@/app/api/cron/ingest/route");
    expect((await GET(req("/api/cron/ingest"))).status).toBe(401);
    expect((await GET(req("/api/cron/ingest", { headers: { authorization: "Bearer wrong-token-wrong-token" } }))).status).toBe(401);
    expect((await GET(req("/api/cron/ingest", { headers: { authorization: "a-very-long-cron-secret-123" } }))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short");
    expect((await GET(req("/api/cron/ingest", { headers: { authorization: "Bearer short" } }))).status).toBe(401);
  });

  it("cron ingest with the right secret runs (and skips provider calls in demo mode)", async () => {
    vi.stubEnv("CRON_SECRET", "a-very-long-cron-secret-123");
    vi.stubEnv("DEMO_MODE", "true");
    const { GET } = await import("@/app/api/cron/ingest/route");
    const res = await GET(req("/api/cron/ingest", { headers: { authorization: "Bearer a-very-long-cron-secret-123" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("skipped");
  });

  it("cron resolve rejects unauthorized calls", async () => {
    vi.stubEnv("CRON_SECRET", "a-very-long-cron-secret-123");
    const { GET } = await import("@/app/api/cron/resolve-forecasts/route");
    expect((await GET(req("/api/cron/resolve-forecasts"))).status).toBe(401);
  });

  it("admin ingest requires ADMIN_TOKEN (or the cron secret)", async () => {
    vi.stubEnv("ADMIN_TOKEN", "admin-token-0123456789abcdef");
    vi.stubEnv("CRON_SECRET", "");
    const { POST } = await import("@/app/api/admin/ingest/route");
    expect((await POST(req("/api/admin/ingest", { method: "POST" }))).status).toBe(401);
    expect((await POST(req("/api/admin/ingest", { method: "POST", headers: { authorization: "Bearer nope-nope-nope-nope" } }))).status).toBe(401);
    expect((await POST(req("/api/admin/ingest", { method: "POST", headers: { authorization: "Bearer admin-token-0123456789abcdef" } }))).status).toBe(200);
  });

  it("account endpoints return 401 without an identity provider and block cross-origin writes", async () => {
    const wl = await import("@/app/api/watchlists/route");
    expect((await wl.GET(req("/api/watchlists"))).status).toBe(401);
    const post = await wl.POST(req("/api/watchlists", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ name: "x", tickers: [] }) }));
    expect(post.status).toBe(403);
    const al = await import("@/app/api/alerts/route");
    expect((await al.GET(req("/api/alerts"))).status).toBe(401);
  });

  it("feed API validates query parameters", async () => {
    const { GET } = await import("@/app/api/feed/route");
    expect((await GET(req("/api/feed?limit=5000"))).status).toBe(400);
    expect((await GET(req("/api/feed?severity=extreme"))).status).toBe(400);
    const ok = await GET(req("/api/feed?limit=2&format=card"));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeTruthy();
  });

  it("ticker API rejects malformed symbols and unknown tickers", async () => {
    const { GET } = await import("@/app/api/tickers/[symbol]/route");
    expect((await GET(req("/api/tickers/../etc"), { params: Promise.resolve({ symbol: "../etc" }) })).status).toBe(400);
    expect((await GET(req("/api/tickers/NOPEX"), { params: Promise.resolve({ symbol: "NOPEX" }) })).status).toBe(404);
  });
});
