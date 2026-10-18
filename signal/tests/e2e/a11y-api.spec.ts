import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("accessibility", () => {
  test.setTimeout(90_000);
  for (const path of ["/", "/ticker/HLCN", "/scorecard", "/status"]) {
    test(`no critical or serious axe violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const bad = r.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    });
  }
});

test.describe("api", () => {
  test("health reports demo mode without secrets", async ({ request }) => {
    const r = await request.get("/api/health");
    expect(r.ok()).toBe(true);
    const j = await r.json();
    expect(j.mode).toBe("demo");
    expect(JSON.stringify(j)).not.toMatch(/key|secret/i);
  });
  test("cron rejects unauthenticated calls", async ({ request }) => {
    expect((await request.get("/api/cron/ingest")).status()).toBe(401);
    expect((await request.get("/api/cron/ingest", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  });
  test("security headers are set", async ({ request }) => {
    const r = await request.get("/");
    expect(r.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(r.headers()["x-content-type-options"]).toBe("nosniff");
  });
});
