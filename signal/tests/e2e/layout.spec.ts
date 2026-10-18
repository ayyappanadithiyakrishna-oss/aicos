import { expect, test, type Page } from "@playwright/test";

const PATHS = ["/", "/ticker/HLCN", "/pulse", "/impact-map", "/macro", "/filings", "/calendar", "/forecast-lab", "/scorecard", "/status", "/watchlists", "/alerts", "/settings"];

/** Page-level horizontal overflow, ignoring content inside intentional scroll containers. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const e of document.querySelectorAll("body *")) {
      const r = e.getBoundingClientRect();
      if (r.right <= cw + 1 || r.width === 0) continue;
      let p = e.parentElement;
      let contained = false;
      while (p) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "hidden" || ox === "scroll") {
          contained = true;
          break;
        }
        p = p.parentElement;
      }
      if (!contained) offenders.push(`${e.tagName}.${String((e as HTMLElement).className).slice(0, 70)} right=${Math.round(r.right)}`);
    }
    return { sw: document.documentElement.scrollWidth, cw, offenders: offenders.slice(0, 5) };
  });
}

test.describe("@layout no horizontal overflow", () => {
  for (const path of PATHS) {
    test(`@layout ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const o = await overflow(page);
      expect(o.sw, `page scrolls horizontally at ${o.cw}px: ${o.offenders.join(" | ")}`).toBeLessThanOrEqual(o.cw);
    });
  }
  test("@layout event dossier", async ({ page }) => {
    await page.goto("/");
    const href = await page.locator("article[data-card-id] h3 a").first().getAttribute("href");
    await page.goto(href!);
    const o = await overflow(page);
    expect(o.sw, o.offenders.join(" | ")).toBeLessThanOrEqual(o.cw);
  });
});
